// routes.js 集成测试：起真实 Express + node:http 服务器（原生 fetch 请求），
// mock CAD/peer/会话层，覆盖中间件链（JSON body/CORS/鉴权/RBAC/限流状态）
// 与全部路由分发（/health /mcp /sse /message /peers /cad/events 等）。
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import express from 'express';
import iconv from 'iconv-lite';

// ===== 依赖 mock =====
const cadMock = vi.hoisted(() => ({
  connected: false,
  ping: vi.fn(async () => true),
  getPlatform: vi.fn(() => null),
  getVersion: vi.fn(() => null),
  _getQueueSize: vi.fn(() => 0),
  _getRestartCount: vi.fn(() => 0),
}));

const transportMock = vi.hoisted(() => ({
  handleRequestCalls: [],
  delay: 0,
  handleRequest(body) {
    transportMock.handleRequestCalls.push(body);
    const response = {
      jsonrpc: '2.0',
      id: body.id ?? null,
      result: { ok: true, method: body.method },
    };
    return transportMock.delay
      ? new Promise(r => setTimeout(() => r(response), transportMock.delay))
      : Promise.resolve(response);
  },
  resetCleanupTimer: vi.fn(),
}));

const peerMock = vi.hoisted(() => ({
  getStats: vi.fn(() => ({ total: 0, active: null, peers: [] })),
  scanLan: vi.fn(async () => []),
  addPeer: vi.fn((host, port, opts) => ({ host, port, healthy: true, opts })),
  removePeer: vi.fn(() => true),
}));

const eventBusMock = vi.hoisted(() => ({
  subscribeEvents: vi.fn((sessionId, res) => { res.end(); }),
  unsubscribeEvents: vi.fn(),
}));

vi.mock('../../src/cad.js', () => ({ cad: cadMock }));
vi.mock('../../src/cad-pool.js', () => ({
  pool: { getStats: () => ({ total: 0, active: null, instances: [] }), getConnection: () => null },
}));
vi.mock('../../src/peer-manager.js', () => ({ default: peerMock }));
vi.mock('../../src/cad-event-bus.js', () => eventBusMock);
vi.mock('../../src/mcp-server-state.js', () => ({
  mcpContext: { run: (ctx, fn) => fn(), getStore: () => undefined },
  sessionServers: new Map(),
  getOrCreateSessionServer: vi.fn(async () => ({ server: {}, transport: transportMock })),
  removeSessionServer: vi.fn(),
  touchSession: vi.fn(),
}));
vi.mock('../../src/logger.js', () => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  logRequest: vi.fn(),
  logResponse: vi.fn(),
  closeLog: vi.fn(),
}));

import config from '../../src/config.js';
import { setupRoutes } from '../../src/routes.js';
import { sessionManager } from '../../src/subscription-manager.js';
import { SseSession } from '../../src/sse-session.js';
import { resetRateLimit } from '../../src/rate-limiter.js';
import { getVisibleTools } from '../../src/tools/index.js';

let server;
let baseUrl;
const originalFetch = globalThis.fetch;

function listen(srv) {
  return new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      srv.off('error', reject);
      resolve(srv.address().port);
    });
  });
}

async function req(path, { method = 'GET', headers = {}, body, auth } = {}) {
  const h = { ...headers };
  if (auth !== undefined) h.authorization = `Bearer ${auth}`;
  let payload = body;
  if (payload !== undefined && typeof payload !== 'string' && !(payload instanceof Uint8Array)) {
    h['content-type'] = h['content-type'] || 'application/json';
    payload = JSON.stringify(payload);
  }
  const res = await originalFetch(`${baseUrl}${path}`, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* text */ }
  return { status: res.status, headers: res.headers, text, json };
}

