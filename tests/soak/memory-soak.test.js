// 内存防回归 soak 测试：守护 10 月修复的两处常驻进程 4GB 堆 OOM
// （HTTP MCP 会话与 agent context 泄漏，见 src/mcp-server-state.js、src/session-transport.js、
//   src/sse-session-manager.js、src/agent-context.js）。
//
// 判定方式（两道防线，避免 CI 抖动误报）：
//   1. 状态容器必须回落到空 —— 泄漏一定表现为 Map/Set 单调增长，这是确定性信号；
//   2. 强制 GC 后对比「warmup 首轮」与「末轮」的 heapUsed，阈值留足余量（有 GC 时 <50MB）。
// 同时断言「引用型定时器数量不增长」——SessionTransport 的 30 分钟清理定时器与
// SseSession 的心跳定时器都是 ref'd setInterval，泄漏会让进程无法退出。
//
// 覆盖路径：
//   1. HTTP MCP 会话生命周期 ×800（mcp-server-state + session-transport，OOM 主因）
//   2. SSE 会话创建/销毁 ×600（sse-session-manager：心跳定时器 + 重放缓冲 + 轻量会话）
//   3. agent-context 创建/释放 ×500（外层 Map 必须随清空删除）
//   4. CAD 实例切换路由 ×100（cad-router + cad-pool，mock CAD：只注入未连接的连接对象，
//      永不 connect、永不 spawn worker，任何平台都不依赖真实 CAD）
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import v8 from 'node:v8';
import vm from 'node:vm';

// cad-pool 静态引入 cad-rot-helper → edge-js（.NET ROT 枚举，仅 Windows 有意义）。
// 本文件只测会话路由部分，mock 掉 cad-rot-helper，使 soak 在任何 Linux/CI 环境
// 都不依赖 edge-js 能否加载（本机验证过 edge-js 在 Linux 可加载，仅打印 CoreCLR 警告，
// 但 mock 后 soak 完全独立于该环境变量）。
vi.mock('../../src/cad-rot-helper.js', () => ({
  discoverCadInstances: async () => [],
}));

import {
  getOrCreateSessionServer,
  removeSessionServer,
  sessionServers,
  sessionTransports,
  mcpContext,
} from '../../src/mcp-server-state.js';
import { SseSessionManager } from '../../src/sse-session-manager.js';
import { SseSession } from '../../src/sse-session.js';
import {
  setContext,
  getContext,
  clearContext,
  listContext,
  stopContextSweep,
} from '../../src/agent-context.js';
import { pool } from '../../src/cad-pool.js';
import '../../src/cad-router.js';
import { createCadConnection, resolveCadConnection } from '../../src/cad.js';

// ===== 全局 fetch mock 为拒绝（仓库约定：soak 不触网，见 tests/resource.test.js） =====
const originalFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = vi.fn(() => Promise.reject(new Error('fetch disabled in soak tests')));
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  stopContextSweep();
});

// ===== 强制 GC（Node 下 v8 flag 技巧；不可用时退化为宽松阈值） =====
let collectGarbage = null;
try {
  v8.setFlagsFromString('--expose_gc');
  const gcFromVm = vm.runInNewContext('gc');
  v8.setFlagsFromString('--no-expose_gc');
  if (typeof gcFromVm === 'function') collectGarbage = gcFromVm;
} catch {
  collectGarbage = null;
}

const MB = 1024 * 1024;
// 有强制 GC 时用 50MB（GC 后残余确定性高，余量很足）；
// 环境不支持 --expose_gc 技巧时退化为 300MB，避免未回收垃圾造成误报。
const HEAP_LIMIT_MB = collectGarbage ? 50 : 300;

async function heapAfterGc() {
  if (collectGarbage) collectGarbage();
  await new Promise((resolve) => setTimeout(resolve, 30));
  if (collectGarbage) collectGarbage();
  return process.memoryUsage().heapUsed;
}

