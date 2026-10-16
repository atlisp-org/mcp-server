// cad-router.js 单测：模块加载时向 cad.js 注册 instance resolver，
// 这里捕获 resolver 并结合 mcpContext/pool mock 验证实例路由决策。
import { describe, it, expect, vi } from 'vitest';

const captured = vi.hoisted(() => ({ resolver: null }));
const poolMock = vi.hoisted(() => ({ getConnection: vi.fn() }));
const storeState = vi.hoisted(() => ({ value: undefined }));

vi.mock('../../src/cad.js', () => ({
  _setInstanceResolver: (fn) => { captured.resolver = fn; },
}));

vi.mock('../../src/cad-pool.js', () => ({
  pool: poolMock,
}));

vi.mock('../../src/mcp-server-state.js', () => ({
  mcpContext: { getStore: () => storeState.value },
}));

await import('../../src/cad-router.js');

describe('cad-router instance resolver', () => {
  it('模块加载时注册了 resolver', () => {
    expect(typeof captured.resolver).toBe('function');
  });

  it('无 AsyncLocalStorage 上下文 → null（不路由）', () => {
    storeState.value = undefined;
    expect(captured.resolver()).toBeNull();
    expect(poolMock.getConnection).not.toHaveBeenCalled();
  });

  it('上下文无 instanceKey/_toolInstance → null', () => {
    storeState.value = { sessionId: 's1' };
    expect(captured.resolver()).toBeNull();
  });

  it('_toolInstance 优先于 instanceKey', () => {
    const conn = { name: 'conn-a' };
    poolMock.getConnection.mockReturnValueOnce(conn);
    storeState.value = { _toolInstance: 'inst-a', instanceKey: 'inst-b' };
    expect(captured.resolver()).toBe(conn);
    expect(poolMock.getConnection).toHaveBeenCalledWith('inst-a');
  });

  it('回退到 instanceKey', () => {
    const conn = { name: 'conn-b' };
    poolMock.getConnection.mockReturnValueOnce(conn);
    storeState.value = { instanceKey: 'inst-b' };
    expect(captured.resolver()).toBe(conn);
    expect(poolMock.getConnection).toHaveBeenCalledWith('inst-b');
  });

  it('pool 中不存在该实例 → null', () => {
    poolMock.getConnection.mockReturnValueOnce(undefined);
    storeState.value = { instanceKey: 'missing' };
    expect(captured.resolver()).toBeNull();
  });
});
