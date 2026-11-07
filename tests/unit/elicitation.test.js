import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import config from '../../src/config.js';
import {
  confirmDestructive,
  clearElicitationCache,
  elicitationEnabled,
  elicitationMode,
} from '../../src/elicitation.js';

function fakeServer(overrides = {}) {
  return {
    getClientCapabilities: () => ({ elicitation: {} }),
    elicitInput: vi.fn(async () => ({ action: 'accept', content: { confirm: true } })),
    ...overrides,
  };
}

const originalMode = config.elicitationMode;

beforeEach(() => {
  clearElicitationCache();
  config.elicitationMode = 'destructive';
});

afterEach(() => {
  config.elicitationMode = originalMode;
  clearElicitationCache();
});

describe('elicitation', () => {
  it('默认 off：直接跳过，不调用客户端', async () => {
    config.elicitationMode = 'off';
    const server = fakeServer();
    const result = await confirmDestructive(server, { toolName: 'batch_delete', isDestructive: true });
    expect(result.action).toBe('skip');
    expect(server.elicitInput).not.toHaveBeenCalled();
    expect(elicitationEnabled()).toBe(false);
    expect(elicitationMode()).toBe('off');
  });

  it('destructive 模式只拦截破坏性工具', async () => {
    const server = fakeServer();
    expect((await confirmDestructive(server, { toolName: 'get_cad_info', isDestructive: false })).action).toBe('skip');
    expect(server.elicitInput).not.toHaveBeenCalled();
  });

  it('all 模式拦截非只读工具', async () => {
    config.elicitationMode = 'all';
    const server = fakeServer();
    const result = await confirmDestructive(server, { toolName: 'draw_line', isDestructive: false });
    expect(result.action).toBe('accepted');
    expect(server.elicitInput).toHaveBeenCalledOnce();
  });

  it('客户端不支持 elicitation：降级放行', async () => {
    const server = fakeServer({ getClientCapabilities: () => ({}) });
    const result = await confirmDestructive(server, { toolName: 'batch_delete', isDestructive: true });
    expect(result.action).toBe('unavailable');
    expect(server.elicitInput).not.toHaveBeenCalled();
  });

  it('用户确认：返回 accepted 并缓存，同一操作不重复弹窗', async () => {
    const server = fakeServer();
    const first = await confirmDestructive(server, {
      toolName: 'batch_delete', args: { handles: ['A1'] }, isDestructive: true, sessionId: 's1',
    });
    expect(first.action).toBe('accepted');

    const second = await confirmDestructive(server, {
      toolName: 'batch_delete', args: { handles: ['A1'] }, isDestructive: true, sessionId: 's1',
    });
    expect(second.action).toBe('accepted');
    expect(server.elicitInput).toHaveBeenCalledOnce();
  });

  it('用户取消确认：返回 declined，且不缓存', async () => {
    const server = fakeServer({
      elicitInput: vi.fn(async () => ({ action: 'decline' })),
    });
    const args = { toolName: 'batch_delete', args: { handles: ['A1'] }, isDestructive: true, sessionId: 's2' };
    expect((await confirmDestructive(server, args)).action).toBe('declined');
    expect((await confirmDestructive(server, args)).action).toBe('declined');
    expect(server.elicitInput).toHaveBeenCalledTimes(2);
  });

  it('accept 但 confirm 不为 true：视为拒绝', async () => {
    const server = fakeServer({ elicitInput: vi.fn(async () => ({ action: 'accept', content: {} })) });
    const result = await confirmDestructive(server, { toolName: 'batch_delete', isDestructive: true });
    expect(result.action).toBe('declined');
  });

  it('请求抛错（旧客户端/超时）：降级放行而非阻断', async () => {
    const server = fakeServer({
      elicitInput: vi.fn(async () => { throw new Error('Method not found'); }),
    });
    const result = await confirmDestructive(server, { toolName: 'batch_delete', isDestructive: true });
    expect(result.action).toBe('unavailable');
  });
});
