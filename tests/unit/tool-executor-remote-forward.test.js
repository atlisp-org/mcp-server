import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
    const handler = vi.fn();
    const { AsyncLocalStorage } = require('async_hooks');
    const als = new AsyncLocalStorage();
    return {
        als,
        handler,
        cad: { connected: false, isAvailable: () => false, sendCommand: vi.fn() },
        poolGetConnection: vi.fn(),
        resolveCadConnection: vi.fn(() => ({ connected: false, sendCommand: vi.fn() })),
        validateToolArgs: vi.fn(),
        checkToolRateLimit: vi.fn(() => ({ allowed: true })),
        writeAuditEntry: vi.fn(),
        callCustomTool: vi.fn(() => null),
        notifyResourceChanges: vi.fn(),
        isForwardableTool: vi.fn(() => true),
        peerForwardToolCall: vi.fn(),
        getAutoForwardPeer: vi.fn(),
    };
});

vi.mock('../../src/mcp-tools.js', () => ({
    TOOL_HANDLERS: { test_cad_tool: mocks.handler },
    tools: [],
    handleToolCall: null,
}));
vi.mock('../../src/mcp-server-state.js', () => ({
    mcpContext: mocks.als,
    progressContext: mocks.als,
}));
vi.mock('../../src/tools/index.js', () => ({
    READ_ONLY_TOOLS: new Set(),
    DESTRUCTIVE_TOOLS: new Set(),
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
vi.mock('../../src/peer-forward.js', () => ({
    isForwardableTool: mocks.isForwardableTool,
    forwardToolCall: mocks.peerForwardToolCall,
    getAutoForwardPeer: mocks.getAutoForwardPeer,
}));

import { handleToolCall } from '../../src/tool-executor.js';
import { MCPError, ERROR_CODES } from '../../src/errors.js';

const REMOTE_PEER = { id: 'remote-10.0.0.5-8110', url: 'http://10.0.0.5:8110', apikey: 'k' };

describe('tool-executor remote auto-forward', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.validateToolArgs.mockReturnValue(true);
        mocks.checkToolRateLimit.mockReturnValue({ allowed: true });
        mocks.callCustomTool.mockReturnValue(null);
        mocks.isForwardableTool.mockReturnValue(true);
        mocks.getAutoForwardPeer.mockReturnValue(null);
    });

    it('forwards to remote peer when CAD_NOT_CONNECTED and peer configured', async () => {
        mocks.handler.mockRejectedValue(new MCPError(ERROR_CODES.CAD_NOT_CONNECTED, 'CAD 未连接'));
        mocks.getAutoForwardPeer.mockReturnValue(REMOTE_PEER);
        mocks.peerForwardToolCall.mockResolvedValue({ content: [{ type: 'text', text: '远程OK' }] });

        const result = await handleToolCall('test_cad_tool', { code: '(princ 1)' }, { sessionId: 's1' });

        expect(result.isError).toBeFalsy();
        expect(result.content[0].text).toBe('远程OK');
        expect(mocks.peerForwardToolCall).toHaveBeenCalledWith(
            REMOTE_PEER.id, 'test_cad_tool', { code: '(princ 1)' }, { apikey: 'k' });
        expect(mocks.writeAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
            tool: 'test_cad_tool',
            result: 'success',
            target: 'peer:remote-10.0.0.5-8110',
        }));
    });

    it('returns original CAD_NOT_CONNECTED error when forward fails', async () => {
        mocks.handler.mockRejectedValue(new MCPError(ERROR_CODES.CAD_NOT_CONNECTED, 'CAD 未连接'));
        mocks.getAutoForwardPeer.mockReturnValue(REMOTE_PEER);
        mocks.peerForwardToolCall.mockRejectedValue(new Error('connection refused'));

        const result = await handleToolCall('test_cad_tool', {}, {});

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('CAD 未连接');
        expect(mocks.writeAuditEntry).toHaveBeenCalledWith(expect.objectContaining({
            tool: 'test_cad_tool',
            result: 'error',
        }));
    });

    it('does not forward non-forwardable tools', async () => {
        mocks.isForwardableTool.mockReturnValue(false);
        mocks.handler.mockRejectedValue(new MCPError(ERROR_CODES.CAD_NOT_CONNECTED, 'CAD 未连接'));

        const result = await handleToolCall('test_cad_tool', {}, {});

        expect(result.isError).toBe(true);
        expect(mocks.getAutoForwardPeer).not.toHaveBeenCalled();
        expect(mocks.peerForwardToolCall).not.toHaveBeenCalled();
    });

    it('does not forward when no remote peer configured', async () => {
        mocks.getAutoForwardPeer.mockReturnValue(null);
        mocks.handler.mockRejectedValue(new MCPError(ERROR_CODES.CAD_NOT_CONNECTED, 'CAD 未连接'));

        const result = await handleToolCall('test_cad_tool', {}, {});

        expect(result.isError).toBe(true);
        expect(mocks.peerForwardToolCall).not.toHaveBeenCalled();
    });

    it('does not forward non-CAD errors', async () => {
        mocks.handler.mockRejectedValue(new Error('boom'));

        const result = await handleToolCall('test_cad_tool', {}, {});

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('boom');
        expect(mocks.getAutoForwardPeer).not.toHaveBeenCalled();
    });
});