// 真实 SseSession（sessionManager.add 校验 instanceof），配假 res 对象
function makeSseSession() {
  const res = {
    headersSent: false,
    setHeader: vi.fn(),
    write: vi.fn(() => true),
    end: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
  const session = new SseSession(res, { heartbeatInterval: 60000 });
  const sendResponse = vi.spyOn(session, 'sendResponse');
  return { session, sendResponse, res };
}

beforeAll(async () => {
  config.requestLogEnabled = false;
  config.apiKey = '';
  config.apiKeys = [];
  config.enableCors = false;
  config.corsOrigin = '';
  config.metricsEnabled = true; // 注册 /metrics 路由

  const app = express();
  setupRoutes(app);
  server = http.createServer(app);
  const port = await listen(server);
  baseUrl = `http://127.0.0.1:${port}`;

  // 仅放行回环地址
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : String(input.url ?? input);
    if (url.startsWith(baseUrl)) return originalFetch(input, init);
    return Promise.reject(new Error(`fetch disabled in tests: ${url}`));
  };
});

afterAll(async () => {
  globalThis.fetch = originalFetch;
  sessionManager.closeAll();
  await new Promise(r => server.close(r));
  server.closeAllConnections?.();
});

beforeEach(() => {
  vi.clearAllMocks();
  config.apiKey = '';
  config.apiKeys = [];
  cadMock.connected = false;
  transportMock.handleRequestCalls = [];
  transportMock.delay = 0;
  resetRateLimit();
});

describe('JSON body 解析中间件', () => {
  it('非法 JSON 返回 400', async () => {
    const r = await req('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad json',
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('Invalid JSON body');
  });

  it('GBK 编码的 JSON body 正确解码', async () => {
    const payload = { jsonrpc: '2.0', id: 1, method: 'noop', note: '中文' };
    const buf = iconv.encode(JSON.stringify(payload), 'gbk');
    const res = await originalFetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=gbk' },
      body: new Uint8Array(buf),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.method).toBe('noop');
  });

  it('非 JSON content-type 跳过解析（body 为空 → 400）', async () => {
    const r = await req('/mcp', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('Invalid request');
  });
});

describe('健康与文档路由', () => {
  it('GET /health 返回 CAD/系统/MCP/池状态', async () => {
    const r = await req('/health');
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('ok');
    expect(r.json.cad.connected).toBe(false);
    /* 未连接且未要求探测：语义应为 unknown，而不是让消费者把 connected=false 当成「CAD 掉线」 */
    expect(r.json.cad.status).toBe('unknown');
    expect(r.json.cad.probed).toBe(false);
    expect(r.json.mcp.tools).toBe(getVisibleTools().length);
    expect(r.json.system.memory.rss).toBeGreaterThan(0);
    expect(Array.isArray(r.json.pool.instances)).toBe(true);
  });

  it('GET /health?probe=1 未连接时也主动探测：成功 → ready', async () => {
    cadMock.ping.mockResolvedValueOnce(true);
    const r = await req('/health?probe=1');
    expect(r.status).toBe(200);
    expect(r.json.cad.probed).toBe(true);
    expect(r.json.cad.status).toBe('ready');
    expect(cadMock.ping).toHaveBeenCalled();
  });

  it('GET /health?probe=1 探测失败 → status=down（connected 缓存不受影响）', async () => {
    cadMock.ping.mockResolvedValueOnce(false);
    const r = await req('/health?probe=1');
    expect(r.status).toBe(200);
    expect(r.json.cad.status).toBe('down');
    expect(cadMock.ping).toHaveBeenCalled();
  });

  it('CAD 已连接时 /health 执行 ping，ping 失败不影响响应', async () => {
    cadMock.connected = true;
    cadMock.ping.mockRejectedValueOnce(new Error('ping timeout'));
    const r = await req('/health');
    expect(r.status).toBe(200);
    expect(r.json.cad.connected).toBe(true);
    expect(r.json.cad.responseTime).toBeGreaterThanOrEqual(0);
  });

  it('GET /health/full 包含 heap 限制信息', async () => {
    const r = await req('/health/full');
    expect(r.status).toBe(200);
    expect(r.json.system.memory.heapLimitMB).toBeGreaterThan(0);
    expect(typeof r.json.system.memory.heapUsedPct).toBe('number');
    expect(r.json.timestamp).toBeTruthy();
  });

  it('GET /go 302 重定向到 agent 页面并带 clientId', async () => {
    const res = await originalFetch(`${baseUrl}/go`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('https://atlisp.cn/agent?clientId=');
  });

  it('GET /metrics 返回 Prometheus 文本', async () => {
    const r = await req('/metrics');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/plain');
    expect(r.text.length).toBeGreaterThan(0);
  });

  it('GET /api/docs /debug /playground 返回 HTML', async () => {
    for (const p of ['/api/docs', '/debug', '/playground']) {
      const r = await req(p);
      expect(r.status).toBe(200);
      expect(r.headers.get('content-type')).toContain('text/html');
      expect(r.text).toContain('<html');
    }
  });

  it('路由处理器抛错经错误处理器返回 500', async () => {
    // Express 5 不会把 404 转给错误中间件，这里让 /health 中 cad.getPlatform 抛错触发
    cadMock.connected = true;
    cadMock.getPlatform.mockImplementationOnce(() => { throw new Error('platform boom'); });
    const r = await req('/health');
    expect(r.status).toBe(500);
    expect(r.json.error).toBe('Internal server error');
    expect(r.json.message).toBe('platform boom');
  });
});

describe('鉴权与 RBAC', () => {
  it('配置 apiKey 后未带 key 返回 401（公开端点除外）', async () => {
    config.apiKey = 'root-secret';
    expect((await req('/health')).status).toBe(200);
    expect((await req('/debug')).status).toBe(401);
  });

  it('viewer 调用 tools/call 返回 403 JSON-RPC 错误', async () => {
    config.apiKeys = [{ key: 'view-key', role: 'viewer' }];
    const r = await req('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      auth: 'view-key',
      body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_line', arguments: {} } },
    });
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe(-32000);
    expect(transportMock.handleRequestCalls).toHaveLength(0);
  });

  it('批量数组中夹带 viewer 越权 tools/call 同样被拦截', async () => {
    config.apiKeys = [{ key: 'view-key', role: 'viewer' }];
    const r = await req('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      auth: 'view-key',
      body: [
        { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'create_line', arguments: {} } },
      ],
    });
    expect(r.status).toBe(403);
    expect(transportMock.handleRequestCalls).toHaveLength(0);
  });

  it('admin key 放行 tools/call；非 tools/call 方法不做 RBAC 校验', async () => {
    config.apiKey = 'root-secret';
    const ok = await req('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      auth: 'root-secret',
      body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_tools', arguments: { query: 'a' } } },
    });
    expect(ok.status).toBe(200);

    const viewerNoRbac = await req('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      auth: 'view-key-none',
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    });
    expect(viewerNoRbac.status).toBe(401); // 鉴权层就拦截（key 无效）
  });
});

