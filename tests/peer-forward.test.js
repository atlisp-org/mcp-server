import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { fakePeer, configMock } = vi.hoisted(() => ({
  fakePeer: {
    id: 'remote-10.0.0.5-9999',
    host: '10.0.0.5',
    port: 9999,
    url: 'http://10.0.0.5:9999',
    healthy: true,
    connected: true,
    hostname: 'win-host',
    version: '1.9.9',
    apikey: 'sekrit',
  },
  configMock: { remotePeer: null, apiKey: '' },
}));

vi.mock('../src/peer-manager.js', () => ({
  default: {
    getPeer: (id) => (id === fakePeer.id ? fakePeer : null),
    getPeerByUrl: (url) => (url === fakePeer.url ? fakePeer : null),
    getRemotePeer: () => fakePeer,
  },
}));
vi.mock('../src/config.js', () => ({
  default: configMock,
}));

const fetchMock = vi.fn();

const { isForwardableTool, forwardToolCall, getAutoForwardPeer } = await import('../src/peer-forward.js');
const { peer_call_tool } = await import('../src/handlers/peer-handlers.js');

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: (k) => (k === 'content-type' ? 'application/json' : null) },
    text: async () => JSON.stringify(payload),
  };
}

function sseResponse(payload) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: (k) => (k === 'content-type' ? 'text/event-stream' : null) },
    text: async () => `data: ${JSON.stringify(payload)}\n`,
  };
}

describe('peer-forward', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configMock.remotePeer = null;
    configMock.apiKey = '';
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('isForwardableTool', () => {
    it('allows business (CAD) tools', () => {
      for (const name of ['eval_lisp', 'eval_lisp_with_result', 'get_entity', 'stream_entities', 'check_drawing_standards', 'open_cad', 'connect_cad']) {
        expect(isForwardableTool(name), name).toBe(true);
      }
    });

    it('rejects local management tools', () => {
      for (const name of [
        'peer_list', 'peer_forward', 'peer_call_tool',
        'skill_search', 'skill_install',
        'webhook_register', 'sandbox_validate',
        'audit_log_query', 'debug_start',
        'agent_set_context', 'session_pin_instance',
        'watch_register', 'lisp_repl',
        'search_tools', 'list_tools_by_category', 'get_tool_info', 'list_prompts', 'get_prompt',
        'analyze_lisp_code', 'format_lisp_code', 'lint_project',
        'list_standards', 'save_standards', 'compare_standards',
        'batch_concurrent_tasks',
      ]) {
        expect(isForwardableTool(name), name).toBe(false);
      }
    });

    it('rejects unknown tools and invalid input', () => {
      expect(isForwardableTool('nonexistent_tool')).toBe(false);
      expect(isForwardableTool('')).toBe(false);
      expect(isForwardableTool(null)).toBe(false);
      expect(isForwardableTool(123)).toBe(false);
    });
  });

  describe('getAutoForwardPeer', () => {
    it('returns null when remotePeer not configured', async () => {
      configMock.remotePeer = null;
      expect(await getAutoForwardPeer()).toBeNull();
    });

    it('returns null when autoForward disabled', async () => {
      configMock.remotePeer = { host: '10.0.0.5', port: 9999, autoForward: false };
      expect(await getAutoForwardPeer()).toBeNull();
    });

    it('returns peer when remotePeer configured with autoForward', async () => {
      configMock.remotePeer = { host: '10.0.0.5', port: 9999, apiKey: 'k', autoForward: true };
      const peer = await getAutoForwardPeer();
      expect(peer).toBe(fakePeer);
    });
  });

  describe('forwardToolCall (wrapper)', () => {
    it('wraps remote result with remote header line', async () => {
      fetchMock.mockResolvedValue(jsonResponse({
        jsonrpc: '2.0', id: 1,
        result: { content: [{ type: 'text', text: '远程结果' }] },
      }));

      const result = await forwardToolCall(fakePeer.id, 'eval_lisp', { code: '(1+ 1 1)' });
      expect(result.content[0].text).toContain('远程执行');
      expect(result.content[0].text).toContain('eval_lisp');
      expect(result.content[1].text).toBe('远程结果');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://10.0.0.5:9999/mcp');
      expect(init.method).toBe('POST');
      const body = JSON.parse(init.body);
      expect(body.method).toBe('tools/call');
      expect(body.params.name).toBe('eval_lisp');
      expect(body.params.arguments).toEqual({ code: '(1+ 1 1)' });
      expect(init.headers.Authorization).toBe('Bearer sekrit');
    });

    it('preserves remote isError flag', async () => {
      fetchMock.mockResolvedValue(jsonResponse({
        jsonrpc: '2.0', id: 1,
        result: { content: [{ type: 'text', text: '错误详情' }], isError: true },
      }));

      const result = await forwardToolCall(fakePeer.id, 'eval_lisp', {});
      expect(result.isError).toBe(true);
      expect(result.content.some(c => c.text === '错误详情')).toBe(true);
    });

    it('parses SSE responses', async () => {
      fetchMock.mockResolvedValue(sseResponse({
        jsonrpc: '2.0', id: 1,
        result: { content: [{ type: 'text', text: 'sse结果' }] },
      }));

      const result = await forwardToolCall(fakePeer.id, 'eval_lisp', {});
      expect(result.content[1].text).toBe('sse结果');
    });
  });

  describe('peer_call_tool handler', () => {
    it('forwards a business tool call', async () => {
      fetchMock.mockResolvedValue(jsonResponse({
        jsonrpc: '2.0', id: 1,
        result: { content: [{ type: 'text', text: 'OK: 已创建' }] },
      }));

      const result = await peer_call_tool({ peerId: fakePeer.id, tool: 'eval_lisp', args: { code: '(princ 1)' } });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('远程执行');
      expect(result.content[1].text).toBe('OK: 已创建');
    });

    it('rejects non-forwardable tools without calling fetch', async () => {
      const result = await peer_call_tool({ peerId: fakePeer.id, tool: 'search_tools' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('不可转发');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects unknown tools', async () => {
      const result = await peer_call_tool({ peerId: fakePeer.id, tool: 'no_such_tool' });
      expect(result.isError).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('surfaces remote JSON-RPC errors', async () => {
      fetchMock.mockResolvedValue(jsonResponse({
        jsonrpc: '2.0', id: 1,
        error: { message: '远程 CAD 未连接' },
      }));

      const result = await peer_call_tool({ peerId: fakePeer.id, tool: 'eval_lisp', args: {} });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('远程 CAD 未连接');
    });

    it('surfaces HTTP errors', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: { get: () => null },
        text: async () => '',
      });

      const result = await peer_call_tool({ peerId: fakePeer.id, tool: 'eval_lisp', args: {} });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('500');
    });

    it('surfaces peer-not-found errors', async () => {
      const result = await peer_call_tool({ peerId: 'unknown-peer', tool: 'eval_lisp', args: {} });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Peer not found');
    });
  });
});
