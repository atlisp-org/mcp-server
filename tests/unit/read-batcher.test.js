import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config.js', () => ({
    default: { messageTimeout: 5000, heartbeatInterval: 30000, maxPoolSize: 3, readBatchWindow: 50, readBatchSize: 10 },
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

import { ReadBatcher, isReadCommand, CommandQueue } from '../../src/cad.js';

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

    it('attaches dedup keys to the combined command', () => {
        const batcher = new ReadBatcher(makeConn(), 1000, 2);
        batcher.add(makeCmd('(tblnext "L" nil)'), 'k1');
        batcher.add(makeCmd('(tblnext "L" nil)'), 'k2');
        const combinedCmd = connQueue.enqueueHighPriority.mock.calls[0][0];
        expect(combinedCmd._dedupKeys).toEqual(['k1', 'k2']);
    });

    it('合并代码清理 _br* 临时变量（AutoLISP setq 是全局的，否则选择集被长期引用）', () => {
        const batcher = new ReadBatcher(makeConn(), 1000, 2);
        batcher.add(makeCmd('(tblnext "LAYER" nil)'));
        batcher.add(makeCmd('(ssget "_X")'));
        const combinedCmd = connQueue.enqueueHighPriority.mock.calls[0][0];
        expect(combinedCmd.code.startsWith('(progn ')).toBe(true);
        expect(combinedCmd.code).toContain('(prog1 (list _br0 _br1)');
        expect(combinedCmd.code).toContain('(setq _br0 nil _br1 nil)');
    });

    it('clear 丢弃未 flush 的批次并立即 reject（定时器同时取消）', async () => {
        const batcher = new ReadBatcher(makeConn(), 20, 10);
        const cmd = makeCmd('(tblnext "LAYER" nil)');
        batcher.add(cmd);
        const err = new Error('CAD stalled');
        batcher.clear(err);
        expect(cmd.reject).toHaveBeenCalledWith(err);
        await new Promise(r => setTimeout(r, 60));
        expect(connQueue.enqueueHighPriority).not.toHaveBeenCalled();
    });

    it('cleans up dedup entries after batched commands are processed', async () => {
        const conn = {
            _platform: 'AutoCAD',
            _sendMessageInternal: vi.fn().mockResolvedValue({ success: true, result: '["(LINE)","(ARC)"]' }),
        };
        const q = new CommandQueue(conn);
        conn._commandQueue = q;
        q.enableBatcher();
        const c1 = { type: 'sendResult', code: '(ssget "_X" (list (cons 0 "LINE")))', platform: 'AutoCAD', encoding: '', resolve: vi.fn(), reject: vi.fn() };
        const c2 = { type: 'sendResult', code: '(ssget "_X" (list (cons 0 "ARC")))', platform: 'AutoCAD', encoding: '', resolve: vi.fn(), reject: vi.fn() };
        q.enqueue(c1);
        q.enqueue(c2);
        expect(q._dedupMap.size).toBe(2);
        await new Promise(r => setTimeout(r, 120));
        expect(q._dedupMap.size).toBe(0);
        expect(conn._sendMessageInternal).toHaveBeenCalledTimes(1);
        expect(c1.resolve).toHaveBeenCalled();
        expect(c2.resolve).toHaveBeenCalled();
    });

    it('CommandQueue.clear 同时清空批处理中的读命令（不再逃过快速失败）', async () => {
        const conn = {
            _platform: 'AutoCAD',
            _sendMessageInternal: vi.fn().mockResolvedValue({ success: true, result: '["nil"]' }),
        };
        const q = new CommandQueue(conn);
        conn._commandQueue = q;
        q.enableBatcher();
        const c1 = {
            type: 'sendResult', code: '(tblnext "LAYER" nil)', platform: 'AutoCAD',
            encoding: '', resolve: vi.fn(), reject: vi.fn(),
        };
        q.enqueue(c1);
        expect(q._batcher._batch.length).toBe(1);

        const err = new Error('CAD stalled');
        q.clear(err);

        expect(c1.reject).toHaveBeenCalledWith(err);
        expect(q._batcher._batch.length).toBe(0);
        expect(q._dedupMap.size).toBe(0);
        // 批次定时器已取消：冷却期内不会再把命令发往卡住的 CAD
        await new Promise(r => setTimeout(r, 120));
        expect(conn._sendMessageInternal).not.toHaveBeenCalled();
    });

  it('批处理同步 flush 后不会残留去重键（后续同码请求不能被吞）', async () => {
    const conn = {
      _platform: 'AutoCAD',
      _sendMessageInternal: vi.fn().mockResolvedValue({ success: true, result: '["nil"]' }),
    };
    const q = new CommandQueue(conn);
    conn._commandQueue = q;
    // maxBatchSize=1：add() 内同步 flush，暴露「flush 后再写回 dedupMap」的竞态
    q._batcher = new ReadBatcher(conn, 1000, 1);
    const make = () => ({
      type: 'sendResult', code: '(getvar "CLAYER")', platform: 'AutoCAD', encoding: '',
      resolve: vi.fn(), reject: vi.fn(),
    });
    const c1 = make();
    const c2 = make();
    q.enqueue(c1);
    q.enqueue(c2);
    await new Promise(r => setTimeout(r, 20));
    expect(conn._sendMessageInternal).toHaveBeenCalledTimes(2);
    expect(c1.resolve).toHaveBeenCalled();
    expect(c2.resolve).toHaveBeenCalled();
  });
});
