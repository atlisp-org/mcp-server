// HTTP 传输 e2e：启动真实 Express 服务器（src/routes.js 的 setupRoutes 可编程入口，
// PORT=0 随机端口），覆盖两条此前从未被 e2e 覆盖的传输路径：
//   A. 默认多会话 /mcp（routes.js 自研 SessionTransport —— 10 月 OOM 修复所在）
//      原始 fetch 完成：initialize 握手 → tools/list（cursor 分页）→ 不依赖 CAD 的工具调用 → 关闭
//   B. streamable-http（SDK StreamableHTTPServerTransport + SDK StreamableHTTPClientTransport）
//
// 沿用 tests/e2e/ 的环境约定：无 CAD 环境（docker e2e 的容器里也没有 CAD）——
// 本文件从不调用 cad.connect()，CadConnection 构造不 spawn worker，Linux 下
// connect() 直接返回 false，因此不需要 docker、不需要真实 CAD 即可随 npm test 运行。
// 全局 fetch 按仓库约定 mock 为「默认拒绝」，仅放行本文件启动的 127.0.0.1 回环地址。
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// 审计落盘 mock 掉：e2e 只验证协议链路，不应写 ~/@lisp/logs/audit.log
vi.mock('../../src/audit-log.js', () => ({
  writeAuditEntry: vi.fn(),
  queryAuditLog: vi.fn(() => ({ total: 0, offset: 0, count: 0, entries: [] })),
  getAuditStats: vi.fn(() => ({})),
  AUDIT_FILE: '/dev/null',
}));

// routes → cad-pool 会静态引入 cad-rot-helper → edge-js（.NET ROT，仅 Windows 有意义）。
// 本 e2e 从不调用 CAD 发现/连接，mock 掉使其完全不依赖 edge-js 能否在本机加载。
vi.mock('../../src/cad-rot-helper.js', () => ({
  discoverCadInstances: async () => [],
}));

import config from '../../src/config.js';
import { setupRoutes } from '../../src/routes.js';
import {
  initStreamableHttpServer,
  setupStreamableHttpRoutes,
  closeStreamableHttpServer,
} from '../../src/streamable-http.js';
import { sessionServers, sessionTransports, removeSessionServer } from '../../src/mcp-server-state.js';
import { sessionManager } from '../../src/subscription-manager.js';
import { getVisibleTools } from '../../src/tools/index.js';

// ===== 全局 fetch：默认拒绝，仅放行本文件启动的回环地址 =====
const originalFetch = globalThis.fetch;
const allowedOrigins = [];

beforeAll(() => {
  // 测试环境不写请求日志/审计文件，也不带任何 API Key（鉴权走"未配置→admin"分支）
  config.requestLogEnabled = false;
  config.apiKey = '';
  config.apiKeys = [];

  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : String(input.url ?? input);
    if (allowedOrigins.some((origin) => url.startsWith(origin))) {
      return originalFetch(input, init);
    }
    return Promise.reject(new Error(`fetch disabled in e2e tests: ${url}`));
  };
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  sessionManager.closeAll();
});

