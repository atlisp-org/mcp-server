import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { configMock, probeMcp, discoveryGetPeer, cleanupStale } = vi.hoisted(() => ({
  configMock: {
    port: 8110,
    remotePeer: null,
    peerDiscovery: { enabled: false, port: 9811, broadcastInterval: 5000, silent: true, peers: [] },
  },
  probeMcp: vi.fn(),
  discoveryGetPeer: vi.fn(),
  cleanupStale: vi.fn(),
}));

vi.mock('../src/config.js', () => ({
  default: configMock,
}));
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
vi.mock('../src/logger.js', () => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  closeLog: vi.fn(),
}));

const peerManager = (await import('../src/peer-manager.js')).default;

const tick = () => new Promise(r => setTimeout(r, 10));

// 模拟 discovery 广播到的 peer（id 为进程实例 ID，每次重启都变）
const announced = (id, host = '192.168.1.53', port = 8110, extra = {}) => ({
  id,
  host,
  port,
  version: '1.9.12',
  hostname: 'cad1',
  lastSeen: Date.now(),
  ...extra,
});

describe('peer-manager 同地址去重（实例 ID 漂移）', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    configMock.remotePeer = null;
    configMock.peerDiscovery.peers = [];
    probeMcp.mockResolvedValue({ name: 'atlisp-mcp-server', version: '1.9.12' });
    discoveryGetPeer.mockReturnValue(null);
    peerManager.stop();
  });

  afterEach(() => {
    peerManager.stop();
  });

  it('同一地址以不同实例 ID 重复广播时只保留一条（id 跟随最新）', async () => {
    peerManager._onPeerDiscovered(announced('aaaa1111-001'));
    await tick();
    peerManager._onPeerDiscovered(announced('bbbb2222-002'));
    await tick();

    const peers = peerManager.getPeers().filter(p => p.url === 'http://192.168.1.53:8110');
    expect(peers).toHaveLength(1);
    expect(peers[0].id).toBe('bbbb2222-002');
  });

  it('历史堆积的多条同地址条目在下次广播时归一为一条', async () => {
    // 模拟部署端观察到的状态：同一地址 7 条、id 各不相同
    for (const id of ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7']) {
      peerManager._peers.set(id, {
        id,
        host: '192.168.1.53',
        port: 8110,
        version: '1.9.12',
        hostname: 'cad1',
        url: 'http://192.168.1.53:8110',
        connected: true,
        healthy: true,
        lastSeen: Date.now(),
        lastHealthCheck: 0,
      });
    }
    expect(peerManager.getPeers()).toHaveLength(7);

    peerManager._onPeerDiscovered(announced('b8', '192.168.1.53'));
    await tick();

    const peers = peerManager.getPeers().filter(p => p.url === 'http://192.168.1.53:8110');
    expect(peers).toHaveLength(1);
  });

  it('静态 remote-* 条目与同地址发现广播合并时保住 remote-* id', async () => {
    configMock.remotePeer = { host: '192.168.1.53', port: 8110, apiKey: 'k' };
    peerManager.start();
    await tick();

    peerManager._onPeerDiscovered(announced('c9'));
    await tick();

    const peers = peerManager.getPeers().filter(p => p.url === 'http://192.168.1.53:8110');
    expect(peers).toHaveLength(1);
    expect(peers[0].id).toBe('remote-192.168.1.53-8110');
    expect(peers[0].static).toBe(true);
    // 自动转发依赖按 remote-* id 查找
    expect(peerManager.getRemotePeer()).not.toBeNull();
  });

  it('addPeer（手动）与已存在的同地址发现条目合并，不新增行', async () => {
    peerManager._onPeerDiscovered(announced('d1'));
    await tick();

    peerManager.addPeer('192.168.1.53', 8110, {});
    await tick();

    expect(peerManager.getPeers()).toHaveLength(1);
    expect(peerManager.getPeers()[0].id).toBe('d1');
  });

  it('addPeer 以 remote-* 稳定 id 合并时改键为 remote-*', async () => {
    peerManager._onPeerDiscovered(announced('e1'));
    await tick();

    const p = peerManager.addPeer('192.168.1.53', 8110, {
      id: 'remote-192.168.1.53-8110',
      static: true,
      apikey: 'k',
    });
    await tick();

    expect(p.id).toBe('remote-192.168.1.53-8110');
    expect(p.static).toBe(true);
    expect(peerManager.getPeers()).toHaveLength(1);
    expect(peerManager.getPeer('e1')).toBeNull();
  });

  it('堆积条目中 remote-* 不在首位时，归一后仍保住 remote-* 条目', async () => {
    configMock.remotePeer = { host: '192.168.1.53', port: 8110 };
    const mk = (id, staticFlag) => ({
      id,
      host: '192.168.1.53',
      port: 8110,
      version: '1.9.12',
      hostname: 'cad1',
      url: 'http://192.168.1.53:8110',
      connected: true,
      healthy: true,
      lastSeen: Date.now(),
      lastHealthCheck: 0,
      static: staticFlag,
    });
    peerManager._peers.set('z1', mk('z1', false));
    peerManager._peers.set('remote-192.168.1.53-8110', mk('remote-192.168.1.53-8110', true));
    peerManager._peers.set('z2', mk('z2', false));

    peerManager._onPeerDiscovered(announced('z9'));
    await tick();

    const peers = peerManager.getPeers().filter(p => p.url === 'http://192.168.1.53:8110');
    expect(peers).toHaveLength(1);
    expect(peers[0].id).toBe('remote-192.168.1.53-8110');
    expect(peerManager.getRemotePeer()).not.toBeNull();
  });

  it('不同地址不受影响（不过度合并）', async () => {
    peerManager._onPeerDiscovered(announced('f1', '192.168.1.53'));
    await tick();
    peerManager._onPeerDiscovered(announced('f2', '192.168.1.55'));
    await tick();

    expect(peerManager.getPeers()).toHaveLength(2);
    expect(peerManager.getPeerByUrl('http://192.168.1.53:8110').id).toBe('f1');
    expect(peerManager.getPeerByUrl('http://192.168.1.55:8110').id).toBe('f2');
  });
});
