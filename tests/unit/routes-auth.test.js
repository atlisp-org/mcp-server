import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import config from '../../src/config.js';
import { createAuthMiddleware, createCorsMiddleware } from '../../src/routes.js';

function makeReq(opts) {
  const o = opts || {};
  const headers = o.headers || {};
  const lower = {};
  for (const k of Object.keys(headers)) lower[k.toLowerCase()] = headers[k];
  return {
    method: o.method || 'GET',
    path: o.path || '/mcp',
    query: o.query || {},
    headers: lower,
    get(name) { return lower[String(name).toLowerCase()]; },
  };
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    end() { this.ended = true; return this; },
  };
  return res;
}

describe('createAuthMiddleware', () => {
  const original = { apiKey: config.apiKey, apiKeys: config.apiKeys };

  beforeEach(() => {
    config.apiKey = '';
    config.apiKeys = [];
  });

  afterEach(() => {
    config.apiKey = original.apiKey;
    config.apiKeys = original.apiKeys;
  });

  it('allows everything when no auth configured', () => {
    const req = makeReq();
    let passed = false;
    createAuthMiddleware()(req, makeRes(), () => { passed = true; });
    expect(passed).toBe(true);
    expect(req.role).toBe('admin');
  });

  it('rejects missing/invalid key when auth is configured', () => {
    config.apiKey = 'root-secret';
    const res = makeRes();
    let passed = false;
    createAuthMiddleware()(makeReq(), res, () => { passed = true; });
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('accepts a valid bearer key and assigns admin role', () => {
    config.apiKey = 'root-secret';
    const req = makeReq({ headers: { Authorization: 'Bearer root-secret' } });
    let passed = false;
    createAuthMiddleware()(req, makeRes(), () => { passed = true; });
    expect(passed).toBe(true);
    expect(req.role).toBe('admin');
  });

  it('assigns per-key role from apiKeys', () => {
    config.apiKey = '';
    config.apiKeys = [{ key: 'view-key', role: 'viewer' }];
    const req = makeReq({ headers: { Authorization: 'Bearer view-key' } });
    createAuthMiddleware()(req, makeRes(), () => {});
    expect(req.role).toBe('viewer');
  });

  it('keeps public endpoints open even when auth is configured', () => {
    config.apiKey = 'root-secret';
    let passed = false;
    createAuthMiddleware()(makeReq({ path: '/health' }), makeRes(), () => { passed = true; });
    expect(passed).toBe(true);
  });

  it('does not treat /debug as public', () => {
    config.apiKey = 'root-secret';
    const res = makeRes();
    createAuthMiddleware()(makeReq({ path: '/debug' }), res, () => {});
    expect(res.statusCode).toBe(401);
  });

  it('skips OPTIONS preflight', () => {
    config.apiKey = 'root-secret';
    let passed = false;
    createAuthMiddleware()(makeReq({ method: 'OPTIONS' }), makeRes(), () => { passed = true; });
    expect(passed).toBe(true);
  });
});

describe('createCorsMiddleware', () => {
  const originalEnable = config.enableCors;
  const originalOrigin = config.corsOrigin;

  beforeEach(() => {
    config.enableCors = true;
    config.corsOrigin = 'localhost,*.atlisp.cn,atlisp.cn';
  });

  afterEach(() => {
    config.enableCors = originalEnable;
    config.corsOrigin = originalOrigin;
  });

  it('allows localhost origins', () => {
    const res = makeRes();
    createCorsMiddleware()(makeReq({ headers: { origin: 'http://localhost:8100' } }), res, () => {});
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:8100');
  });

  it('allows atlisp.cn subdomains', () => {
    const res = makeRes();
    createCorsMiddleware()(makeReq({ headers: { origin: 'https://app.atlisp.cn' } }), res, () => {});
    expect(res.headers['access-control-allow-origin']).toBe('https://app.atlisp.cn');
  });

  it('rejects unknown origins with 403', () => {
    const res = makeRes();
    createCorsMiddleware()(makeReq({ headers: { origin: 'https://evil.example.com' } }), res, () => {});
    expect(res.statusCode).toBe(403);
  });

  it('answers OPTIONS preflight with 204', () => {
    const res = makeRes();
    createCorsMiddleware()(makeReq({ method: 'OPTIONS', headers: { origin: 'http://localhost:8100' } }), res, () => {});
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
  });
});
