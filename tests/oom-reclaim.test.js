// 验证 OOM 修复的核心：HTTP MCP 会话与 agent context 是否真的被回收
// 用假定时器把 5 分钟清扫周期瞬间推进，无需真等
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// mcp-server-state.js 在模块加载时读取 config.sessionIdleTtl，
// 所以每个用例要先改 cfg 再 loadState() 重新加载。
const cfg = vi.hoisted(() => ({
  sessionIdleTtl: 2000,
  agentContextTtl: 2000,
  agentContextMaxSessions: 3,
  apiKey: '', port: 8110, host: '0.0.0.0', transport: 'http',
}));

vi.mock('../src/config.js', () => ({
  default: cfg,
  reloadConfig: () => true,
  getConfig: () => undefined,
  getAllConfig: () => ({}),
  onConfigChange: () => {},
}));

const MIN = 60 * 1000;

const agentCtx = await import('../src/agent-context.js');

const SWEEP = 5 * 60 * 1000;

// 模块级 _sweepTimer 在 useRealTimers() 后会变成失效句柄，
// 且 _ensureSweep() 见到非空就跳过重新注册 —— 所以每个用例重新加载模块。
async function loadState() {
  vi.resetModules();
  return import('../src/mcp-server-state.js');
}

function makeEntry() {
  return {
    server: { close: vi.fn(async () => {}), sendResourceUpdated: vi.fn(async () => {}) },
    transport: { onclose: null, close: vi.fn(async () => {}) },
  };
}

// 清扫定时器只在 getOrCreateSessionServer 内部启动（_ensureSweep 为私有），
// 所以先用真实创建路径启动一次，再批量注入假 entry 模拟 churn。
async function bootstrapSweep(state) {
  await state.getOrCreateSessionServer('bootstrap');
  state.removeSessionServer('bootstrap');
}

describe('MCP 会话空闲清扫（OOM 修复回归）', () => {
  let state;

  beforeEach(async () => {
    vi.useFakeTimers();
    cfg.sessionIdleTtl = 2000;
    state = await loadState();
    await bootstrapSweep(state);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('空闲超过 TTL 后会话被移除', async () => {
    const entry = makeEntry();
    state.sessionServers.set('s1', entry);
    state.sessionTransports.set('s1', entry.transport);
    state.touchSession('s1');
    expect(state.sessionServers.size).toBe(1);

    await vi.advanceTimersByTimeAsync(SWEEP + 5000);

    expect(state.sessionServers.size).toBe(0);
    expect(state.sessionTransports.has('s1')).toBe(false);
  });

  it('清扫会调用 transport.close 与 server.close 释放资源', async () => {
    const entry = makeEntry();
    state.sessionServers.set('s2', entry);
    state.touchSession('s2');

    await vi.advanceTimersByTimeAsync(SWEEP + 5000);

    expect(entry.transport.close).toHaveBeenCalled();
    expect(entry.server.close).toHaveBeenCalled();
  });

  it('持续活跃的会话不被清扫（TTL=30min 生产默认）', async () => {
    cfg.sessionIdleTtl = 30 * MIN;
    state = await loadState();
    await bootstrapSweep(state);
    const entry = makeEntry();
    state.sessionServers.set('s3', entry);
    state.touchSession('s3');
    // 每 30s 触碰一次，跨越多个 5min 清扫周期
    for (let i = 0; i < 12; i++) {
      state.touchSession('s3');
      await vi.advanceTimersByTimeAsync(30 * 1000);
    }
    expect(state.sessionServers.has('s3')).toBe(true);
  });

  it('TTL 小于清扫周期时实际回收周期被量化到 5min', async () => {
    // TTL=2s 但清扫每 5min 才跑一次 => 有效 TTL 是 5min，不是 2s
    const entry = makeEntry();
    state.sessionServers.set('q1', entry);
    state.touchSession('q1');

    await vi.advanceTimersByTimeAsync(SWEEP - 1000);
    expect(state.sessionServers.has('q1')).toBe(true);

    await vi.advanceTimersByTimeAsync(2000);
    expect(state.sessionServers.has('q1')).toBe(false);
  });

  it('removeSessionServer 清空 onclose 防止重入', () => {
    const entry = makeEntry();
    entry.transport.onclose = () => { throw new Error('不应被再次触发'); };
    state.sessionServers.set('s4', entry);
    state.removeSessionServer('s4');
    expect(entry.transport.onclose).toBeNull();
    expect(state.sessionServers.size).toBe(0);
  });

  it('批量 churn 200 会话后清扫收敛到 0（无无界增长）', async () => {
    for (let i = 0; i < 200; i++) {
      const entry = makeEntry();
      state.sessionServers.set(`churn-${i}`, entry);
      state.touchSession(`churn-${i}`);
    }
    expect(state.sessionServers.size).toBe(200);

    await vi.advanceTimersByTimeAsync(SWEEP + 5000);

    expect(state.sessionServers.size).toBe(0);
  });
});

describe('agent context 回收（OOM 修复回归）', () => {
  beforeEach(() => {
    agentCtx.stopContextSweep();
  });

  afterEach(() => {
    agentCtx.stopContextSweep();
    vi.useRealTimers();
  });

  it('超过上限时驱逐最旧会话（MAX_SESSIONS=3）', () => {
    for (let i = 0; i < 10; i++) {
      agentCtx.setContext(`ctx-${i}`, 'k', `v${i}`);
    }
    expect(agentCtx.getContext('ctx-9', 'k')).toBe('v9');
    expect(agentCtx.getContext('ctx-0', 'k')).toBeUndefined();
  });

  it('空闲超过 TTL 后上下文被清扫', async () => {
    vi.useFakeTimers();
    agentCtx.setContext('t-1', 'k', 'v');
    agentCtx.setContext('t-2', 'k', 'v');
    expect(agentCtx.listContext('t-1')).toEqual(['k']);

    await vi.advanceTimersByTimeAsync(SWEEP + 5000);

    expect(agentCtx.listContext('t-1')).toEqual([]);
    expect(agentCtx.getContext('t-2', 'k')).toBeUndefined();
  });

  it('deleteContext 删空内层后不留外层条目', () => {
    agentCtx.setContext('d1', 'k', 'v');
    agentCtx.setContext('d1', 'k2', 'v2');
    expect(agentCtx.deleteContext('d1', 'k')).toBe(true);
    expect(agentCtx.deleteContext('d1', 'k2')).toBe(true);
    // 外层条目已删除 -> listContext 返回空数组而非残留空 Map
    expect(agentCtx.listContext('d1')).toEqual([]);
    expect(agentCtx.getContext('d1', 'k')).toBeUndefined();
  });

  it('clearContext 清空该会话全部键', () => {
    agentCtx.setContext('c1', 'k1', 'v1');
    agentCtx.setContext('c1', 'k2', 'v2');
    expect(agentCtx.listContext('c1')).toHaveLength(2);
    agentCtx.clearContext('c1');
    expect(agentCtx.listContext('c1')).toEqual([]);
  });

  it('不存在会话的删除/清理不抛异常', () => {
    expect(agentCtx.deleteContext('ghost', 'k')).toBe(false);
    expect(() => agentCtx.clearContext('ghost')).not.toThrow();
  });
});