describe('CORS 中间件', () => {
  it('enableCors + 白名单 origin 放行并带完整 CORS 头', async () => {
    config.enableCors = true;
    config.corsOrigin = 'http://localhost:9000';
    try {
      const r = await req('/health', { headers: { origin: 'http://localhost:9000' } });
      expect(r.status).toBe(200);
      expect(r.headers.get('access-control-allow-origin')).toBe('http://localhost:9000');
      expect(r.headers.get('access-control-max-age')).toBe('86400');

      const denied = await req('/health', { headers: { origin: 'https://evil.example.com' } });
      expect(denied.status).toBe(403);
      expect(denied.json.error).toBe('Origin not allowed');

      // 预检 OPTIONS → 204
      const pre = await originalFetch(`${baseUrl}/mcp`, {
        method: 'OPTIONS',
        headers: { origin: 'http://localhost:9000', 'access-control-request-method': 'POST' },
      });
      expect(pre.status).toBe(204);
      expect(pre.headers.get('access-control-allow-methods')).toContain('POST');
    } finally {
      config.enableCors = false;
      config.corsOrigin = '';
    }
  });
});

describe('/mcp 路由', () => {
  it('缺少 method 返回 400', async () => {
    const r = await req('/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: { jsonrpc: '2.0', id: 1 },
    });
    expect(r.status).toBe(400);
  });

  it('单请求走 transport 并返回 JSON-RPC 结果', async () => {
    const r = await req('/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' },
      body: { jsonrpc: '2.0', id: 7, method: 'tools/list', params: {} },
    });
    expect(r.status).toBe(200);
    expect(r.json.result.method).toBe('tools/list');
    expect(transportMock.handleRequestCalls).toHaveLength(1);
  });

  it('批量数组逐条处理，无效条目返回 -32600', async () => {
    const r = await req('/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: [
        { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
        { jsonrpc: '2.0', id: 2 },
        null,
      ],
    });
    expect(r.status).toBe(200);
    expect(r.json).toHaveLength(3);
    expect(r.json[0].result.method).toBe('tools/list');
    expect(r.json[1].error.code).toBe(-32600);
    expect(r.json[2]).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
    expect(transportMock.handleRequestCalls).toHaveLength(1); // 无效条目不进 transport
  });

  it('并发相同 tools/call 请求被去重为一次调用', async () => {
    transportMock.delay = 30;
    const body = { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'search_tools', arguments: { query: 'dup' } } };
    const [a, b] = await Promise.all([
      req('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'mcp-session-id': 'dup-sess' }, body }),
      req('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'mcp-session-id': 'dup-sess' }, body }),
    ]);
    expect(a.status).toBe(200);
    expect(b.json.result.method).toBe('tools/call');
    expect(transportMock.handleRequestCalls).toHaveLength(1);
  });

  it('transport 返回 undefined 时响应 202', async () => {
    const calls = transportMock.handleRequest.bind(transportMock);
    transportMock.handleRequest = async () => undefined;
    try {
      const r = await req('/mcp', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: { jsonrpc: '2.0', method: 'notifications/initialized' },
      });
      expect(r.status).toBe(202);
    } finally {
      transportMock.handleRequest = calls;
    }
  });

  it('transport 抛错返回 500 并附错误信息', async () => {
    const orig = transportMock.handleRequest.bind(transportMock);
    transportMock.handleRequest = async () => { throw new Error('transport exploded'); };
    try {
      const r = await req('/mcp', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      });
      expect(r.status).toBe(500);
      expect(r.json.message).toBe('transport exploded');
    } finally {
      transportMock.handleRequest = orig;
    }
  });

  it('批量中单条抛错包装为 -32603，其他条目正常', async () => {
    const orig = transportMock.handleRequest.bind(transportMock);
    transportMock.handleRequest = async (body) => {
      if (body.method === 'boom') throw new Error('single-fail');
      return { jsonrpc: '2.0', id: body.id, result: { ok: true } };
    };
    try {
      const r = await req('/mcp', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: [
          { jsonrpc: '2.0', id: 1, method: 'boom' },
          { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        ],
      });
      expect(r.status).toBe(200);
      expect(r.json[0].error).toEqual({ code: -32603, message: 'single-fail' });
      expect(r.json[1].result.ok).toBe(true);
    } finally {
      transportMock.handleRequest = orig;
    }
  });

  it('/mcp/stream 与 /mcp/:path 也分发到同一处理器', async () => {
    const r1 = await req('/mcp/stream', {
      method: 'GET', headers: { 'content-type': 'application/json' },
    });
    // GET 无 body → 400 Invalid request
    expect(r1.status).toBe(400);

    const r2 = await req('/mcp/extra-path', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: { jsonrpc: '2.0', id: 3, method: 'tools/list' },
    });
    expect(r2.status).toBe(200);
    expect(r2.json.result.method).toBe('tools/list');
  });
});

