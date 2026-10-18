// cad.js 与插件钩子的接线测试：CAD 连接/断开时触发 onCadConnected / onCadDisconnected。
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { callPluginHook } = vi.hoisted(() => ({ callPluginHook: vi.fn() }));

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
vi.mock('../../src/logger.js', () => ({
  error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), log: vi.fn(),
}));
vi.mock('../../src/plugin-loader.js', () => ({ callPluginHook }));
vi.mock('crypto', () => ({ randomUUID: () => 'req-1' }));
vi.mock('child_process', () => ({ spawn: vi.fn() }));

const { createCadConnection } = await import('../../src/cad.js');

describe('cad 插件钩子', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('连接成功触发 onCadConnected', async () => {
    const conn = createCadConnection();
    conn.isAvailable = () => true;
    conn._sendMessage = vi.fn(async () => ({ success: true, platform: 'AutoCAD', version: '2026.1' }));
    await conn.connect();
    expect(callPluginHook).toHaveBeenCalledWith('onCadConnected', {
      platform: 'AutoCAD', version: '2026.1',
    });
  });

  it('已连接状态下 _reset 触发 onCadDisconnected，未连接时不触发', () => {
    const conn = createCadConnection();
    conn._resetWorker = vi.fn();
    conn._commandQueue.clear = vi.fn();

    conn._reset('disconnect');
    expect(callPluginHook).not.toHaveBeenCalledWith('onCadDisconnected', expect.anything());

    conn.connected = true;
    conn._reset('disconnect');
    expect(callPluginHook).toHaveBeenCalledWith('onCadDisconnected', { reason: 'disconnect' });
  });

  it('disconnect() 传入 disconnect 原因', async () => {
    const conn = createCadConnection();
    conn._resetWorker = vi.fn();
    conn._commandQueue.clear = vi.fn();
    conn.connected = true;
    await conn.disconnect();
    expect(callPluginHook).toHaveBeenCalledWith('onCadDisconnected', { reason: 'disconnect' });
  });
});
