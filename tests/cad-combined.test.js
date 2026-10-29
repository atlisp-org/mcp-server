import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';

process.env.MESSAGE_TIMEOUT = '200';
process.env.CAD_COMMAND_TIMEOUT = '80';
process.env.STALL_COOLDOWN = '5000';
process.env.HEARTBEAT_PING_TIMEOUT = '100';

vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid'),
}));

const mockWorker = {
  connected: true,
  stdin: { write: vi.fn(), on: vi.fn() },
  stdout: { on: vi.fn(), off: vi.fn() },
  stderr: { on: vi.fn() },
  kill: vi.fn(),
  on: vi.fn(),
};

vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal()),
  spawn: vi.fn(() => mockWorker),
}));

const { cad } = await import('../src/cad.js');

let lastDataHandler = null;

function captureHandler() {
  mockWorker.stdout.on.mockImplementation((event, fn) => {
    if (event === 'data') lastDataHandler = fn;
  });
  // 已有 worker 不会重复注册，回退到最近一次注册的 handler
  return () => lastDataHandler;
}

function mockResponse(data) {
  return Buffer.from(JSON.stringify({ ...data, requestId: 'test-uuid' }) + '\n');
}

/** 取最近注册的 worker 'exit' 处理器 */
function getExitHandler() {
  const calls = mockWorker.on.mock.calls.filter(([e]) => e === 'exit');
  return calls[calls.length - 1]?.[1];
}

async function connectOk() {
  const getHandler = captureHandler();
  const p = cad.connect();
  const handler = getHandler();
  handler(mockResponse({ success: true, platform: 'AutoCAD', version: '24.0' }));
  await p;
}

describe('组合场景：停滞 × 熔断 × Worker 重启', () => {
  let origPlatform;

  beforeEach(() => {
    origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    vi.clearAllMocks();
    cad._reset();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: origPlatform });
  });

  it('worker 连续崩溃 5 次 → 熔断打开 → 下一条命令触发自动恢复并重启 worker', async () => {
    await connectOk();
    const killsBefore = mockWorker.kill.mock.calls.length;
    const writesBefore = mockWorker.stdin.write.mock.calls.length;

    // 连续 5 次主 worker 退出 → 每次记一次失败 → 达到阈值熔断打开
    const exit = getExitHandler();
    expect(exit).toBeTruthy();
    for (let i = 0; i < 5; i++) exit(1);

    // 熔断打开后发送命令：不应快速失败，而是走自动恢复路径
    // （重置熔断器 → 杀掉旧 worker → 重新拉起），随后消息正常写入新 worker 并最终超时
    const sendPromise = cad.sendCommandWithResult('(+ 1 2)');
    await expect(sendPromise).rejects.toThrow('停滞');

    // 验证走了恢复路径：worker 被重启（kill）且消息确实写入了 stdin
    expect(mockWorker.kill.mock.calls.length).toBeGreaterThan(killsBefore);
    expect(mockWorker.stdin.write.mock.calls.length).toBeGreaterThan(writesBefore);
  }, 5000);

  it('命令在途时 worker 退出 → 挂起请求立即被拒绝并调度退避重启', async () => {
    await connectOk();
    const spawnsBefore = spawn.mock.calls.length;

    const pending = cad.sendCommandWithResult('(princ "in-flight")');
    const exit = getExitHandler();
    exit(1);

    await expect(pending).rejects.toThrow('Primary worker exited');

    // 退避重启（首次延迟 1s）后应重新拉起 worker
    await vi.waitFor(
      () => expect(spawn.mock.calls.length).toBeGreaterThan(spawnsBefore),
      { timeout: 4000, interval: 50 }
    );
  }, 8000);

  it('停滞冷却期内快速失败不触碰 worker，成功连接后恢复正常', async () => {
    await connectOk();

    // 制造一次超时停滞
    const p1 = cad.sendCommandWithResult('(+ 1 2)');
    await expect(p1).rejects.toThrow('停滞');
    expect(cad.isStalled()).toBe(true);

    // 冷却期内所有命令快速失败，不产生任何 stdin 写入
    const writesAfterStall = mockWorker.stdin.write.mock.calls.length;
    await expect(cad.sendCommand('(princ "a")')).rejects.toThrow('停滞');
    await expect(cad.sendCommandWithResult('(+ 1 1)')).rejects.toThrow('停滞');
    expect(mockWorker.stdin.write.mock.calls.length).toBe(writesAfterStall);

    // 成功连接清除停滞状态（在下一个监控周期前立即断言）
    await connectOk();
    expect(cad.isStalled()).toBe(false);
    expect(cad.getStallInfo().stalled).toBe(false);
  }, 5000);
});
