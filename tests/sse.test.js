import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { setupSseHeaders, sendSSE, createSseResponseHandler, SseSession, SSE_EVENTS, parseLastEventId } from '../src/sse-session.js';
import { SseSessionManager } from '../src/sse-session-manager.js';

vi.mock('../src/logger.js', () => ({ log: vi.fn() }));

const mockCad = vi.hoisted(() => ({
  connected: false,
  connect: vi.fn(),
  sendCommand: vi.fn(),
  sendCommandWithResult: vi.fn(),
  getInfo: vi.fn(),
  getPlatform: vi.fn(),
  getVersion: vi.fn(),
  newDoc: vi.fn(),
}));

vi.mock('../src/cad.js', () => ({
  cad: mockCad,
  onDocumentChanged: vi.fn(),
}));

const { handleToolCall } = await import('../src/atlisp-mcp.js');

describe('SSE utilities', () => {
  it('setupSseHeaders sets correct headers', () => {
    const mockRes = {
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
    };
    setupSseHeaders(mockRes);
    expect(mockRes.headers['Content-Type']).toBe('text/event-stream');
    expect(mockRes.headers['Cache-Control']).toBe('no-cache');
    expect(mockRes.headers['Connection']).toBe('keep-alive');
    expect(mockRes.headers['Transfer-Encoding']).toBe('chunked');
    expect(mockRes.headers['X-Accel-Buffering']).toBe('no');
    expect(mockRes.headers['Vary']).toBe('Accept');
  });

  it('sendSSE writes formatted event stream with id', () => {
    let written = '';
    const mockRes = {
      write(data) { written += data; },
      flush() {},
    };
    sendSSE(mockRes, { test: 'data' }, SSE_EVENTS.MESSAGE);
    expect(written).toContain('id: ');
    expect(written).toContain('event: message\n');
    expect(written).toContain('data: {"test":"data"}\n\n');
  });

  it('createSseResponseHandler sends SSE when acceptSse=true', () => {
    let ended = false;
    let written = '';
    const mockRes = {
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      write(data) { written += data; },
      flush() {},
      end() { ended = true; },
    };
    const { send } = createSseResponseHandler(mockRes, true);
    send({ result: 'ok' }, true);
    expect(mockRes.headers['Content-Type']).toBe('text/event-stream');
    expect(written).toContain('data:');
    expect(ended).toBe(false);
  });

  it('createSseResponseHandler sends JSON when acceptSse=false', () => {
    let ended = false;
    let body = '';
    const mockRes = {
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      end(data) { if (data) body = data; ended = true; },
    };
    const { send } = createSseResponseHandler(mockRes, false);
    send({ result: 'ok' }, true);
    expect(mockRes.headers['Content-Type']).toBe('application/json');
    expect(body).toContain('"result":"ok"');
    expect(ended).toBe(true);
  });

  it('parseLastEventId extracts and parses Last-Event-ID header', () => {
    const mockReq1 = { get: () => '123' };
    expect(parseLastEventId(mockReq1)).toBe(123);

    const mockReq2 = { get: () => 'abc' };
    expect(parseLastEventId(mockReq2)).toBeNull();

    const mockReq3 = { get: () => undefined };
    expect(parseLastEventId(mockReq3)).toBeNull();
  });
});

