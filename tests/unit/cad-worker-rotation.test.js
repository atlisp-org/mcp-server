import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/config.js', () => ({
  default: {
    messageTimeout: 1000,
    cadCommandTimeout: 1000,
    stallCooldown: 5000,
    heartbeatPingTimeout: 200,
    heartbeatInterval: 30000,
    workerPoolSize: 1,
    busyRetries: 0,
    busyDelay: 0,
  },
  getConfig: () => null,
}));

vi.mock('../../src/metrics.js', () => ({ setCadConnected: vi.fn() }));

const logError = vi.fn();
vi.mock('../../src/logger.js', () => ({
  error: (...args) => logError(...args),
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  log: vi.fn(),
}));

// 每次调用返回不同 requestId，避免在途请求互相覆盖
let uuidSeq = 0;
vi.mock('crypto', () => ({
  randomUUID: () => `req-${++uuidSeq}`,
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    connected: true,
    _requestCount: 0,
    stdin: { write: vi.fn() },
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
  })),
}));

const { createCadConnection } = await import('../../src/cad.js');

// 与 src/cad.js 保持一致
const MAX_REQUESTS_PER_WORKER = 100;

function makeWorker() {
  return {
    connected: true,
    _workerType: 'primary',
    _requestCount: 0,
    _needsRotation: false,
    stdin: { write: vi.fn() },
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
  };
}

let conn;
let worker;

function dispatch(msg, noCircuitBreaker = false) {
  const promise = conn._sendMessageInternal(msg, noCircuitBreaker, 10000);
  const entry = [...conn._pendingRequests.values()].pop();
  return { promise, entry };
}

// 派发一个外部请求并立即成功完成，触发完成时的轮换检查
function sendExternal(code = '(princ 1)') {
  const { promise, entry } = dispatch({ type: 'send', code });
  entry.resolve({ success: true });
  return promise;
}

// 派发一个内部请求（心跳等）并立即完成
function sendInternal(msg) {
  const { promise, entry } = dispatch(msg, true);
  entry.resolve({ success: true });
  return promise;
}

function thresholdLogs() {
  return logError.mock.calls.filter((c) => String(c[0]).includes('达到最大请求数'));
}

describe('worker 轮换计数（外部请求计算，内部请求不计）', () => {
  beforeEach(() => {
    uuidSeq = 0;
    logError.mockClear();
    conn = createCadConnection();
    worker = makeWorker();
    conn._primaryWorker = worker;
  });

  afterEach(() => {
    for (const e of conn._pendingRequests.values()) clearTimeout(e.timeout);
    conn._pendingRequests.clear();
    if (conn._heartbeatTimer) {
      clearInterval(conn._heartbeatTimer);
      conn._heartbeatTimer = null;
    }
  });

  it('外部请求计入计数，达到阈值时标记并在完成时轮换', () => {
    conn._rotateWorker = vi.fn();

    for (let i = 0; i < MAX_REQUESTS_PER_WORKER - 1; i++) sendExternal();
    expect(worker._requestCount).toBe(MAX_REQUESTS_PER_WORKER - 1);
    expect(worker._needsRotation).toBe(false);
    expect(thresholdLogs()).toHaveLength(0);

    sendExternal();
    expect(worker._requestCount).toBe(MAX_REQUESTS_PER_WORKER);
    expect(thresholdLogs()).toHaveLength(1);
    expect(conn._rotateWorker).toHaveBeenCalledTimes(1);
    expect(conn._rotateWorker).toHaveBeenCalledWith(worker);
  });

  it('心跳/内部请求不计入轮换计数，也不会触发轮换', () => {
    conn._rotateWorker = vi.fn();

    for (let i = 0; i < 150; i++) sendInternal({ type: 'ping' });
    for (let i = 0; i < 150; i++) sendInternal({ type: 'getActiveDocInfo' });

    expect(worker._requestCount).toBe(0);
    expect(worker._needsRotation).toBe(false);
    expect(thresholdLogs()).toHaveLength(0);
    expect(conn._rotateWorker).not.toHaveBeenCalled();
  });

  it('大量内部请求穿插时，仍恰在第 100 个外部请求触发（计数不漂移到 249）', () => {
    for (let i = 0; i < MAX_REQUESTS_PER_WORKER - 1; i++) sendExternal();

    // 模拟长时间运行的命令期间堆积的心跳
    for (let i = 0; i < 149; i++) sendInternal({ type: 'ping' });

    expect(worker._requestCount).toBe(MAX_REQUESTS_PER_WORKER - 1);

    conn._rotateWorker = vi.fn();
    sendExternal();

    // 修复前这里会打印「已处理 249 个请求」
    expect(worker._requestCount).toBe(MAX_REQUESTS_PER_WORKER);
    expect(conn._rotateWorker).toHaveBeenCalledTimes(1);
  });

  it('跨越阈值后重复请求只记录一次阈值日志', () => {
    // 桩住轮换，保留旧 worker，验证 _needsRotation 一次性标记不会重复刷日志
    conn._rotateWorker = vi.fn();

    for (let i = 0; i < MAX_REQUESTS_PER_WORKER + 5; i++) sendExternal();

    expect(worker._requestCount).toBe(MAX_REQUESTS_PER_WORKER + 5);
    expect(thresholdLogs()).toHaveLength(1);
  });

  it('_rotateWorker 清除旧 worker 的轮换标记，避免在途请求重复触发', () => {
    const old = makeWorker();
    old._needsRotation = true;
    conn._primaryWorker = old;

    conn._rotateWorker(old);

    expect(old._needsRotation).toBe(false);
    expect(old.kill).toHaveBeenCalled();
    expect(conn._primaryWorker).not.toBe(old);
  });
});
