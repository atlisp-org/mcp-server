// @ts-check
import { log, error as logError } from './logger.js';
import config from './config.js';
import peerDiscovery from './peer-discovery.js';

const HEALTH_CHECK_INTERVAL = 30000;
const HEALTH_CHECK_TIMEOUT = 5000;

/**
 * @typedef {{
 *   id: string,
 *   host: string,
 *   port: number,
 *   version: string,
 *   hostname: string,
 *   url: string,
 *   connected: boolean,
 *   healthy: boolean,
 *   lastSeen: number,
 *   lastHealthCheck: number,
 *   apikey?: string
 * }} ManagedPeer
 */

class PeerManager {
  /** @type {Map<string, ManagedPeer>} */
  _peers = new Map();
  /** @type {NodeJS.Timeout|null} */
  _healthTimer = null;
  /** @type {Function|null} */
  _onPeersChanged = null;

  constructor() {
    peerDiscovery.onPeerFound((peer) => this._onPeerDiscovered(peer));
    peerDiscovery.onPeerLost((peer) => this._onPeerLost(peer));
  }

  /**
   * 启动 peer 管理器
   */
  start() {
    this._loadStaticPeers();
    peerDiscovery.start();
    this._startHealthCheck();
    log('Peer manager started');
  }

  /**
   * 注册静态配置的 peer（config.remotePeer 与 config.peerDiscovery.peers）
   */
  _loadStaticPeers() {
    const rp = config.remotePeer;
    if (rp && rp.host) {
      this._addStaticPeer(rp.host, rp.port || 8110, {
        id: `remote-${rp.host}-${rp.port || 8110}`,
        apikey: rp.apiKey,
      });
    }
    for (const p of config.peerDiscovery?.peers || []) {
      if (!p.host) continue;
      this._addStaticPeer(p.host, p.port || 8110, {
        id: p.id,
        hostname: p.hostname,
        version: p.version,
        apikey: p.apikey,
      });
    }
  }

  /**
   * 添加静态 peer（跳过本机自身，防止转发循环）
   */
  _addStaticPeer(host, port, options = {}) {
    const selfHosts = ['127.0.0.1', 'localhost', '::1'];
    if (selfHosts.includes(host) && port === config.port) {
      logError(`静态 peer 指向本机自身 (${host}:${port})，已跳过`);
      return;
    }
    const peer = this.addPeer(host, port, { ...options, static: true });
    peer.static = true;
  }

  /**
   * 获取 config.remotePeer 对应的 peer（自动转发目标）
   * @returns {ManagedPeer|null}
   */
  getRemotePeer() {
    const rp = config.remotePeer;
    if (!rp || !rp.host) return null;
    return this._peers.get(`remote-${rp.host}-${rp.port || 8110}`) || null;
  }

  /**
   * 停止 peer 管理器
   */
  stop() {
    this._stopHealthCheck();
    peerDiscovery.stop();
    this._peers.clear();
    log('Peer manager stopped');
  }

  /**
   * 处理新发现的 peer
   */
  _onPeerDiscovered(peer) {
    const url = `http://${peer.host}:${peer.port}`;
    const managedPeer = {
      id: peer.id,
      host: peer.host,
      port: peer.port,
      version: peer.version,
      hostname: peer.hostname,
      url,
      connected: false,
      healthy: true,
      lastSeen: Date.now(),
      lastHealthCheck: 0,
      apikey: peer.apikey,
    };

    this._peers.set(peer.id, managedPeer);
    this._probePeer(managedPeer);
    this._notifyPeersChanged();
  }

  /**
   * 处理 peer 离线
   */
  _onPeerLost(peer) {
    const managed = this._peers.get(peer.id);
    if (managed) {
      managed.healthy = false;
      managed.connected = false;
      log(`Peer offline: ${managed.hostname} (${managed.url})`);
      this._notifyPeersChanged();
    }
  }

  /**
   * 探测 peer 是否可达
   */
  async _probePeer(peer) {
    try {
      const { probeMcp } = await import('./mcp-scanner.js');
      const result = await probeMcp(peer.host, peer.port, HEALTH_CHECK_TIMEOUT, peer.apikey);

      if (result) {
        peer.connected = true;
        peer.healthy = true;
        peer.lastSeen = Date.now();
        log(`Peer reachable: ${peer.hostname} (${peer.url})`);
      } else {
        peer.connected = false;
        peer.healthy = false;
      }
    } catch {
      peer.connected = false;
      peer.healthy = false;
    }
  }

  /**
   * 启动健康检查
   */
  _startHealthCheck() {
    if (this._healthTimer) clearInterval(this._healthTimer);
    this._healthTimer = setInterval(() => this._healthCheck(), HEALTH_CHECK_INTERVAL);
  }