describe('SseSession class', () => {
  it('creates session with clientId', () => {
    let headers = {};
    const mockRes = {
      setHeader(name, value) { headers[name] = value; },
      write() { return true; },
      end() {},
    };
    const session = new SseSession(mockRes, { clientId: 'test-123' });
    expect(session.clientId).toBe('test-123');
    expect(session.isActive).toBe(true);
  });

  it('generates random clientId if not provided', () => {
    const mockRes = {
      setHeader() {},
      write() { return true; },
      end() {},
    };
    const session = new SseSession(mockRes);
    expect(session.clientId).toBeTruthy();
    expect(session.clientId.length).toBeGreaterThan(0);
  });

  it('sets SSE headers on creation', () => {
    let headers = {};
    const mockRes = {
      setHeader(name, value) { headers[name] = value; },
      write() { return true; },
      end() {},
    };
    new SseSession(mockRes);
    expect(headers['Content-Type']).toBe('text/event-stream');
    expect(headers['Cache-Control']).toBe('no-cache');
    expect(headers['Connection']).toBe('keep-alive');
    expect(headers['X-Accel-Buffering']).toBe('no');
  });

  it('sends message events', () => {
    let written = '';
    const mockRes = {
      setHeader() {},
      write(data) { written += data; return true; },
      flush() {},
    };
    const session = new SseSession(mockRes);
    session.sendMessage({ test: 'data' });
    expect(written).toContain('event: message\n');
    expect(written).toContain('data: {"test":"data"}\n\n');
  });

  it('sends endpoint events', () => {
    let written = '';
    const mockRes = {
      setHeader() {},
      write(data) { written += data; return true; },
      flush() {},
    };
    const session = new SseSession(mockRes);
    session.sendEndpoint('/mcp');
    expect(written).toContain('event: endpoint\n');
    expect(written).toContain('"/mcp"');
  });

  it('sends error events', () => {
    let written = '';
    const mockRes = {
      setHeader() {},
      write(data) { written += data; return true; },
      flush() {},
    };
    const session = new SseSession(mockRes);
    session.sendError(-32600, 'Invalid request');
    expect(written).toContain('event: error\n');
    expect(written).toContain('-32600');
    expect(written).toContain('Invalid request');
  });

  it('sends ping events', () => {
    let written = '';
    const mockRes = {
      setHeader() {},
      write(data) { written += data; return true; },
      flush() {},
    };
    const session = new SseSession(mockRes);
    session.sendPing();
    expect(written).toContain('event: ping\n');
    expect(written).toContain('timestamp');
  });

  it('sends capabilities events', () => {
    let written = '';
    const mockRes = {
      setHeader() {},
      write(data) { written += data; return true; },
      flush() {},
    };
    const session = new SseSession(mockRes);
    const caps = { tools: {}, resources: {} };
    session.sendCapabilities(caps);
    expect(written).toContain('event: capabilities\n');
    expect(written).toContain('"tools"');
    expect(written).toContain('"resources"');
  });

  it('sends progress events', () => {
    let written = '';
    const mockRes = {
      setHeader() {},
      write(data) { written += data; return true; },
      flush() {},
    };
    const session = new SseSession(mockRes);
    session.sendProgress(50, 100, 'Processing...');
    expect(written).toContain('event: progress\n');
    expect(written).toContain('"current":50');
    expect(written).toContain('"total":100');
    expect(written).toContain('Processing');
  });

  it('sends response with id', () => {
    let written = '';
    const mockRes = {
      setHeader() {},
      write(data) { written += data; return true; },
      flush() {},
    };
    const session = new SseSession(mockRes);
    session.sendResponse({ jsonrpc: '2.0', id: 42, result: { test: true } });
    expect(written).toContain('event: message\n');
    expect(written).toContain('"id":42');
  });

  it('tracks session data', () => {
    const mockRes = {
      setHeader() {},
      write() { return true; },
      end() {},
    };
    const session = new SseSession(mockRes);
    session.setSessionData('user', 'test-user');
    expect(session.getSessionData('user')).toBe('test-user');
    expect(session.sessionData.user).toBe('test-user');
  });

  it('closes session', () => {
    let closed = false;
    const mockRes = {
      setHeader() {},
      write() { return true; },
      end() { closed = true; },
    };
    const session = new SseSession(mockRes);
    session.close();
    expect(closed).toBe(true);
    expect(session.isActive).toBe(false);
  });
});