/** 引用型（未 unref）定时器数量——泄漏的清理/心跳定时器会体现在这里 */
function refTimerCount() {
  return process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
}

/**
 * 统一 soak 轮次：warmup → 快照（堆 + 定时器）→ 剩余轮次 → 复测 → 断言有界。
 * @param {{label: string, warmup: number, total: number, run: (i: number) => Promise<void>}} opts
 */
async function runSoak({ label, warmup, total, run }) {
  for (let i = 0; i < warmup; i++) await run(i);
  const timersBefore = refTimerCount();
  const before = await heapAfterGc();
  for (let i = warmup; i < total; i++) await run(i);
  const after = await heapAfterGc();
  const timersAfter = refTimerCount();

  const growthMb = (after - before) / MB;
  expect(
    growthMb,
    `${label}: 堆增长 ${growthMb.toFixed(1)}MB 超过阈值 ${HEAP_LIMIT_MB}MB（疑似泄漏）`
  ).toBeLessThan(HEAP_LIMIT_MB);
  expect(
    timersAfter,
    `${label}: 引用型定时器数量增长（${timersBefore} → ${timersAfter}，疑似清理定时器未释放）`
  ).toBeLessThanOrEqual(timersBefore);

  return { growthMb, timersBefore, timersAfter };
}

