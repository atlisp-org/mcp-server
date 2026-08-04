import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
    const handler = vi.fn(() => ({ content: [{ type: 'text', text: 'ok' }] }));
    const { AsyncLocalStorage } = require('async_hooks');
    const als = new AsyncLocalStorage();
    return {
        als,
        handler,
        cad: { connected: true, sendCommand: vi.fn() },
        poolGetConnection: vi.fn(),
        resolveCadConnection: vi.fn(() => ({ connected: true, sendCommand: vi.fn() })),
        validateToolArgs: vi.fn(),
        checkToolRateLimit: vi.fn(() => ({ allowed: true })),
        writeAuditEntry: vi.fn(),
        callCustomTool: vi.fn(() => null),
        notifyResourceChanges: vi.fn(),
    };
});

vi.mock('../../src/mcp-tools.js', () => ({
    TOOL_HANDLERS: { test_write_tool: mocks.handler, test_read_tool: mocks.handler, test_destructive_tool: mocks.handler },
    tools: [],
    handleToolCall: null,
}));
vi.mock('../../src/mcp-server-state.js', () => ({
    mcpContext: mocks.als,
    progressContext: mocks.als,
}));
vi.mock('../../src/tools/index.js', () => ({
    READ_ONLY_TOOLS: new Set(['test_read_tool']),
    DESTRUCTIVE_TOOLS: new Set(['test_destructive_tool']),
}));
vi.mock('../../src/cad.js', () => ({
    cad: mocks.cad,
    resolveCadConnection: mocks.resolveCadConnection,
}));
vi.mock('../../src/cad-pool.js', () => ({
    pool: { getConnection: mocks.poolGetConnection },
}));
vi.mock('../../src/tool-validators.js', () => ({
    validateToolArgs: mocks.validateToolArgs,
}));
vi.mock('../../src/rate-limiter.js', () => ({
    checkToolRateLimit: mocks.checkToolRateLimit,
}));
vi.mock('../../src/audit-log.js', () => ({
    writeAuditEntry: mocks.writeAuditEntry,
}));
vi.mock('../../src/tool-registry.js', () => ({
    callCustomTool: mocks.callCustomTool,
}));
vi.mock('../../src/tool-dispatch.js', () => ({
    notifyResourceChanges: mocks.notifyResourceChanges,
}));

import { handleToolCall } from '../../src/tool-executor.js';

describe('tool-executor handleToolCall', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.handler.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
        mocks.validateToolArgs.mockReturnValue(true);
        mocks.checkToolRateLimit.mockReturnValue({ allowed: true });
        mocks.callCustomTool.mockReturnValue(null);
        mocks.resolveCadConnection.mockReturnValue({ connected: true, sendCommand: vi.fn() });
    });

    it('rejects unknown tool with HANDLER_NOT_FOUND', async () => {
        const result = await handleToolCall('nobody', {});
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('HANDLER_NOT_FOUND');
        expect(mocks.callCustomTool).toHaveBeenCalledWith('nobody', {});
    });

    it('rejects rate-limited call with RATE_LIMITED', async () => {
        mocks.checkToolRateLimit.mockReturnValue({ allowed: false, retryAfter: 30 });
        const result = await handleToolCall('test_write_tool', {});
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('RATE_LIMITED');
    });

    it('rejects validation error with INVALID_ARGS', async () => {
        mocks.validateToolArgs.mockImplementation(() => { throw new Error('Missing required argument: name'); });
        const result = await handleToolCall('test_write_tool', {});
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('INVALID_ARGS');
    });

    it('rejects type validation error with INVALID_ARGS', async () => {
        mocks.validateToolArgs.mockImplementation(() => { throw new Error('Invalid type for argument count: expected number, got string'); });
        const result = await handleToolCall('test_write_tool', {});
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('INVALID_ARGS');
    });

    it('wraps handler error with OPERATION_FAILED', async () => {
        mocks.handler.mockRejectedValue(new Error('CAD timeout'));
        const result = await handleToolCall('test_write_tool', {});
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('CAD timeout');
    });

    it('writes audit on success', async () => {
        await handleToolCall('test_write_tool', { arg: 1 }, { sessionId: 's1' });
        expect(mocks.writeAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
            tool: 'test_write_tool',
            result: 'success',
            sessionId: 's1',
        }));
    });

    it('writes audit on error', async () => {
        mocks.handler.mockRejectedValue(new Error('fail'));
        await handleToolCall('test_write_tool', { arg: 1 }, { sessionId: 's2' });
        expect(mocks.writeAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
            tool: 'test_write_tool',
            result: 'error',
            sessionId: 's2',
        }));
    });

    it('does not call undo for non-destructive write tools', async () => {
        await handleToolCall('test_write_tool', {});
        expect(mocks.cad.sendCommand).not.toHaveBeenCalled();
    });

    it('calls undo for destructive tools', async () => {
        await handleToolCall('test_destructive_tool', {});
        expect(mocks.cad.sendCommand).toHaveBeenCalledWith('(command "_.UNDO" "_BEGIN")');
    });

    it('does not call undo for read-only tools', async () => {
        await handleToolCall('test_read_tool', {});
        expect(mocks.cad.sendCommand).not.toHaveBeenCalled();
    });

    it('sends undo END even when handler fails', async () => {
        mocks.handler.mockRejectedValue(new Error('fail'));
        await handleToolCall('test_destructive_tool', {});
        expect(mocks.cad.sendCommand).toHaveBeenLastCalledWith('(command "_.UNDO" "_END")');
    });

    it('resolves instance from pool when instance param provided', async () => {
        const poolConn = { connected: true, sendCommand: vi.fn() };
        mocks.poolGetConnection.mockReturnValue(poolConn);
        await handleToolCall('test_destructive_tool', { instance: 'mycad' });
        expect(mocks.poolGetConnection).toHaveBeenCalledWith('mycad');
        expect(poolConn.sendCommand).toHaveBeenCalledWith('(command "_.UNDO" "_BEGIN")');
    });

    it('notifies resource changes on success', async () => {
        await handleToolCall('test_write_tool', {});
        expect(mocks.notifyResourceChanges).toHaveBeenCalledWith('test_write_tool');
    });

    it('returns handler result on success', async () => {
        const result = await handleToolCall('test_write_tool', {});
        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toBe('ok');
    });
});