describe('SseSessionManager', () => {
  it('adds and retrieves sessions', () => {
    const manager = new SseSessionManager();
    const mockRes = {
      setHeader() {},
      write() { return true; },
      end() {},
    };
    const session = new SseSession(mockRes);
    manager.add('client-1', session);
    expect(manager.has('client-1')).toBe(true);
    expect(manager.get('client-1')).toBe(session);
  });

  it('removes sessions', () => {
    const manager = new SseSessionManager();
    const mockRes = {
      setHeader() {},
      write() { return true; },
      end() {},
    };
    const session = new SseSession(mockRes);
    manager.add('client-1', session);
    expect(manager.remove('client-1')).toBe(true);
    expect(manager.has('client-1')).toBe(false);
  });

  it('returns false when removing non-existent session', () => {
    const manager = new SseSessionManager();
    expect(manager.remove('non-existent')).toBe(false);
  });

  it('lists all sessions', () => {
    const manager = new SseSessionManager();
    const mockRes1 = { setHeader() {}, write() { return true; }, end() {} };
    const mockRes2 = { setHeader() {}, write() { return true; }, end() {} };
    manager.add('c1', new SseSession(mockRes1));
    manager.add('c2', new SseSession(mockRes2));
    const list = manager.list();
    expect(list).toHaveLength(2);
    expect(list.map(s => s.clientId)).toContain('c1');
    expect(list.map(s => s.clientId)).toContain('c2');
  });

  it('counts sessions', () => {
    const manager = new SseSessionManager();
    const mockRes = { setHeader() {}, write() { return true; }, end() {} };
    expect(manager.count()).toBe(0);
    manager.add('c1', new SseSession(mockRes));
    expect(manager.count()).toBe(1);
    manager.add('c2', new SseSession(mockRes));
    expect(manager.count()).toBe(2);
  });

  it('sends events to specific client', () => {
    const manager = new SseSessionManager();
    let written = '';
    const mockRes = {
      setHeader() {},
      write(data) { written += data; return true; },
      flush() {},
    };
    const session = new SseSession(mockRes);
    manager.add('client-1', session);
    
    manager.sendToClient('client-1', SSE_EVENTS.MESSAGE, { test: true });
    expect(written).toContain('event: message');
    expect(written).toContain('"test":true');
  });

  it('returns false when sending to non-existent client', () => {
    const manager = new SseSessionManager();
    expect(manager.sendToClient('non-existent', SSE_EVENTS.MESSAGE, {})).toBe(false);
  });

  it('broadcasts events to all sessions', () => {
    const manager = new SseSessionManager();
    let written1 = '', written2 = '';
    const mockRes1 = { setHeader() {}, write(data) { written1 += data; return true; }, flush() {} };
    const mockRes2 = { setHeader() {}, write(data) { written2 += data; return true; }, flush() {} };
    manager.add('c1', new SseSession(mockRes1));
    manager.add('c2', new SseSession(mockRes2));
    
    const count = manager.broadcast(SSE_EVENTS.MESSAGE, { broadcast: true });
    expect(count).toBe(2);
    expect(written1).toContain('"broadcast":true');
    expect(written2).toContain('"broadcast":true');
  });

  it('buffers on backpressure instead of going inactive', () => {
    const manager = new SseSessionManager();
    let writeCount = 0;
    let drainRegistered = false;
    const mockRes = { 
      setHeader() {}, 
      write() { 
        writeCount++;
        if (writeCount > 2) return false;
        return true; 
      },
      flush() {},
      on(event, handler) { if (event === 'drain') drainRegistered = true; },
      removeListener() {},
      end() {} 
    };
    const session = new SseSession(mockRes);
    manager.add('bp', session);
    expect(manager.count()).toBe(1);
    session.sendMessage({ msg: 1 });
    session.sendMessage({ msg: 2 });
    session.sendMessage({ msg: 3 });
    session.sendMessage({ msg: 4 });
    expect(session.isActive).toBe(true);
    expect(drainRegistered).toBe(true);
  });

  it('cleans up truly inactive sessions (closed)', () => {
    const manager = new SseSessionManager();
    const mockRes1 = { setHeader() {}, write() { return true; }, on() {}, removeListener() {}, end() {} };
    const mockRes2 = { setHeader() {}, write() { return true; }, on() {}, removeListener() {}, end() {} };
    const session1 = new SseSession(mockRes1);
    const session2 = new SseSession(mockRes2);
    manager.add('s1', session1);
    manager.add('s2', session2);
    session2.close();
    expect(manager.count()).toBe(2);
    manager.cleanupInactive();
    expect(manager.count()).toBe(1);
    expect(manager.has('s1')).toBe(true);
  });

  it('closes all sessions', () => {
    const manager = new SseSessionManager();
    let closed = 0;
    const mockRes = { setHeader() {}, write() { return true; }, end() { closed++; } };
    manager.add('c1', new SseSession(mockRes));
    manager.add('c2', new SseSession(mockRes));
    manager.closeAll();
    expect(closed).toBe(2);
    expect(manager.count()).toBe(0);
  });

  it('handles event handlers', () => {
    const manager = new SseSessionManager();
    let eventData = null;
    const handler = (data) => { eventData = data; };
    
    manager.on('test-event', handler);
    manager.emit('test-event', { received: true });
    expect(eventData).toEqual({ received: true });
    
    manager.off('test-event', handler);
    manager.emit('test-event', { received: false });
    expect(eventData).toEqual({ received: true });
  });
});

function httpPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const options = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpPostSSE(url, body, headers = {}, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const options = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
        if (body.includes('event: message') || body.includes('Method not found')) {
          req.destroy();
          resolve({ status: res.statusCode, headers: res.headers, body });
        }
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', (err) => {
      if (err.code === 'ECONNRESET' || err.message.includes('destroyed')) return;
      reject(err);
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); });
    req.write(data);
    req.end();
  });
}

function fetchSSE(url, headers = {}, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: 'GET',
      headers: { 'Accept': 'text/event-stream', ...headers },
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
    });
    req.end();
  });
}

