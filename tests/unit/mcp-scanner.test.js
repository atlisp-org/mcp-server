import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  openHosts: new Set(),
}));

vi.mock('net', () => {
  class FakeSocket {
    constructor() {
      this._handlers = {};
    }
    setTimeout() {}
    once(event, cb) {
      this._handlers[event] = cb;
      return this;
    }
    connect(_port, host) {
      queueMicrotask(() => {
        if (mocks.openHosts.has(host)) {
          this._handlers.connect?.();
        } else {
          this._handlers.error?.(new Error('ECONNREFUSED'));
        }
      });
    }
    destroy() {}
  }
  return { default: { Socket: FakeSocket } };
});

const { probeMcp, scanLan } = await import('../../src/mcp-scanner.js');

function jsonResponse(body, { ok = true, contentType = 'application/json' } = {}) {
  return {
    ok,
    status: ok ? 200 : 500,
    headers: { get: () => contentType },
    text: async () => body,
  };
}

describe('mcp-scanner', () => {
  beforeEach(() => {
    mocks.openHosts.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('probeMcp', () => {
    it('returns serverInfo from a JSON initialize response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'atlisp-mcp-server', version: '1.9.8' },
        },
      })));

      const info = await probeMcp('10.0.0.5', 8110, 500);
      expect(info).toEqual({
        name: 'atlisp-mcp-server',
        version: '1.9.8',
        protocolVersion: '2024-11-05',
      });
    });

    it('parses an SSE initialize response', async () => {
      const sse = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"srv","version":"2.0"}}}\n\n';
      globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(sse, { contentType: 'text/event-stream' }));

      const info = await probeMcp('10.0.0.5', 8110, 500);
      expect(info).toMatchObject({ name: 'srv', version: '2.0' });
    });

    it('returns null on non-ok response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse('nope', { ok: false }));
      expect(await probeMcp('10.0.0.5', 8110, 500)).toBeNull();
    });

    it('returns null when fetch rejects', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('boom'));
      expect(await probeMcp('10.0.0.5', 8110, 500)).toBeNull();
    });

    it('sends Authorization header when apiKey is provided', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(JSON.stringify({
        result: { serverInfo: { name: 'srv', version: '1.0' } },
      })));

      await probeMcp('10.0.0.5', 8110, 500, 'secret-key');
      const [, opts] = globalThis.fetch.mock.calls[0];
      expect(opts.headers['Authorization']).toBe('Bearer secret-key');
    });
  });

  describe('scanLan', () => {
    it('reports only hosts that respond to MCP initialize', async () => {
      mocks.openHosts.add('10.0.0.5');
      globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(JSON.stringify({
        result: { serverInfo: { name: 'atlisp-mcp-server', version: '1.9.8' } },
      })));

      const found = await scanLan({
        hosts: ['10.0.0.5', '10.0.0.6'],
        port: 8110,
        timeoutMs: 100,
        concurrency: 4,
      });

      expect(found).toHaveLength(1);
      expect(found[0].ip).toBe('10.0.0.5');
      expect(found[0].serverInfo).toEqual({ name: 'atlisp-mcp-server', version: '1.9.8' });
    });

    it('returns an empty list when no hosts respond', async () => {
      globalThis.fetch = vi.fn();
      const found = await scanLan({ hosts: ['10.0.0.6'], port: 8110, timeoutMs: 100 });
      expect(found).toEqual([]);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('sorts results by IP address', async () => {
      mocks.openHosts.add('10.0.0.10');
      mocks.openHosts.add('10.0.0.2');
      globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(JSON.stringify({
        result: { serverInfo: { name: 'srv', version: '1.0' } },
      })));

      const found = await scanLan({
        hosts: ['10.0.0.10', '10.0.0.2'],
        port: 8110,
        timeoutMs: 100,
      });

      expect(found.map(f => f.ip)).toEqual(['10.0.0.2', '10.0.0.10']);
    });
  });
});
