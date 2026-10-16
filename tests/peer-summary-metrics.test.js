import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { configMock, peerManagerMock, loggerMock } = vi.hoisted(() => ({
  configMock: { port: 8110, remotePeer: null, apiKey: '' },
  peerManagerMock: {
    scanLan: vi.fn(),
    getPeers: vi.fn(),
    getCircuitState: vi.fn(),
    isPeerRoutable: vi.fn(),
    getPeer: vi.fn(),
    getPeerByUrl: vi.fn(),
    getRemotePeer: vi.fn(),
    selectBestPeer: vi.fn(),
    recordForwardResult: vi.fn(),
    addPeer: vi.fn(),
    removePeer: vi.fn(),
    getStats: vi.fn(),
  },
  loggerMock: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), closeLog: vi.fn() },
}));

vi.mock('../src/config.js', () => ({ default: configMock }));
vi.mock('../src/peer-manager.js', () => ({ default: peerManagerMock }));
vi.mock('../src/logger.js', () => loggerMock);

const { peer_summary } = await import('../src/handlers/peer-handlers.js');

const fetchMock = vi.fn();

const cadInfoResponse = () => ({
  json: async () => ({
    result: {
      content: [{ type: 'text', text: 'Connected, Platform: AutoCAD, Version: 24.1' }],
    },
  }),
});

const docResponse = () => ({
  json: async () => ({
    result: {
      content: [{ type: 'text', text: '(plan.dwg C:\\dwg\\ 建筑)' }],
    },
  }),
});

describe('peer_summary 转发指标', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    peerManagerMock.scanLan.mockResolvedValue([{ ip: '192.168.1.53', port: 8110 }]);
    fetchMock
      .mockResolvedValueOnce(cadInfoResponse())
      .mockResolvedValueOnce(docResponse());
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('输出每个 peer 的转发指标字段', async () => {
    const peer = {
      id: 'remote-192.168.1.53-8110',
      host: '192.168.1.53',
      port: 8110,
      url: 'http://192.168.1.53:8110',
      hostname: 'cad1',
      version: '1.9.9',
      healthy: true,
      connected: true,
      lastSeen: Date.now(),
      lastHealthCheck: 0,
      circuit: 'closed',
      consecutiveFailures: 0,
      latencyEwma: 42.4,
      forwardSuccess: 3,
      forwardFailure: 1,
      lastSuccess: Date.now() - 5000,
      lastFailure: Date.now() - 60000,
    };
    peerManagerMock.getPeers.mockReturnValue([peer]);
    peerManagerMock.getCircuitState.mockReturnValue('closed');
    peerManagerMock.isPeerRoutable.mockReturnValue(true);

    const result = await peer_summary({});
    const text = result.content[0].text;

    expect(text).toContain('Peer 转发指标:');
    expect(text).toContain(peer.id);
    expect(text).toContain('[熔断:closed|可路由]');
    expect(text).toContain('连续失败=0');
    expect(text).toContain('转发成功=3');
    expect(text).toContain('失败=1');
    expect(text).toContain('时延EWMA=42ms');
    expect(text).toContain('最近成功=5s前');
    expect(text).toContain('最近失败=60s前');
    expect(peerManagerMock.getCircuitState).toHaveBeenCalledWith(peer);
    expect(peerManagerMock.isPeerRoutable).toHaveBeenCalledWith(peer);

    // 汇总主体仍输出文档信息
    expect(text).toContain('plan.dwg');
  });

  it('熔断 open 且不可路由时如实标注', async () => {
    const peer = {
      id: 'peer-broken',
      url: 'http://192.168.1.60:8110',
      hostname: 'broken',
      healthy: false,
      circuit: 'open',
      consecutiveFailures: 5,
      latencyEwma: 120,
      forwardSuccess: 7,
      forwardFailure: 5,
      lastSuccess: Date.now() - 300000,
      lastFailure: Date.now() - 1000,
    };
    peerManagerMock.getPeers.mockReturnValue([peer]);
    peerManagerMock.getCircuitState.mockReturnValue('open');
    peerManagerMock.isPeerRoutable.mockReturnValue(false);

    const result = await peer_summary({});
    const text = result.content[0].text;

    expect(text).toContain('[熔断:open|不可路由]');
    expect(text).toContain('连续失败=5');
    expect(text).toContain('转发成功=7');
    expect(text).toContain('失败=5');
    expect(text).toContain('时延EWMA=120ms');
  });

  it('无已注册 peer 时提示无指标', async () => {
    peerManagerMock.getPeers.mockReturnValue([]);

    const result = await peer_summary({});
    expect(result.content[0].text).toContain('暂无已注册 peer，无转发指标');
  });
});