  /**
   * 停止健康检查
   */
  _stopHealthCheck() {
    if (this._healthTimer) {
      clearInterval(this._healthTimer);
      this._healthTimer = null;
    }
  }

  /**
   * 执行健康检查
   */
  async _healthCheck() {
    peerDiscovery.cleanupStale();

    for (const [id, peer] of this._peers) {
      if (!peer.static && !peerDiscovery.getPeer(id)) {
        this._peers.delete(id);
        log(`Peer removed (not in discovery): ${peer.hostname}`);
        continue;
      }

      try {
        const { probeMcp } = await import('./mcp-scanner.js');
        const result = await probeMcp(peer.host, peer.port, HEALTH_CHECK_TIMEOUT, peer.apikey);
        const wasHealthy = peer.healthy;

        peer.healthy = !!result;
        peer.connected = !!result;
        peer.lastHealthCheck = Date.now();

        if (result) {
          peer.lastSeen = Date.now();
        }

        if (wasHealthy && !peer.healthy) {
          log(`Peer unhealthy: ${peer.hostname} (${peer.url})`);
          this._notifyPeersChanged();
        } else if (!wasHealthy && peer.healthy) {
          log(`Peer recovered: ${peer.hostname} (${peer.url})`);
          this._notifyPeersChanged();
        }
      } catch {
        if (peer.healthy) {
          peer.healthy = false;
          peer.connected = false;
          log(`Peer health check failed: ${peer.hostname}`);
          this._notifyPeersChanged();
        }
      }
    }
  }

  /**
   * 获取所有 peer
   */
  getPeers() {
    return Array.from(this._peers.values());
  }

  /**
   * 获取健康的 peer
   */
  getHealthyPeers() {
    return this.getPeers().filter(p => p.healthy);
  }

  /**
   * 获取指定 peer
   */
  getPeer(id) {
    return this._peers.get(id) || null;
  }

  /**
   * 按 URL 获取 peer
   */
  getPeerByUrl(url) {
    for (const peer of this._peers.values()) {
      if (peer.url === url) return peer;
    }
    return null;
  }

  /**
   * 手动添加 peer
   */
  addPeer(host, port = 8110, options = {}) {
    const id = options.id || `manual-${host}-${port}`;
    const url = `http://${host}:${port}`;

    if (this._peers.has(id)) {
      return this._peers.get(id);
    }

    const peer = {
      id,
      host,
      port,
      version: options.version || 'manual',
      hostname: options.hostname || host,
      url,
      connected: false,
      healthy: false,
      lastSeen: Date.now(),
      lastHealthCheck: 0,
      apikey: options.apikey,
      static: !!options.static,
    };

    this._peers.set(id, peer);
    this._probePeer(peer);
    this._notifyPeersChanged();
    log(`Manual peer added: ${peer.hostname} (${url})`);
    return peer;
  }

  /**
   * 移除 peer
   */
  removePeer(id) {
    const peer = this._peers.get(id);
    if (peer) {
      this._peers.delete(id);
      this._notifyPeersChanged();
      log(`Peer removed: ${peer.hostname}`);
      return true;
    }
    return false;
  }

  /**
   * 触发 LAN 扫描
   */
  async scanLan(opts = {}) {
    try {
      const { scanLan } = await import('./mcp-scanner.js');
      const found = await scanLan({
        port: opts.port || config.port,
        timeoutMs: opts.timeoutMs || 500,
        concurrency: opts.concurrency || 32,
        maxHosts: opts.maxHosts || 254,
      });

      for (const f of found) {
        const id = `lan-${f.ip.replace(/\./g, '-')}`;
        if (!this._peers.has(id)) {
          this.addPeer(f.ip, f.port, {
            id,
            hostname: f.serverInfo?.name || f.ip,
            version: f.serverInfo?.version,
          });
        }
      }

      return found;
    } catch (e) {
      logError('LAN scan error:', e.message);
      return [];
    }
  }

  /**
   * 注册 peers 变更回调
   */
  onPeersChanged(fn) {
    this._onPeersChanged = fn;
  }

  /**
   * 通知 peers 变更
   */
  _notifyPeersChanged() {
    if (this._onPeersChanged) {
      try { this._onPeersChanged(this.getPeers()); } catch (e) { logError('Peers changed callback error:', e.message); }
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const peers = this.getPeers();
    return {
      total: peers.length,
      healthy: peers.filter(p => p.healthy).length,
      connected: peers.filter(p => p.connected).length,
      peers: peers.map(p => ({
        id: p.id,
        hostname: p.hostname,
        url: p.url,
        version: p.version,
        healthy: p.healthy,
        lastSeenAgo: Date.now() - p.lastSeen,
      })),
    };
  }
}

const peerManager = new PeerManager();
export default peerManager;
