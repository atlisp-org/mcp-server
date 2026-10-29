// CAD 阻塞场景下的稳定性：
//   1. 探测类消息（ping/isBusy/hasdoc/healthCheck 等）超时不计熔断、不触发自动恢复——
//      否则 CAD 阻塞期间托盘/监控的高频探测会把熔断器打到 OPEN，反复杀 worker、打断在途命令；
//   2. 熔断 OPEN 时的自动恢复有冷却限频（与心跳共用 _lastWorkerResetAt 窗口）：
//      冷却期内快速失败 CAD_BUSY，不重复杀 worker。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawn } from 'node:child_process';

vi.mock('../../src/config.js', () => ({
  default: {
    messageTimeout: 1000,
    cadCommandTimeout: 1000,
    stallCooldown: 5000,
    heartbeatPingTimeout: 200,
    heartbeatInterval: 15000,
    heartbeatWarmupMs: 15000,
    heartbeatResetCooldown: 60000,
    // 测试里每次推进 31s 触发退避，宽限期放大到 60s 才不会被误判为「已经正常运行过」
    workerBootGraceMs: 60000,
    workerPoolSize: 1,
    busyRetries: 0,
    busyDelay: 0,
  },
  getConfig: () => null,
}));

vi.mock('../../src/metrics.js', () => ({ setCadConnected: vi.fn() }));
vi.mock('../../src/logger.js', () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  log: vi.fn(),
}));
vi.mock('crypto', () => ({ randomUUID: () => 'stab-1' }));
vi.mock('child_process', () => ({ spawn: vi.fn() }));

const { createCadConnection } = await import('../../src/cad.js');

const MESSAGE_TIMEOUT = 1000;
const RESET_COOLDOWN = 60000;

function makeSilentWorker() {
  // 永不响应：模拟 CAD 阻塞时 worker 卡在 COM 调用里
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
  };
}

describe('探测消息与熔断器', () => {
  let conn;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    conn = createCadConnection();
    conn._primaryWorker = makeSilentWorker();
  });

  afterEach(() => {
    for (const entry of conn._pendingRequests.values()) clearTimeout(entry.timeout);
    conn._pendingRequests.clear();
    vi.useRealTimers();
  });

  it.each(['ping', 'isBusy', 'hasdoc', 'healthCheck', 'getActiveDocInfo', 'startMonitor'])(
    '探测 %s 超时（worker 无响应）不计入熔断器', async (type) => {
      const p = conn._sendMessage({ type });
      await vi.advanceTimersByTimeAsync(MESSAGE_TIMEOUT + 10);
      await expect(p).rejects.toThrow('Timeout waiting for worker');
      expect(conn._cb.failureCount).toBe(0);
      expect(conn._cb.state).toBe(0); // CB_CLOSED
    }
  );

  it('真实命令（send）超时仍计入熔断器（对照）', async () => {
    for (let i = 0; i < 5; i++) {
      const p = conn._sendMessage({ type: 'send', code: `(princ "${i}")` });
      await vi.advanceTimersByTimeAsync(MESSAGE_TIMEOUT + 10);
      // 非 ping 的超时会标记停滞，reject 的是 stall 错误
      await expect(p).rejects.toThrow(/超时|停滞/);
    }
    expect(conn._cb.failureCount).toBe(5);
    expect(conn._cb.state).toBe(1); // CB_OPEN
  });

  it('熔断 OPEN 时探测消息不触发自动恢复（不杀 worker）', async () => {
    for (let i = 0; i < 5; i++) conn._cb.recordFailure();
    const resetSpy = vi.spyOn(conn, '_resetWorker');

    const p = conn._sendMessage({ type: 'ping' });
    // 直接写进 worker 而不是走自动恢复
    expect(resetSpy).not.toHaveBeenCalled();
    expect(conn._primaryWorker.stdin.write).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(MESSAGE_TIMEOUT + 10);
    await expect(p).rejects.toThrow('Timeout waiting for worker');
    expect(resetSpy).not.toHaveBeenCalled();
    // 探测超时也不增加失败计数
    expect(conn._cb.failureCount).toBe(5);
  });
});

