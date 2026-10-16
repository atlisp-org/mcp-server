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

describe('peer-manager static peers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    configMock.remotePeer = null;
    configMock.peerDiscovery.peers = [];
    probeMcp.mockResolvedValue({ name: 'atlisp-mcp-server', version: '1.9.9' });
    discoveryGetPeer.mockReturnValue(null);
    peerManager.stop();
  });

  afterEach(() => {
    peerManager.stop();
  });

  it('registers config.remotePeer and config.peerDiscovery.peers on start', async () => {
    configMock.remotePeer = { host: '10.0.0.5', port: 9999, apiKey: 'k', autoForward: true };
    configMock.peerDiscovery.peers = [{ host: '192.168.1.10', port: 8200, apikey: 'k2' }];

    peerManager.start();
    await tick();

    const remote = peerManager.getRemotePeer();
    expect(remote).not.toBeNull();
    expect(remote.host).toBe('10.0.0.5');
    expect(remote.port).toBe(9999);
    expect(remote.apikey).toBe('k');
    expect(remote.static).toBe(true);
    expect(remote.healthy).toBe(true);

    const staticPeer = peerManager.getPeers().find(p => p.host === '192.168.1.10');
    expect(staticPeer).toBeDefined();
    expect(staticPeer.port).toBe(8200);
    expect(staticPeer.static).toBe(true);
  });

  it('skips remotePeer pointing to self (same host+port)', async () => {
    configMock.remotePeer = { host: '127.0.0.1', port: 8110, autoForward: true };

    peerManager.start();
    await tick();

    expect(peerManager.getRemotePeer()).toBeNull();
    expect(peerManager.getPeers()).toHaveLength(0);
  });

  it('health check keeps static peers, removes stale discovered peers', async () => {
    peerManager.addPeer('10.0.0.9', 8110, { static: true });
    await tick();

    // 模拟一个已发现的（非 static）peer 随后从 discovery 中消失
    peerManager._peers.set('disc-1', {
      id: 'disc-1',
      host: '10.0.0.50',
      port: 8110,
      version: '1.0',
      hostname: '10.0.0.50',
      url: 'http://10.0.0.50:8110',
      connected: true,
      healthy: true,
      lastSeen: Date.now(),
      lastHealthCheck: 0,
      static: false,
    });
    discoveryGetPeer.mockReturnValue(null);

    await peerManager._healthCheck();

    expect(peerManager.getPeer('disc-1')).toBeNull();
    expect(peerManager.getPeer('manual-10.0.0.9-8110')).not.toBeNull();
  });

  it('addPeer marks static flag and getRemotePeer is null when unconfigured', async () => {
    const p = peerManager.addPeer('10.0.0.7', 8110, { static: true });
    expect(p.static).toBe(true);
    const p2 = peerManager.addPeer('10.0.0.8', 8110, {});
    expect(p2.static).toBe(false);
    expect(peerManager.getRemotePeer()).toBeNull();
  });
});
