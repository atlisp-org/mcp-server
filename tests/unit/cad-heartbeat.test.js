import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { spawnCalls } = vi.hoisted(() => ({ spawnCalls: [] }));

vi.mock('../../src/config.js', () => ({
  default: {
    messageTimeout: 1000,
    cadCommandTimeout: 1000,
    stallCooldown: 5000,
    heartbeatPingTimeout: 200,
    heartbeatInterval: 15000,
    heartbeatWarmupMs: 15000,
    heartbeatResetCooldown: 60000,
    workerPoolSize: 1,
    busyRetries: 0,
    busyDelay: 0,
  },
  getConfig: () => null,
}));

vi.mock('../../src/metrics.js', () => ({ setCadConnected: vi.fn() }));

const { logError, logWarn } = vi.hoisted(() => ({ logError: vi.fn(), logWarn: vi.fn() }));
vi.mock('../../src/logger.js', () => ({
  error: (...args) => logError(...args),
  warn: (...args) => logWarn(...args),
  info: vi.fn(),
  debug: vi.fn(),
  log: vi.fn(),
}));

vi.mock('crypto', () => ({ randomUUID: () => 'req-1' }));

vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const handlers = {};
    const w = {
      connected: true,
      _workerType: 'primary',
      _requestCount: 0,
      stdin: { write: vi.fn(), on: vi.fn() },
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event, fn) => { handlers[event] = fn; }),
      kill: vi.fn(),
      _handlers: handlers,
    };
    spawnCalls.push(w);
    return w;
  }),
}));

const { createCadConnection } = await import('../../src/cad.js');

const INTERVAL = 15000;
const WARMUP = 15000;
const RESET_COOLDOWN = 60000;

let conn;

function makeLiveWorker(overrides = {}) {
  return {
    connected: true,
    _workerType: 'primary',
    _requestCount: 0,
    _warmupUntil: 0,
    stdin: { write: vi.fn(), on: vi.fn() },
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
    ...overrides,
  };
}

function callsOfType(type) {
  return conn._sendMessageInternal.mock.calls.filter(([msg]) => msg.type === type);
}