describe('内存防回归 soak（4GB OOM 修复）', () => {
  it('HTTP MCP 会话创建/销毁 ×800：会话容器回空且堆增长有界', async () => {
    const TOTAL = 800;
    const WARMUP = 50;

    const cycle = async (i) => {
      const sessionId = `soak-http-${i}`;
      const { transport } = await getOrCreateSessionServer(sessionId);
      // 走一遍真实 initialize 握手，覆盖 SessionTransport 的请求/超时定时器路径
      const resp = await transport.handleRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'memory-soak', version: '1.0.0' },
        },
      });
      if (i === 0) {
        expect(resp?.result?.serverInfo?.name).toBeTruthy();
      }
      removeSessionServer(sessionId);
      // removeSessionServer 触发的是异步 close，等一个宏任务让 server/transport 收尾
      await new Promise((resolve) => setImmediate(resolve));
      // 回归信号 #1：销毁后容器必须立即回落（而不是等 30 分钟 TTL 清扫）
      expect(sessionServers.size).toBe(0);
      expect(sessionTransports.size).toBe(0);
    };

    await runSoak({ label: 'HTTP MCP 会话', warmup: WARMUP, total: TOTAL, run: cycle });

    expect(sessionServers.size).toBe(0);
    expect(sessionTransports.size).toBe(0);
  }, 30000);

  it('transport.close() 自身清理 session Map（OOM 修复核心，不能只依赖 TTL 清扫）', async () => {
    const sessionId = 'soak-onclose-self-clean';
    const { transport } = await getOrCreateSessionServer(sessionId);
    expect(sessionServers.has(sessionId)).toBe(true);
    // 模拟 routes.js 每次请求后的 resetCleanupTimer（30 分钟 ref'd 定时器）
    transport.resetCleanupTimer();
    expect(transport._cleanupTimer).toBeTruthy();

    await transport.close();

    expect(sessionServers.has(sessionId)).toBe(false);
    expect(sessionTransports.has(sessionId)).toBe(false);
    expect(transport._cleanupTimer).toBeNull();
    expect(transport._pendingRequests.size).toBe(0);
  }, 10000);

  it('SSE 会话创建/销毁 ×600：心跳定时器与重放缓冲释放且堆增长有界', async () => {
    const TOTAL = 600;
    const WARMUP = 50;
    const BIG_PAYLOAD = 'x'.repeat(64 * 1024);
    const manager = new SseSessionManager();

    const mockRes = () => ({
      setHeader() {},
      write() { return true; },
      flush() {},
      on() {},
      removeListener() {},
      end() {},
    });

    const cycle = async (i) => {
      const clientId = `soak-sse-${i}`;
      // 轻量会话（routes.handleMcpPost 的 createSession 路径）
      manager.createSession(clientId);
      expect(manager.hasSession(clientId)).toBe(true);

      // 完整 SSE 会话（/sse 路径）：add() 会启动心跳 setInterval（ref'd）
      const session = new SseSession(mockRes(), { clientId });
      manager.add(clientId, session);
      // 每条会话塞 4×64KB 重放数据：若 close()/cleanup 不释放，堆阈值一定被打穿
      for (let k = 0; k < 4; k++) session.sendMessage({ payload: BIG_PAYLOAD });

      session.close();              // 心跳定时器 + 重放缓冲必须在此释放
      manager.removeSession(clientId); // 轻量会话条目必须可删除
      manager.cleanupInactive();

      expect(manager.count()).toBe(0);
      expect(manager.hasSession(clientId)).toBe(false);
    };

    await runSoak({ label: 'SSE 会话', warmup: WARMUP, total: TOTAL, run: cycle });

    expect(manager.count()).toBe(0);
    manager.closeAll(); // 停掉自身的清扫定时器
  }, 30000);

  it('agent-context 创建/释放 ×500：外层 Map 随清空删除且堆增长有界', async () => {
    const TOTAL = 500;
    const WARMUP = 50;
    // 128KB 载荷 ×500 ≈ 64MB：若 clearContext 不删外层条目（10 月泄漏形状），
    // 持有引用的 Map 会让阈值 50MB 被确定性打穿。
    const makePayload = (i) => `x${i}:` + 'x'.repeat(128 * 1024);

    const cycle = async (i) => {
      const sessionId = `soak-ctx-${i}`;
      setContext(sessionId, 'payload', { blob: makePayload(i) });
      expect(getContext(sessionId, 'payload')).toBeTruthy();
      expect(listContext(sessionId)).toEqual(['payload']);

      clearContext(sessionId);
      // 回归信号 #2：外层条目必须随内层清空一起删除（Map 单调增长 = 4GB OOM 根因）
      expect(listContext(sessionId)).toEqual([]);
    };

    await runSoak({ label: 'agent-context', warmup: WARMUP, total: TOTAL, run: cycle });
  }, 30000);

  it('CAD 实例切换 ×100（mock CAD）：路由命中且连接池状态有界', async () => {
    const TOTAL = 100;
    const WARMUP = 10;

    // mock CAD：直接注入「未连接」的 CadConnection，从不调用 connect()
    // （CadConnection 构造函数不 spawn worker；Linux 下 connect() 本身返回 false），
    // 因此本用例任何平台都不会拉起真实 CAD。
    const makeEntry = (key) => ({
      key,
      connection: createCadConnection(),
      connected: false,
      lastPing: Date.now(),
      createdAt: Date.now(),
      label: key,
      autoReconnect: false,
    });
    pool['_instances'].set('soak-a', makeEntry('soak-a'));
    pool['_instances'].set('soak-b', makeEntry('soak-b'));
    pool.setActive('soak-a');

    const cycle = async (i) => {
      const key = i % 2 === 0 ? 'soak-a' : 'soak-b';
      pool.setActive(key);
      // 两条路由入口都要覆盖：工具参数 instance（_toolInstance）与会话级 instanceKey
      const ctx = i % 4 < 2 ? { _toolInstance: key } : { instanceKey: key };
      await mcpContext.run(ctx, async () => {
        expect(resolveCadConnection()).toBe(pool.getConnection(key));
      });
      // 无上下文时回退到 active 连接
      expect(resolveCadConnection()).toBe(pool.getConnection(key));
      expect(pool.getStats().total).toBe(2);
    };

    await runSoak({ label: 'CAD 实例切换', warmup: WARMUP, total: TOTAL, run: cycle });

    expect(pool.getStats().total).toBe(2);
    await pool.disconnectAll();
    expect(pool.getStats().total).toBe(0);
    expect(pool.getStats().active).toBeNull();
  }, 30000);
});
