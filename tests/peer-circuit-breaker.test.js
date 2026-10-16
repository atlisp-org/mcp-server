import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { configMock, probeMcp, discoveryGetPeer, cleanupStale, loggerMock } = vi.hoisted(() => ({
  configMock: {
    port: 8110,
    remotePeer: null,
    apiKey: '',
    peerDiscovery: { enabled: false, port: 9811, broadcastInterval: 5000, silent: true, peers: [] },
  },
  probeMcp: vi.fn(),
  discoveryGetPeer: vi.fn(),
  cleanupStale: vi.fn(),
  loggerMock: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), closeLog: vi.fn() },
}));

vi.mock('../src/config.js', () => ({ default: configMock }));
vi.mock('../src/peer-discovery.js', () => ({
  default: {
    start: vi.fn(),
    stop: vi.fn(),
    onPeerFound: vi.fn(),
    onPeerLost: vi.fn(),
    getPeer: discoveryGetPeer,
    cleanupStale,
  },
}));
vi.mock('../src/mcp-scanner.js', () => ({
  probeMcp,
  scanLan: vi.fn(async () => []),
}));
vi.mock('../src/logger.js', () => loggerMock);

const peerManager = (await import('../src/peer-manager.js')).default;
const {
  CIRCUIT_FAILURE_THRESHOLD,
  CIRCUIT_COOLDOWN_MS,
  LATENCY_EWMA_ALPHA,
} = await import('../src/peer-manager.js');
const peerProxy = (await import('../src/peer-proxy.js')).default;

const BASE_TIME = new Date('2026-01-01T00:00:00.000Z').getTime();
let now = BASE_TIME;
const advance = (ms) => { now += ms; };

const mkPeer = (id, extra = {}) => ({
  id,
  host: '10.0.0.5',
  port: 8110,
  version: '1.9.9',
  hostname: id,
  url: `http://${id}.test:8110`,
  connected: true,
  healthy: true,
  lastSeen: BASE_TIME,
  lastHealthCheck: 0,
  static: true,
  ...extra,
});

const put = (peer) => {
  peerManager._peers.set(peer.id, peer);
  return peer;
};

const openCircuit = (peer) => {
  peer.circuit = 'open';
  peer.circuitOpenedAt = now;
  return peer;
};

const jsonRes = (payload) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  headers: { get: (k) => (k === 'content-type' ? 'application/json' : null) },
  text: async () => JSON.stringify(payload),
});

const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'eval_lisp', arguments: {} } };