describe('CAD 心跳：区分「忙」与「死」', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    logError.mockClear();
    logWarn.mockClear();
    spawnCalls.length = 0;
    conn = createCadConnection();
  });

  afterEach(() => {
    if (conn._heartbeatTimer) {
      clearInterval(conn._heartbeatTimer);
      conn._heartbeatTimer = null;
    }
    for (const entry of conn._pendingRequests.values()) clearTimeout(entry.timeout);
    conn._pendingRequests.clear();
    conn._resetWorker();
    vi.useRealTimers();
  });

  it('没有 worker 时心跳不探测、也不负责拉起 worker', async () => {
    conn._sendMessageInternal = vi.fn();
    conn._startHeartbeat();

    await vi.advanceTimersByTimeAsync(INTERVAL * 3 + 10);

    expect(conn._sendMessageInternal).not.toHaveBeenCalled();
    expect(spawnCalls).toHaveLength(0);
    expect(conn._primaryWorker).toBeNull();
  });

  it('新 worker 预热期内 ping 超时不计失败', async () => {
    conn._primaryWorker = makeLiveWorker({ _warmupUntil: Date.now() + WARMUP });
    conn._sendMessageInternal = vi.fn().mockRejectedValue(new Error('Timeout waiting for worker'));
    conn._resetWorker = vi.fn();
    conn._startHeartbeat();

    // 预热期内（不足 WARMUP）：一次探测都不发
    await vi.advanceTimersByTimeAsync(INTERVAL - 1);
    expect(conn._sendMessageInternal).not.toHaveBeenCalled();

    // 越过预热期：开始探测，但这时才可能累计失败
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(conn._sendMessageInternal).toHaveBeenCalled();
    expect(conn._resetWorker).not.toHaveBeenCalled();
  });

  it('worker 正在执行真实命令时跳过 ping，不会判死', async () => {
    conn._primaryWorker = makeLiveWorker();
    conn._sendMessageInternal = vi.fn().mockRejectedValue(new Error('Timeout waiting for worker'));
    conn._resetWorker = vi.fn();
    conn._pendingRequests.set('cmd-1', {
      resolve: vi.fn(),
      reject: vi.fn(),
      timeout: setTimeout(() => {}, 60000),
      _isCommand: true,
      _startedAt: Date.now(),
    });
    conn._startHeartbeat();

    await vi.advanceTimersByTimeAsync(INTERVAL * 4 + 10);

    expect(conn._sendMessageInternal).not.toHaveBeenCalled();
    expect(conn._resetWorker).not.toHaveBeenCalled();
    expect(logWarn.mock.calls.some((c) => String(c[0]).includes('跳过'))).toBe(true);
  });

  it('连续 3 次 ping 超时才重启 worker', async () => {
    conn._primaryWorker = makeLiveWorker();
    conn._sendMessageInternal = vi.fn().mockRejectedValue(new Error('Timeout waiting for worker'));
    conn._resetWorker = vi.fn();
    conn._startHeartbeat();

    await vi.advanceTimersByTimeAsync(INTERVAL * 2 + 10);
    expect(conn._resetWorker).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(conn._resetWorker).toHaveBeenCalledTimes(1);
  });

  it('重启冷却期内不重复重启，只记 WARN', async () => {
    conn._primaryWorker = makeLiveWorker();
    conn._sendMessageInternal = vi.fn().mockRejectedValue(new Error('Timeout waiting for worker'));
    conn._resetWorker = vi.fn();
    conn._lastWorkerResetAt = Date.now();
    conn._startHeartbeat();

    await vi.advanceTimersByTimeAsync(INTERVAL * 3 + 10);

    expect(conn._resetWorker).not.toHaveBeenCalled();
    expect(logWarn.mock.calls.some((c) => String(c[0]).includes('暂不重启'))).toBe(true);

    // 冷却期结束后仍可恢复自动重启
    await vi.advanceTimersByTimeAsync(RESET_COOLDOWN);
    expect(conn._resetWorker).toHaveBeenCalled();
  });

  it('CAD 侧监控可用时不再轮询文档', async () => {
    conn._primaryWorker = makeLiveWorker();
    conn._platform = 'AutoCAD';
    conn._monitorStarted = true;
    conn._sendMessageInternal = vi.fn().mockResolvedValue({ pong: true });
    conn._startHeartbeat();

    await vi.advanceTimersByTimeAsync(INTERVAL + 10);

    expect(callsOfType('ping')).toHaveLength(1);
    expect(callsOfType('getActiveDocInfo')).toHaveLength(0);
  });

  it('监控不可用时轮询文档，失败后进入冷却避免堆积', async () => {
    conn._primaryWorker = makeLiveWorker();
    conn._platform = 'AutoCAD';
    conn._monitorStarted = false;
    conn._sendMessageInternal = vi.fn(async (msg) => {
      if (msg.type === 'ping') return { pong: true };
      throw new Error('Timeout waiting for worker');
    });
    conn._startHeartbeat();

    await vi.advanceTimersByTimeAsync(INTERVAL + 10);
    expect(callsOfType('getActiveDocInfo')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(callsOfType('getActiveDocInfo')).toHaveLength(1);
  });

  it('主动退出（轮换/重置）不写 ERROR 日志', () => {
    const w = conn._spawnWorker('primary');
    conn._primaryWorker = w;
    w._intentionalExit = true;

    w._handlers.exit(null);

    const exitLogs = logError.mock.calls.filter((c) => String(c[0]).includes('exited with code'));
    expect(exitLogs).toHaveLength(0);
    expect(logWarn.mock.calls.some((c) => String(c[0]).includes('按预期退出'))).toBe(true);
  });

  it('非主动退出仍然写 ERROR 日志', () => {
    const w = conn._spawnWorker('primary');
    conn._primaryWorker = w;

    w._handlers.exit(1);

    const exitLogs = logError.mock.calls.filter((c) => String(c[0]).includes('exited with code'));
    expect(exitLogs).toHaveLength(1);
  });
});