describe('Streamable HTTP - SSE via Accept header', () => {
  let app;
  let server;
  let baseUrl;
  const TEST_PORT = 18111;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      res.flush = () => {};
      next();
    });

    app.post('/mcp', async (req, res) => {
      const body = req.body || {};
      const method = body.method;
      const id = body.id;
      const accept = req.get('Accept') || '';
      const wantsSse = accept.includes('text/event-stream');

      if (wantsSse) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
      }

      const { send } = createSseResponseHandler(res, wantsSse);

      if (!id) return res.status(204).end();

      try {
        if (method === 'initialize') {
          send({
            jsonrpc: '2.0', id,
            result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'test', version: '1.0.0' } },
          }, true);
        } else if (method === 'tools/list') {
          send({ jsonrpc: '2.0', id, result: { tools: [{ name: 'test_tool' }] } }, true);
        } else if (method === 'tools/call') {
          const result = await handleToolCall(body.params?.name || '', body.params?.arguments || {});
          send({ jsonrpc: '2.0', id, result }, true);
        } else {
          send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }, true);
        }
      } catch (e) {
        send({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } }, true);
      }
    });

    await new Promise((resolve) => {
      server = app.listen(TEST_PORT, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${TEST_PORT}`;
  });

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  it('responds with SSE when Accept: text/event-stream is set', async () => {
    const { status, headers, body } = await httpPostSSE(`${baseUrl}/mcp`, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
    }, { 'Accept': 'text/event-stream' });
    expect(status).toBe(200);
    expect(headers['content-type']).toBe('text/event-stream');
    expect(body).toContain('event: message');
    expect(body).toContain('data:');
    expect(body).toContain('protocolVersion');
  });

  it('responds with JSON when no SSE Accept header', async () => {
    const { status, headers, body } = await httpPost(`${baseUrl}/mcp`, {
      jsonrpc: '2.0', id: 2, method: 'tools/list',
    });
    expect(status).toBe(200);
    expect(headers['content-type']).toBe('application/json');
    const data = JSON.parse(body);
    expect(data.result.tools).toHaveLength(1);
  });

  it('handles tools/call via SSE', async () => {
    const { status, headers, body } = await httpPostSSE(`${baseUrl}/mcp`, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'get_platform_info', arguments: {} },
    }, { 'Accept': 'text/event-stream' });
    expect(status).toBe(200);
    expect(headers['content-type']).toBe('text/event-stream');
    expect(body).toContain('event: message');
    expect(body).toContain('data:');
    expect(body).toContain('AutoCAD');
    expect(body).toContain('ZWCAD');
  });

  it('handles unknown methods with error in SSE mode', async () => {
    const { status, headers, body } = await httpPostSSE(`${baseUrl}/mcp`, {
      jsonrpc: '2.0', id: 4, method: 'unknown_method',
    }, { 'Accept': 'text/event-stream' });
    expect(status).toBe(200);
    expect(headers['content-type']).toBe('text/event-stream');
    expect(body).toContain('Method not found');
  });

  it('returns 204 for notifications (no id)', async () => {
    const { status } = await httpPost(`${baseUrl}/mcp`, {
      jsonrpc: '2.0', method: 'notifications/initialized',
    });
    expect(status).toBe(204);
  });
});

describe('SSE endpoint - Custom SSE Session', () => {
  let server;
  let baseUrl;
  const TEST_PORT = 18112;

  beforeAll(async () => {
    const http = await import('node:http');
    server = http.createServer((req, res) => {
      if (req.url === '/sse' && req.method === 'GET') {
        const clientId = req.headers['mcp-session-id'] || 'default-client';
        const session = new SseSession(res, { clientId });
        
        session.sendEndpoint('/mcp');
        session.sendCapabilities({
          protocolVersion: '2024-11-05',
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'test-sse', version: '1.0.0' }
        });
        
        setTimeout(() => {
          session.close();
        }, 100);
        return;
      }
      res.writeHead(404).end('Not Found');
    });

    await new Promise((resolve) => {
      server.listen(TEST_PORT, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${TEST_PORT}`;
  }, 30000);

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
  }, 10000);

  it('establishes SSE connection and receives endpoint event', async () => {
    const { status, headers, body } = await fetchSSE(`${baseUrl}/sse`, {}, 500);
    expect(status).toBe(200);
    expect(headers['content-type']).toBe('text/event-stream');
    expect(body).toMatch(/event:\s*endpoint/);
    expect(body).toContain('/mcp');
    expect(body).toMatch(/event:\s*capabilities/);
  });

  it('uses custom session ID from header', async () => {
    const { status, headers, body } = await fetchSSE(`${baseUrl}/sse`, { 'mcp-session-id': 'custom-session-123' }, 500);
    expect(status).toBe(200);
    expect(body).toMatch(/event:\s*endpoint/);
  });

  it('sends retry field on initial connection', async () => {
    let written = '';
    const mockRes = {
      setHeader() {},
      write(data) { written += data; return true; },
      flush() {},
    };
    const session = new SseSession(mockRes, { retryInterval: 5000 });
    expect(written).toContain('retry: 5000\n\n');
  });

  it('tracks sent messages for resumption', async () => {
    let written = '';
    const mockRes = {
      setHeader() {},
      write(data) { written += data; return true; },
      flush() {},
    };
    const session = new SseSession(mockRes);
    expect(session.sentMessages).toHaveLength(0);
    session.sendMessage({ test: 'data' });
    const sent = session.sentMessages;
    expect(sent).toHaveLength(1);
    expect(sent[0].data).toEqual({ test: 'data' });
    expect(sent[0].event).toBe('message');
    expect(typeof sent[0].id).toBe('number');
  });

  it('resumes from specific event ID', async () => {
    let written = '';
    const mockRes = {
      setHeader() {},
      write(data) { written += data; return true; },
      flush() {},
    };
    const session = new SseSession(mockRes, { resumeFromId: 5 });
    expect(session.lastEventId).toBe(5);
    session.sendMessage({ resumed: true });
    expect(written).toMatch(/id: 6/);
  });

  it('getMessagesSince returns messages after event ID', async () => {
    const mockRes = { setHeader() {}, write() { return true; }, flush() {} };
    const session = new SseSession(mockRes);
    session.sendMessage({ id: 1 });
    session.sendMessage({ id: 2 });
    session.sendMessage({ id: 3 });
    const since = session.getMessagesSince(1);
    expect(since).toHaveLength(2);
    expect(since[0].id).toBe(2);
    expect(since[1].id).toBe(3);
  });

  it('allows dynamic retry interval adjustment', async () => {
    let written = '';
    const mockRes = {
      setHeader() {},
      write(data) { written += data; return true; },
      flush() {},
    };
    const session = new SseSession(mockRes, { retryInterval: 30000 });
    expect(session.retryInterval).toBe(30000);
    session.setRetryInterval(60000);
    expect(session.retryInterval).toBe(60000);
  });

  it('handles null data in events', async () => {
    let written = '';
    const mockRes = {
      setHeader() {},
      write(data) { written += data; return true; },
      flush() {},
    };
    const session = new SseSession(mockRes);
    session.sendEvent(SSE_EVENTS.MESSAGE, null);
    expect(written).toContain('data:\n\n');
    expect(written).not.toContain('data: null');
  });

  it('reconnects and resumes from last event ID', async () => {
    let written1 = '', written2 = '';
    const mockRes1 = {
      setHeader() {},
      write(data) { written1 += data; return true; },
      flush() {},
    };
    const session1 = new SseSession(mockRes1, { clientId: 'reconnect-test' });
    session1.sendMessage({ msg: 'first' });
    session1.sendMessage({ msg: 'second' });
    session1.sendMessage({ msg: 'third' });
    const lastId = session1.lastEventId;

    const mockRes2 = {
      setHeader() {},
      write(data) { written2 += data; return true; },
      flush() {},
    };
    const session2 = new SseSession(mockRes2, { clientId: 'reconnect-test', resumeFromId: lastId });
    expect(session2.lastEventId).toBe(lastId);

    const missed = session1.getMessagesSince(lastId - 2);
    expect(missed).toHaveLength(2);
    expect(missed[0].data.msg).toBe('second');
    expect(missed[1].data.msg).toBe('third');

    for (const m of missed) {
      session2.sendEvent(m.event, m.data, m.id);
    }
    expect(written2).toContain('"msg":"second"');
    expect(written2).toContain('"msg":"third"');
  });

  it('backpressure buffer drains on write() false', async () => {
    let writeCount = 0;
    let drainRegistered = false;
    const mockRes = {
      setHeader() {},
      write(data) {
        writeCount++;
        if (writeCount <= 2) return true;
        return false;
      },
      flush() {},
      on(event, handler) {
        if (event === 'drain') drainRegistered = true;
      },
      removeListener() {},
      end() {},
    };
    const session = new SseSession(mockRes);
    expect(session.isActive).toBe(true);
    session.sendMessage({ first: true });
    session.sendMessage({ second: true });
    session.sendMessage({ third: true });
    session.sendMessage({ fourth: true });
    expect(session.isActive).toBe(true);
    expect(drainRegistered).toBe(true);
  });
});