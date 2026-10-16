import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { fakePeer, otherPeer, configMock, peerManagerMock, loggerMock } = vi.hoisted(() => ({
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
    latencyEwma: 42,
  },
  otherPeer: {
    id: 'peer-10.0.0.6-8110',
    host: '10.0.0.6',
    port: 8110,
    url: 'http://10.0.0.6:8110',
    healthy: true,
    connected: true,
    hostname: 'win-host-2',
    version: '1.9.9',
    latencyEwma: 120,
  },
  configMock: { remotePeer: null, apiKey: '' },
  peerManagerMock: {
    getPeer: vi.fn(),
    getPeerByUrl: vi.fn(),
    getRemotePeer: vi.fn(),
    getCircuitState: vi.fn(),
    recordForwardResult: vi.fn(),
    isPeerRoutable: vi.fn(),
    selectBestPeer: vi.fn(),
  },
  loggerMock: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), closeLog: vi.fn() },
}));

vi.mock('../src/peer-manager.js', () => ({
  default: peerManagerMock,
}));
vi.mock('../src/config.js', () => ({
  default: configMock,
}));
vi.mock('../src/logger.js', () => loggerMock);

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
    peerManagerMock.getPeer.mockImplementation((id) => (id === fakePeer.id ? fakePeer : null));
    peerManagerMock.getPeerByUrl.mockImplementation((url) => (url === fakePeer.url ? fakePeer : null));
    peerManagerMock.getRemotePeer.mockReturnValue(fakePeer);
    peerManagerMock.getCircuitState.mockReturnValue('closed');
    peerManagerMock.isPeerRoutable.mockReturnValue(true);
    peerManagerMock.selectBestPeer.mockReturnValue(null);
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
      // 固定 peer 可用时不走自动选路
      expect(peerManagerMock.selectBestPeer).not.toHaveBeenCalled();
    });

    it('fixed peer unavailable → falls back to latency-based auto routing', async () => {
      configMock.remotePeer = { host: '10.0.0.5', port: 9999, autoForward: true };
      peerManagerMock.isPeerRoutable.mockReturnValue(false);
      peerManagerMock.getCircuitState.mockReturnValue('open');
      peerManagerMock.selectBestPeer.mockReturnValue(otherPeer);

      expect(await getAutoForwardPeer()).toBe(otherPeer);
      expect(loggerMock.error).toHaveBeenCalledWith(expect.stringContaining('不可用'));
      expect(loggerMock.error).toHaveBeenCalledWith(expect.stringContaining('熔断=open'));
    });

    it("remotePeer.host === 'auto' always auto-routes (no autoForward needed)", async () => {
      configMock.remotePeer = { host: 'auto' };
      peerManagerMock.selectBestPeer.mockReturnValue(otherPeer);

      expect(await getAutoForwardPeer()).toBe(otherPeer);
      expect(peerManagerMock.getRemotePeer).not.toHaveBeenCalled();
    });

    it('returns null with a clear error when no peer is routable', async () => {
      configMock.remotePeer = { host: 'auto' };
      peerManagerMock.selectBestPeer.mockReturnValue(null);

      expect(await getAutoForwardPeer()).toBeNull();
      expect(loggerMock.error).toHaveBeenCalledWith(expect.stringContaining('无可用 peer'));
    });

    it('logs when configured remotePeer is not registered in peer manager', async () => {
      configMock.remotePeer = { host: '10.0.0.5', port: 9999, autoForward: true };
      peerManagerMock.getRemotePeer.mockReturnValue(null);

      expect(await getAutoForwardPeer()).toBeNull();
      expect(loggerMock.error).toHaveBeenCalledWith(expect.stringContaining('未注册到 peer manager'));
    });
  });

  describe('forward metrics recording', () => {
    it('records a successful forward with latency', async () => {
      fetchMock.mockResolvedValue(jsonResponse({
        jsonrpc: '2.0', id: 1,
        result: { content: [{ type: 'text', text: 'OK' }] },
      }));

      await forwardToolCall(fakePeer.id, 'eval_lisp', { code: '(1+ 1)' });
      expect(peerManagerMock.recordForwardResult).toHaveBeenCalledWith(fakePeer, true, expect.any(Number));
    });

    it('records a failed forward', async () => {
      fetchMock.mockRejectedValue(new Error('connection refused'));

      await expect(forwardToolCall(fakePeer.id, 'eval_lisp', {})).rejects.toThrow('connection refused');
      expect(peerManagerMock.recordForwardResult).toHaveBeenCalledWith(fakePeer, false, expect.any(Number));
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