describe('peer 熔断状态机', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    configMock.remotePeer = null;
    configMock.peerDiscovery.peers = [];
    probeMcp.mockResolvedValue({ name: 'atlisp-mcp-server', version: '1.9.9' });
    discoveryGetPeer.mockReturnValue(null);
    now = BASE_TIME;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    peerManager.stop();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    peerManager.stop();
  });

  describe('状态转换', () => {
    it('初始为 closed', () => {
      const p = put(mkPeer('p1'));
      expect(peerManager.getCircuitState(p)).toBe('closed');
      expect(p.consecutiveFailures).toBe(0);
      expect(p.latencyEwma).toBeNull();
    });

    it(`连续失败 ${CIRCUIT_FAILURE_THRESHOLD} 次才打开熔断`, () => {
      const p = put(mkPeer('p1'));

      peerManager.recordFailure(p, 10);
      peerManager.recordFailure(p, 10);
      expect(peerManager.getCircuitState(p)).toBe('closed');
      expect(p.consecutiveFailures).toBe(2);

      peerManager.recordFailure(p, 10);
      expect(peerManager.getCircuitState(p)).toBe('open');
      expect(p.consecutiveFailures).toBe(3);
      expect(p.circuitOpenedAt).toBe(now);
      expect(p.lastFailure).toBe(now);
    });

    it('成功清零连续失败并保持 closed', () => {
      const p = put(mkPeer('p1'));
      peerManager.recordFailure(p, 10);
      peerManager.recordFailure(p, 10);
      peerManager.recordSuccess(p, 20);

      expect(p.consecutiveFailures).toBe(0);
      expect(peerManager.getCircuitState(p)).toBe('closed');
      expect(p.lastSuccess).toBe(now);
      // EWMA 复用状态机数据：失败样本 10ms 之后成功样本 20ms
      expect(p.latencyEwma).toBeCloseTo(
        LATENCY_EWMA_ALPHA * 20 + (1 - LATENCY_EWMA_ALPHA) * 10,
        6,
      );
    });

    it('EWMA 时延按 alpha 平滑', () => {
      const p = put(mkPeer('p1'));
      peerManager.recordSuccess(p, 100);
      expect(p.latencyEwma).toBe(100);

      peerManager.recordSuccess(p, 200);
      expect(p.latencyEwma).toBeCloseTo(
        LATENCY_EWMA_ALPHA * 200 + (1 - LATENCY_EWMA_ALPHA) * 100,
        6,
      );
    });

    it('记录转发指标（成功/失败计数 + EWMA 复用状态机数据）', () => {
      const p = put(mkPeer('p1'));

      peerManager.recordForwardResult(p, true, 50);
      expect(p.forwardSuccess).toBe(1);
      expect(p.forwardFailure).toBe(0);
      expect(p.latencyEwma).toBe(50);
      expect(p.lastForwardAt).toBe(now);

      peerManager.recordForwardResult(p, false, 80);
      expect(p.forwardSuccess).toBe(1);
      expect(p.forwardFailure).toBe(1);
      expect(p.latencyEwma).toBeCloseTo(
        LATENCY_EWMA_ALPHA * 80 + (1 - LATENCY_EWMA_ALPHA) * 50,
        6,
      );
      expect(p.consecutiveFailures).toBe(1);
    });
  });

  describe('冷却与 half-open', () => {
    it('open 在冷却期内保持 open，冷却到期转 half-open', () => {
      const p = openCircuit(put(mkPeer('p1')));

      advance(CIRCUIT_COOLDOWN_MS - 1);
      expect(peerManager.getCircuitState(p)).toBe('open');

      advance(1);
      expect(peerManager.getCircuitState(p)).toBe('half-open');
      // 惰性转换只发生一次
      expect(p.circuit).toBe('half-open');
    });

    it('half-open 探测成功 → closed', () => {
      const p = openCircuit(put(mkPeer('p1')));
      advance(CIRCUIT_COOLDOWN_MS);
      expect(peerManager.getCircuitState(p)).toBe('half-open');

      peerManager.recordSuccess(p, 30);
      expect(peerManager.getCircuitState(p)).toBe('closed');
      expect(p.consecutiveFailures).toBe(0);
      expect(p.circuitOpenedAt).toBe(0);
      expect(p.probeInFlight).toBe(false);
    });

    it('half-open 探测失败 → 重新 open 并重置冷却期', () => {
      const p = openCircuit(put(mkPeer('p1')));
      advance(CIRCUIT_COOLDOWN_MS);
      expect(peerManager.getCircuitState(p)).toBe('half-open');

      const reopenedAt = now;
      peerManager.recordFailure(p, 30);
      expect(peerManager.getCircuitState(p)).toBe('open');
      expect(p.circuitOpenedAt).toBe(reopenedAt);

      advance(CIRCUIT_COOLDOWN_MS - 1);
      expect(peerManager.getCircuitState(p)).toBe('open');
      advance(1);
      expect(peerManager.getCircuitState(p)).toBe('half-open');
    });

    it('未知 id 返回 null', () => {
      expect(peerManager.getCircuitState('nope')).toBeNull();
      expect(peerManager.getCircuitState(null)).toBeNull();
    });
  });

  describe('可路由性与选路', () => {
    it('isPeerRoutable：健康 + closed/half-open 才可路由', () => {
      const p = put(mkPeer('p1'));
      expect(peerManager.isPeerRoutable(p)).toBe(true);

      p.healthy = false;
      expect(peerManager.isPeerRoutable(p)).toBe(false);
      p.healthy = true;

      openCircuit(p);
      expect(peerManager.isPeerRoutable(p)).toBe(false);

      advance(CIRCUIT_COOLDOWN_MS);
      expect(peerManager.isPeerRoutable(p)).toBe(true);

      p.probeInFlight = true;
      expect(peerManager.isPeerRoutable(p)).toBe(false);

      expect(peerManager.isPeerRoutable(null)).toBe(false);
    });

    it('selectBestPeer 优先选时延 EWMA 最低的可用 peer', () => {
      const slow = put(mkPeer('slow', { latencyEwma: 200 }));
      const fast = put(mkPeer('fast', { latencyEwma: 50 }));
      put(mkPeer('down', { latencyEwma: 10, healthy: false }));
      const broken = put(mkPeer('broken', { latencyEwma: 20 }));
      openCircuit(broken);

      const best = peerManager.selectBestPeer();
      expect(best.id).toBe('fast');
      expect(peerManager.getRoutablePeers().map(p => p.id)).toEqual(['fast', 'slow']);
    });

    it('selectBestPeer 选中 half-open peer 时占用唯一探测名额', () => {
      const p = put(mkPeer('p1', { latencyEwma: 10 }));
      openCircuit(p);
      advance(CIRCUIT_COOLDOWN_MS);

      expect(peerManager.selectBestPeer()).toBe(p);
      expect(p.probeInFlight).toBe(true);
      // 名额被占用后不再可路由，也不会重复放行
      expect(peerManager.isPeerRoutable(p)).toBe(false);
      expect(peerManager.selectBestPeer()).toBeNull();

      // 探测成功释放名额
      peerManager.recordSuccess(p, 10);
      expect(p.probeInFlight).toBe(false);
      expect(peerManager.selectBestPeer()).toBe(p);
    });

    it('无可用 peer 时 selectBestPeer 返回 null', () => {
      put(mkPeer('p1', { healthy: false }));
      const p2 = put(mkPeer('p2'));
      openCircuit(p2);
      expect(peerManager.selectBestPeer()).toBeNull();
      expect(peerManager.getRoutablePeers()).toHaveLength(0);
    });
  });

  describe('健康检查接入状态机', () => {
    it('健康探测连续失败打开熔断，冷却后转 half-open', async () => {
      const p = put(mkPeer('p1'));
      probeMcp.mockResolvedValue(null);

      await peerManager._healthCheck();
      await peerManager._healthCheck();
      expect(peerManager.getCircuitState(p)).toBe('closed');
      expect(p.consecutiveFailures).toBe(2);
      expect(p.healthy).toBe(false);

      await peerManager._healthCheck();
      expect(peerManager.getCircuitState(p)).toBe('open');

      advance(CIRCUIT_COOLDOWN_MS);
      expect(peerManager.getCircuitState(p)).toBe('half-open');
    });

    it('健康探测恢复后熔断关闭并记录时延', async () => {
      const p = put(mkPeer('p1'));
      probeMcp.mockResolvedValue(null);
      await peerManager._healthCheck();
      await peerManager._healthCheck();
      await peerManager._healthCheck();
      expect(peerManager.getCircuitState(p)).toBe('open');

      probeMcp.mockResolvedValue({ name: 'atlisp-mcp-server', version: '1.9.9' });
      await peerManager._healthCheck();

      expect(peerManager.getCircuitState(p)).toBe('closed');
      expect(p.consecutiveFailures).toBe(0);
      expect(p.healthy).toBe(true);
      expect(typeof p.latencyEwma).toBe('number');
    });

    it('健康检查失败抛错也计入连续失败', async () => {
      const p = put(mkPeer('p1'));
      probeMcp.mockRejectedValue(new Error('boom'));

      await peerManager._healthCheck();
      await peerManager._healthCheck();
      await peerManager._healthCheck();

      expect(p.consecutiveFailures).toBe(3);
      expect(peerManager.getCircuitState(p)).toBe('open');
    });
  });

  describe('转发闸门（peer-proxy）', () => {
    it('成功转发累计成功指标', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonRes({
        jsonrpc: '2.0', id: 1,
        result: { content: [{ type: 'text', text: 'OK' }] },
      }));
      vi.stubGlobal('fetch', fetchMock);
      const p = put(mkPeer('p1'));

      await peerProxy.forward('p1', request);

      expect(p.forwardSuccess).toBe(1);
      expect(p.forwardFailure).toBe(0);
      expect(p.consecutiveFailures).toBe(0);
      expect(typeof p.latencyEwma).toBe('number');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('连续失败打开熔断后直接拒绝，不再发起 fetch', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error('connection refused'));
      vi.stubGlobal('fetch', fetchMock);
      const p = put(mkPeer('p1'));

      for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i++) {
        await expect(peerProxy.forward('p1', request)).rejects.toThrow('connection refused');
      }
      expect(p.circuit).toBe('open');
      expect(p.forwardFailure).toBe(CIRCUIT_FAILURE_THRESHOLD);

      fetchMock.mockClear();
      await expect(peerProxy.forward('p1', request)).rejects.toThrow(/熔断冷却中/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('冷却到期 half-open 放行一次探测，成功则恢复 closed', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error('connection refused'));
      vi.stubGlobal('fetch', fetchMock);
      const p = put(mkPeer('p1'));

      for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i++) {
        await expect(peerProxy.forward('p1', request)).rejects.toThrow('connection refused');
      }
      advance(CIRCUIT_COOLDOWN_MS);

      fetchMock.mockResolvedValue(jsonRes({
        jsonrpc: '2.0', id: 1,
        result: { content: [{ type: 'text', text: 'OK' }] },
      }));
      await peerProxy.forward('p1', request);

      expect(p.circuit).toBe('closed');
      expect(p.consecutiveFailures).toBe(0);
      expect(p.forwardSuccess).toBe(1);
    });

    it('half-open 探测名额被占用时拒绝并发请求', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const p = put(mkPeer('p1'));
      openCircuit(p);
      advance(CIRCUIT_COOLDOWN_MS);
      // 触发惰性转换为 half-open，并占用唯一探测名额
      expect(peerManager.getCircuitState(p)).toBe('half-open');
      p.probeInFlight = true;

      await expect(peerProxy.forward('p1', request)).rejects.toThrow(/探测进行中/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('half-open 探测失败重新打开熔断', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error('connection refused'));
      vi.stubGlobal('fetch', fetchMock);
      const p = put(mkPeer('p1'));
      openCircuit(p);
      advance(CIRCUIT_COOLDOWN_MS);
      expect(peerManager.getCircuitState(p)).toBe('half-open');

      await expect(peerProxy.forward('p1', request)).rejects.toThrow('connection refused');
      expect(p.circuit).toBe('open');
      expect(p.circuitOpenedAt).toBe(now);

      fetchMock.mockClear();
      await expect(peerProxy.forward('p1', request)).rejects.toThrow(/熔断冷却中/);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