describe('熔断自动恢复的冷却限频', () => {
  let conn;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    conn = createCadConnection();
    conn._primaryWorker = makeSilentWorker();
  });

  afterEach(() => {
    for (const entry of conn._pendingRequests.values()) clearTimeout(entry.timeout);
    conn._pendingRequests.clear();
    vi.useRealTimers();
  });

  it('_resetWorker 统一记录重置时间戳', () => {
    expect(conn._lastWorkerResetAt).toBe(0);
    conn._resetWorker();
    expect(conn._lastWorkerResetAt).toBe(Date.now());
  });

  it('熔断 OPEN 且处于冷却期：真实命令快速失败 CAD_BUSY，不重复杀 worker', async () => {
    for (let i = 0; i < 5; i++) conn._cb.recordFailure();
    const resetSpy = vi.spyOn(conn, '_resetWorker');
    conn._lastWorkerResetAt = Date.now(); // 刚刚重置过

    const p = conn._sendMessage({ type: 'send', code: '(princ 1)' });
    await expect(p).rejects.toMatchObject({ code: 'CAD_BUSY' });
    expect(resetSpy).not.toHaveBeenCalled();
  });

  it('熔断 OPEN 且冷却期已过：仍执行自动恢复（杀 worker + 重建）', async () => {
    for (let i = 0; i < 5; i++) conn._cb.recordFailure();
    conn._lastWorkerResetAt = Date.now() - RESET_COOLDOWN - 1;
    const worker = conn._primaryWorker;
    conn._getWorker = vi.fn().mockReturnValue(worker); // 同步方法

    const p = conn._sendMessage({ type: 'send', code: '(princ 1)' });
    await vi.advanceTimersByTimeAsync(MESSAGE_TIMEOUT + 10);

    expect(conn._getWorker).toHaveBeenCalled();
    expect(worker.kill).toHaveBeenCalled(); // 自动恢复确实重建了 worker
    await expect(p).rejects.toThrow(/超时|停滞/);
  });
});

// worker 启动即退出（edge-js 原生模块/CLR 初始化失败、Node ABI 不匹配等）时，
// 如果 spawn 成功就清零重启计数，MAX_RESTART_ATTEMPTS 永远达不到、退避永远停在
// 第一档 —— 变成 500ms 一次的无限重生（实测 3 小时 9644 次）。
describe('worker 启动失败的重启上限', () => {
  let conn;

  function makeBootFailWorker() {
    return {
      connected: true,
      _workerType: 'primary',
      _requestCount: 0,
      _warmupUntil: 0,
      stdin: { write: vi.fn(), on: vi.fn() },
      stdout: { on: vi.fn(), off: vi.fn() },
      stderr: { on: vi.fn() },
      kill: vi.fn(),
      _handlers: {},
      on(event, fn) { this._handlers[event] = fn; return this; },
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    spawn.mockImplementation(() => makeBootFailWorker());
    conn = createCadConnection();
    conn._primaryWorker = null;
  });

  afterEach(() => {
    conn._resetWorker();
    vi.useRealTimers();
  });

  it('连续「启动即退出」时重启次数有上限，不会无限重生', async () => {
    conn._getWorker(false); // 首次 spawn
    expect(spawn.mock.calls.length).toBe(1);

    let last = null;
    for (let i = 0; i < 30; i++) {
      const w = conn._primaryWorker;
      if (w && w !== last) {
        last = w;
        w._handlers.exit?.(1, null); // 启动后立刻退出（存活 < 启动宽限期）
      }
      await vi.advanceTimersByTimeAsync(31000); // 走完退避（最大 30s）
    }

    // 1 次初始 spawn + 最多 MAX_RESTART_ATTEMPTS(10) 次自动重启，之后放弃
    expect(conn._restartCount).toBe(10);
    expect(spawn.mock.calls.length).toBe(11);
  });

  it('_getWorker 重新 spawn 不再清零启动失败计数', () => {
    conn._restartCount = 5;
    conn._getWorker(false);
    expect(conn._restartCount).toBe(5);
  });

  it('worker 正常回话后清零启动失败计数', async () => {
    let dataHandler = null;
    const w = makeSilentWorker();
    w.stdout.on.mockImplementation((event, fn) => {
      if (event === 'data') dataHandler = fn;
    });
    spawn.mockImplementation(() => w);
    conn._primaryWorker = null;
    conn._restartCount = 7;

    const p = conn._sendMessageInternal({ type: 'ping' }, true);
    expect(typeof dataHandler).toBe('function');
    dataHandler(Buffer.from(JSON.stringify({ pong: true, requestId: 'stab-1' }) + '\n'));
    await p;

    expect(conn._restartCount).toBe(0);
  });
});