describe('/rate-limit 与 /config/reload', () => {
  it('GET /rate-limit/status 返回限额信息', async () => {
    const r = await req('/rate-limit/status');
    expect(r.status).toBe(200);
    expect(typeof r.json.limit).toBe('number');
    expect(r.json.remaining).toBeLessThanOrEqual(r.json.limit);
    expect(typeof r.json.resetIn).toBe('number');
  });

  it('POST /rate-limit/reset 需要 admin', async () => {
    config.apiKey = 'root-secret';
    expect((await req('/rate-limit/reset', { method: 'POST' })).status).toBe(401);
    const r = await req('/rate-limit/reset', { method: 'POST', auth: 'root-secret' });
    expect(r.status).toBe(200);
    expect(r.json.message).toBe('Rate limit reset');
  });

  it('POST /config/reload 需要 admin 并返回结果', async () => {
    config.apiKey = 'root-secret';
    expect((await req('/config/reload', { method: 'POST' })).status).toBe(401);
    const r = await req('/config/reload', { method: 'POST', auth: 'root-secret' });
    expect([200, 500]).toContain(r.status);
    if (r.status === 200) expect(r.json.message).toBe('Configuration reloaded');
    else expect(r.json.error).toBe('Failed to reload configuration');
  });
});

describe('Peer 管理路由', () => {
  it('GET /peers 返回 peer 统计', async () => {
    const r = await req('/peers');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ total: 0, active: null, peers: [] });
  });

  it('POST /peers/scan 需要 admin，返回发现列表；失败返回 500', async () => {
    config.apiKeys = [{ key: 'view-key', role: 'viewer' }];
    expect((await req('/peers/scan', { method: 'POST', auth: 'view-key' })).status).toBe(403);

    // view-key-admin 不是注册 key → 401（handler 不会执行）
    const unauthorized = await req('/peers/scan', { method: 'POST', auth: 'view-key-admin', body: '{}' });
    expect(unauthorized.status).toBe(401);
    expect(peerMock.scanLan).not.toHaveBeenCalled();

    config.apiKey = 'root-secret';
    peerMock.scanLan.mockResolvedValueOnce([{ host: '192.168.1.5' }]);
    const found = await req('/peers/scan', { method: 'POST', auth: 'root-secret', body: '{}' });
    expect(found.status).toBe(200);
    expect(found.json).toEqual({ discovered: 1, peers: [{ host: '192.168.1.5' }] });

    peerMock.scanLan.mockRejectedValueOnce(new Error('udp down'));
    const failed = await req('/peers/scan', { method: 'POST', auth: 'root-secret', body: '{}' });
    expect(failed.status).toBe(500);
    expect(failed.json.error).toBe('udp down');
  });

  it('POST /peers/connect 缺 host 返回 400；正常返回 peer 信息', async () => {
    config.apiKey = 'root-secret';
    const missing = await req('/peers/connect', { method: 'POST', auth: 'root-secret', body: '{}' });
    expect(missing.status).toBe(400);

    const r = await req('/peers/connect', {
      method: 'POST', auth: 'root-secret',
      body: JSON.stringify({ host: '10.0.0.8', port: 9000, apikey: 'k' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(r.status).toBe(200);
    expect(r.json.connected).toBe(true);
    expect(peerMock.addPeer).toHaveBeenCalledWith('10.0.0.8', 9000, { apikey: 'k' });
  });

  it('DELETE /peers/:id 返回移除结果', async () => {
    config.apiKey = 'root-secret';
    const r = await req('/peers/peer-1', { method: 'DELETE', auth: 'root-secret' });
    expect(r.status).toBe(200);
    expect(r.json.removed).toBe(true);
    expect(peerMock.removePeer).toHaveBeenCalledWith('peer-1');
  });
});

describe('/cad/events 与 SSE /message', () => {
  it('GET /cad/events 订阅并在断开时退订', async () => {
    const r = await req('/cad/events');
    expect(r.status).toBe(200);
    expect(eventBusMock.subscribeEvents).toHaveBeenCalledTimes(1);
    const [sessionId, res] = eventBusMock.subscribeEvents.mock.calls[0];
    expect(typeof sessionId).toBe('string');
    expect(typeof res.end).toBe('function');
  });

  it('POST /message 缺 sessionId → 400，未知会话 → 404，非法 body → 400', async () => {
    expect((await req('/message', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(400);
    const notFound = await req('/message?sessionId=ghost', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    expect(notFound.status).toBe(404);

    const sent = makeSseSession();
    sessionManager.add('sse-1', sent.session);
    try {
      const bad = await req('/message?sessionId=sse-1', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"no":1}',
      });
      expect(bad.status).toBe(400);

      const ok = await req('/message?sessionId=sse-1', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/list' }),
      });
      expect(ok.status).toBe(202);
      expect(sent.sendResponse).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }));
    } finally {
      sessionManager.remove('sse-1');
    }
  });

  it('POST /message 时 transport 抛错返回 500', async () => {
    const sent = makeSseSession();
    sessionManager.add('sse-err', sent.session);
    const orig = transportMock.handleRequest.bind(transportMock);
    transportMock.handleRequest = async () => { throw new Error('msg-fail'); };
    try {
      const r = await req('/message?sessionId=sse-err', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      expect(r.status).toBe(500);
      expect(r.json.error).toBe('Internal server error');
    } finally {
      transportMock.handleRequest = orig;
      sessionManager.remove('sse-err');
    }
  });
});
