import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config.js', () => ({
    default: { messageTimeout: 5000, heartbeatInterval: 30000, maxPoolSize: 3 },
    getConfig: vi.fn(() => null),
}));
vi.mock('../../src/metrics.js', () => ({
    setCadConnected: vi.fn(),
}));
vi.mock('../../src/cad-circuit-breaker.js', () => {
    function MockCB() {
        this.isOpen = false;
        this.recordFailure = vi.fn();
        this.recordSuccess = vi.fn();
        this.reset = vi.fn();
    }
    return { CircuitBreaker: MockCB };
});
vi.mock('child_process', () => ({
    spawn: vi.fn(() => ({
        on: vi.fn(),
        stdout: { on: vi.fn(), setEncoding: vi.fn() },
        stdin: { write: vi.fn() },
        kill: vi.fn(),
    })),
}));
vi.mock('crypto', () => ({
    default: { randomUUID: () => 'mock-uuid', createHash: vi.fn(() => ({ update: vi.fn(() => ({ digest: vi.fn(() => 'hash') })) })) },
    randomUUID: () => 'mock-uuid',
    createHash: vi.fn(() => ({ update: vi.fn(() => ({ digest: vi.fn(() => 'hash') })) })),
}));

import { ReadBatcher, isReadCommand } from '../../src/cad.js';

let connQueue = null;
function makeConn() {
    connQueue = { enqueueHighPriority: vi.fn() };
    return {
        _commandQueue: connQueue,
        _platform: 'AutoCAD',
    };
}

function makeCmd(code) {
    return { code, resolve: vi.fn(), reject: vi.fn() };
}

describe('isReadCommand', () => {
    it('returns true for tblnext queries', () => {
        expect(isReadCommand('(tblnext "LAYER" nil)')).toBe(true);
    });

    it('returns true for ssget queries', () => {
        expect(isReadCommand('(ssget "_X")')).toBe(true);
    });

    it('returns true for entget queries', () => {
        expect(isReadCommand('(entget (handent "ABC"))')).toBe(true);
    });

    it('returns false for setq commands', () => {
        expect(isReadCommand('(setq a 1)')).toBe(false);
    });

    it('returns false for command calls', () => {
        expect(isReadCommand('(command "_.LINE" ...)')).toBe(false);
    });
});

describe('ReadBatcher', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('add returns false for non-read commands', () => {
        const batcher = new ReadBatcher(makeConn());
        const result = batcher.add(makeCmd('(setq a 1)'));
        expect(result).toBe(false);
        expect(connQueue.enqueueHighPriority).not.toHaveBeenCalled();
    });

    it('add returns true for read commands', () => {
        const batcher = new ReadBatcher(makeConn());
        const result = batcher.add(makeCmd('(tblnext "LAYER" nil)'));
        expect(result).toBe(true);
    });

    it('flushes immediately when batch reaches max size', () => {
        const batcher = new ReadBatcher(makeConn(), 1000, 3);
        batcher.add(makeCmd('(tblnext "LAYER" nil)'));
        batcher.add(makeCmd('(tblnext "LAYER" nil)'));
        expect(connQueue.enqueueHighPriority).not.toHaveBeenCalled();
        batcher.add(makeCmd('(tblnext "LAYER" nil)'));
        expect(connQueue.enqueueHighPriority).toHaveBeenCalledTimes(1);
    });

    it('flushes after max delay', async () => {
        const batcher = new ReadBatcher(makeConn(), 50, 10);
        batcher.add(makeCmd('(tblnext "LAYER" nil)'));
        expect(connQueue.enqueueHighPriority).not.toHaveBeenCalled();
        await new Promise(r => setTimeout(r, 80));
        expect(connQueue.enqueueHighPriority).toHaveBeenCalled();
    });

    it('enqueues single item directly', () => {
        const batcher = new ReadBatcher(makeConn(), 1000, 2);
        batcher.add(makeCmd('(tblnext "LAYER" nil)'));
        batcher.add(makeCmd('(tblnext "LAYER" nil)'));
        const cmd = connQueue.enqueueHighPriority.mock.calls[0][0];
        expect(cmd.type).toBe('sendResult');
        expect(cmd.code).toContain('_br0');
        expect(cmd.code).toContain('_br1');
    });

    it('resolves items with parsed array result', () => {
        const conn = makeConn();
        const batcher = new ReadBatcher(conn, 1000, 2);
        const cmd1 = makeCmd('(tblnext "LAYER" nil)');
        const cmd2 = makeCmd('(tblnext "LAYER" nil)');
        batcher.add(cmd1);
        batcher.add(cmd2);
        const combinedCmd = connQueue.enqueueHighPriority.mock.calls[0][0];
        combinedCmd.resolve({ success: true, result: '["(LAYER1)","(LAYER2)"]' });
        expect(cmd1.resolve).toHaveBeenCalledWith({ success: true, result: '(LAYER1)' });
        expect(cmd2.resolve).toHaveBeenCalledWith({ success: true, result: '(LAYER2)' });
    });

    it('rejects all items on failed batch', () => {
        const conn = makeConn();
        const batcher = new ReadBatcher(conn, 1000, 2);
        const cmd1 = makeCmd('(tblnext "LAYER" nil)');
        const cmd2 = makeCmd('(tblnext "LAYER" nil)');
        batcher.add(cmd1);
        batcher.add(cmd2);
        const combinedCmd = connQueue.enqueueHighPriority.mock.calls[0][0];
        combinedCmd.reject(new Error('CAD timeout'));
        expect(cmd1.reject).toHaveBeenCalled();
        expect(cmd2.reject).toHaveBeenCalled();
    });

    it('rejects all items when result is not an array', () => {
        const conn = makeConn();
        const batcher = new ReadBatcher(conn, 1000, 2);
        const cmd1 = makeCmd('(tblnext "LAYER" nil)');
        const cmd2 = makeCmd('(tblnext "LAYER" nil)');
        batcher.add(cmd1);
        batcher.add(cmd2);
        const combinedCmd = connQueue.enqueueHighPriority.mock.calls[0][0];
        combinedCmd.resolve({ success: true, result: '"not-an-array"' });
        expect(cmd1.reject).toHaveBeenCalled();
        expect(cmd2.reject).toHaveBeenCalled();
    });
});