function listen(server, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

async function closeServer(server) {
  if (!server || !server.listening) return;
  const closed = new Promise((resolve) => server.close(resolve));
  // 强制断开 keep-alive 连接，否则 server.close 回调永远不会触发
  server.closeAllConnections?.();
  await closed;
  // close 回调触发时底层句柄往往还没同步释放（一两个 tick 后才退出 active 列表），
  // 轮询等待，避免「无悬挂句柄」断言因时序误报
  for (let i = 0; i < 100 && activeCount('TCPServerWrap') > 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function activeCount(type) {
  return process.getActiveResourcesInfo().filter((h) => h === type).length;
}

// ============================================================
// A. 默认多会话 /mcp（原始 JSON-RPC over HTTP）
// ============================================================
describe.sequential('HTTP e2e：默认多会话 /mcp 传输', () => {
  let server;
  let baseUrl;
  let sessionId;

  beforeAll(async () => {
    const app = express();
    // registerMcpRoutes 默认 true → 注册真实的 /mcp 多会话路由
    setupRoutes(app);
    server = http.createServer(app);
    const port = await listen(server);
    baseUrl = `http://127.0.0.1:${port}`;
    allowedOrigins.push(baseUrl);
    sessionId = randomUUID();
  });

  afterAll(async () => {
    for (const sid of [...sessionServers.keys()]) removeSessionServer(sid);
    await closeServer(server);
  });

  async function rpc(body) {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'mcp-session-id': sessionId,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  it('initialize 握手成功并建立服务端会话', async () => {
    const { status, body } = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'http-e2e', version: '1.0.0' },
      },
    });

    expect(status).toBe(200);
    expect(body.result.protocolVersion).toBeTruthy();
    expect(body.result.serverInfo.name).toBeTruthy();
    expect(body.result.capabilities).toBeTruthy();

    // 完成 initialized 通知（与 docker e2e 一致）
    const init = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(init.status).toBe(200);

    expect(sessionServers.has(sessionId)).toBe(true);
    expect(sessionTransports.has(sessionId)).toBe(true);
  }, 15000);

  it('tools/list 支持 cursor 分页且不重不漏', async () => {
    const visible = getVisibleTools().length;
    expect(visible).toBeGreaterThan(0);

    const seen = [];
    let cursor;
    let pages = 0;
    do {
      const { status, body } = await rpc({
        jsonrpc: '2.0',
        id: 10 + pages,
        method: 'tools/list',
        params: cursor ? { cursor } : {},
      });
      expect(status).toBe(200);
      expect(Array.isArray(body.result.tools)).toBe(true);
      expect(body.result.tools.length).toBeGreaterThan(0);
      expect(body.result.tools.length).toBeLessThanOrEqual(100);
      for (const tool of body.result.tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.inputSchema).toBeTruthy();
      }
      seen.push(...body.result.tools.map((t) => t.name));
      cursor = body.result.nextCursor;
      pages++;
    } while (cursor && pages < 20);

    // 全量翻页：与服务端可见工具集完全一致（不重、不漏）
    expect(seen.length).toBe(visible);
    expect(new Set(seen).size).toBe(visible);
    if (visible > 100) {
      expect(pages).toBeGreaterThan(1);
      expect(cursor).toBeUndefined();
    }
  }, 15000);

  it('调用不依赖 CAD 的工具 search_tools', async () => {
    const { status, body } = await rpc({
      jsonrpc: '2.0',
      id: 99,
      method: 'tools/call',
      params: { name: 'search_tools', arguments: { query: '图层' } },
    });

    expect(status).toBe(200);
    expect(body.result.isError).toBeFalsy();
    expect(Array.isArray(body.result.content)).toBe(true);
    expect(body.result.content[0].text).toContain('工具');
  }, 15000);

  it('关闭：会话清理、服务器干净退出、无悬挂句柄', async () => {
    const transport = sessionTransports.get(sessionId);
    expect(transport).toBeTruthy();

    const timersBefore = activeCount('Timeout');
    expect(timersBefore).toBeGreaterThan(0); // 30 分钟清理定时器此刻应当存在

    removeSessionServer(sessionId);

    expect(sessionServers.size).toBe(0);
    expect(sessionTransports.size).toBe(0);
    expect(transport._closed).toBe(true);
    // 30 分钟清理定时器必须被清掉（否则常驻进程无法退出/句柄堆积）
    expect(transport._cleanupTimer).toBeNull();
    expect(transport._pendingRequests.size).toBe(0);

    await closeServer(server);
    expect(server.listening).toBe(false);
    expect(activeCount('TCPServerWrap')).toBe(0);
    expect(activeCount('Timeout')).toBeLessThanOrEqual(timersBefore);

    // 端口已释放：新的连接必须被拒绝
    await expect(fetch(`${baseUrl}/health`)).rejects.toThrow();
  }, 15000);
});

// ============================================================
// B. streamable-http（SDK 服务端 transport + SDK 客户端 transport）
// ============================================================
describe.sequential('HTTP e2e：streamable-http 传输（SDK 客户端）', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    await initStreamableHttpServer();
    const app = express();
    // 与 atlisp-mcp.js 的 streamable-http 模式一致：/mcp 交给 SDK transport 注册
    setupRoutes(app, { registerMcpRoutes: false });
    setupStreamableHttpRoutes(app);
    server = http.createServer(app);
    const port = await listen(server);
    baseUrl = `http://127.0.0.1:${port}`;
    allowedOrigins.push(baseUrl);
  });

  afterAll(async () => {
    await closeStreamableHttpServer().catch(() => {});
    await closeServer(server);
  });

  it('SDK 客户端完成 initialize → tools/list → search_tools', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      fetch: globalThis.fetch,
    });
    const client = new Client(
      { name: 'http-e2e-streamable', version: '1.0.0' },
      { capabilities: {} }
    );
    await client.connect(transport);

    const listed = await client.listTools();
    expect(listed.tools.length).toBeGreaterThan(0);
    expect(listed.tools.some((t) => t.name === 'search_tools')).toBe(true);

    // cursor 分页在服务端是同一套 mcp-handlers 逻辑，这里验证客户端透传 cursor 可用
    const visible = getVisibleTools().length;
    if (visible > 100) {
      const page1 = await client.listTools();
      expect(page1.nextCursor).toBeTruthy();
      const page2 = await client.listTools({ cursor: page1.nextCursor });
      const names1 = new Set(page1.tools.map((t) => t.name));
      expect(page2.tools.some((t) => names1.has(t.name))).toBe(false);
    }

    const result = await client.callTool({
      name: 'search_tools',
      arguments: { query: 'line' },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result)).toContain('工具');

    await client.close();
  }, 20000);

  it('关闭：SDK transport 与服务器干净退出、无悬挂句柄', async () => {
    await closeStreamableHttpServer();
    await closeServer(server);

    expect(server.listening).toBe(false);
    expect(activeCount('TCPServerWrap')).toBe(0);
    await expect(fetch(`${baseUrl}/health`)).rejects.toThrow();
  }, 15000);
});
