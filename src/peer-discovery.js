// @ts-check
import dgram from 'dgram';
import os from 'os';
import { randomUUID } from 'crypto';
import { log, error as logError } from './logger.js';
import config from './config.js';

const DEFAULT_BROADCAST_PORT = 9811;
const DEFAULT_BROADCAST_INTERVAL = 5000;
const BROADCAST_ADDRESS = '255.255.255.255';
const PEER_TIMEOUT = 15000;

/**
 * @typedef {{
 *   id: string,
 *   host: string,
 *   port: number,
 *   version: string,
 *   hostname: string,
 *   lastSeen: number,
 *   apikey?: string
 * }} PeerInfo
 */

class PeerDiscovery {
  /** @type {dgram.Socket|null} */
  _socket = null;
  /** @type {NodeJS.Timeout|null} */
  _broadcastTimer = null;
  /** @type {Map<string, PeerInfo>} */
  _peers = new Map();
  /** @type {string} */
  _instanceId;
  /** @type {number} */
  _broadcastPort;
  /** @type {number} */
  _broadcastInterval;
  /** @type {boolean} */
  _silent;
  /** @type {Function[]} */
  _onPeerFound = [];
  /** @type {Function[]} */
  _onPeerLost = [];

  constructor() {
    this._instanceId = randomUUID().slice(0, 12);
    this._broadcastPort = config.peerDiscovery?.port ?? DEFAULT_BROADCAST_PORT;
    this._broadcastInterval = config.peerDiscovery?.broadcastInterval ?? DEFAULT_BROADCAST_INTERVAL;
    this._silent = config.peerDiscovery?.silent ?? false;
  }

  /**
   * 启动 UDP 发现服务
   */
  start() {
    if (!config.peerDiscovery?.enabled) {
      log('Peer discovery disabled');
      return;
    }

    try {
      this._socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this._socket.on('message', (msg, rinfo) => {
        this._handleMessage(msg, rinfo);
      });

      this._socket.on('error', (err) => {
        logError('Peer discovery UDP error:', err.message);
      });

      this._socket.bind(this._broadcastPort, () => {
        try {
          this._socket.setBroadcast(true);
          log(`Peer discovery started on UDP port ${this._broadcastPort}`);

          if (!this._silent) {
            this._startBroadcasting();
          }

          this._addStaticPeers();
        } catch (e) {
          logError('Peer discovery setup error:', e.message);
        }
      });
    } catch (e) {
      logError('Peer discovery start error:', e.message);
    }
  }

  /**
   * 停止 UDP 发现服务
   */
  stop() {
    if (this._broadcastTimer) {
      clearInterval(this._broadcastTimer);
      this._broadcastTimer = null;
    }

    if (this._socket) {
      try {
        this._socket.close();
      } catch {
        // 忽略关闭异常，socket 可能已释放
      }
      this._socket = null;
    }

    log('Peer discovery stopped');
  }

  /**
   * 发送广播消息
   */
  _broadcast() {
    if (!this._socket || this._silent) return;

    this._getVersion().then(version => {
      const msg = JSON.stringify({
        type: 'mcp-peer-announce',
        id: this._instanceId,
        host: this._getLocalIp(),
        port: config.port,
        version,
        hostname: os.hostname(),
        timestamp: Date.now(),
      });

      const buf = Buffer.from(msg);
      this._socket.send(buf, 0, buf.length, this._broadcastPort, BROADCAST_ADDRESS, (err) => {
        if (err) {
          logError('Peer broadcast error:', err.message);
        }
      });
    });
  }

  /**
   * 处理接收到的 UDP 消息
   */
  _handleMessage(msg, rinfo) {
    try {
      const data = JSON.parse(msg.toString());

      if (data.type !== 'mcp-peer-announce') return;
      if (data.id === this._instanceId) return;

      const peer = {
        id: data.id,
        host: data.host || rinfo.address,
        port: data.port || 8110,
        version: data.version || 'unknown',
        hostname: data.hostname || 'unknown',
        lastSeen: Date.now(),
      };

      const existing = this._peers.get(peer.id);
      if (!existing) {
        this._peers.set(peer.id, peer);
        log(`Peer discovered: ${peer.hostname} (${peer.host}:${peer.port})`);
        this._emit('peerFound', peer);
      } else {
        existing.lastSeen = Date.now();
      }
    } catch {
      // 忽略非 JSON 或格式异常广播
    }
  }

  /**
   * 添加静态配置的 peer
   */
  _addStaticPeers() {
    const staticPeers = config.peerDiscovery?.peers || [];
    for (const p of staticPeers) {
      const peer = {
        id: p.id || `static-${p.host}-${p.port}`,
        host: p.host,
        port: p.port || 8110,
        version: p.version || 'static',
        hostname: p.hostname || p.host,
        lastSeen: Date.now(),
        apikey: p.apikey,
      };
      if (!this._peers.has(peer.id)) {
        this._peers.set(peer.id, peer);
        log(`Static peer added: ${peer.hostname} (${peer.host}:${peer.port})`);
      }
    }
  }

  /**
   * 开始定期广播
   */
  _startBroadcasting() {
    this._broadcast();
    this._broadcastTimer = setInterval(() => this._broadcast(), this._broadcastInterval);
  }

  /**
   * 获取本地 IP 地址
   */
  _getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const [, ifaces] of Object.entries(interfaces)) {
      for (const iface of ifaces || []) {
        if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }

  /**
   * 获取版本号
   */
  async _getVersion() {
    try {
      const { createRequire } = await import('module');
      const require = createRequire(import.meta.url);
      const pkg = require('../package.json');
      return pkg.version;
    } catch {
      // package.json 不可读时回退
    }
    return 'unknown';
  }

  /**
   * 获取所有已发现的 peer
   */
  getPeers() {
    return Array.from(this._peers.values());
  }

  /**
   * 获取指定 peer
   */
  getPeer(id) {
    return this._peers.get(id) || null;
  }

  /**
   * 移除 peer
   */
  removePeer(id) {
    const peer = this._peers.get(id);
    if (peer) {
      this._peers.delete(id);
      log(`Peer removed: ${peer.hostname}`);
      this._emit('peerLost', peer);
    }
  }

  /**
   * 清理超时的 peer
   */
  cleanupStale() {
    const now = Date.now();
    for (const [id, peer] of this._peers) {
      if (now - peer.lastSeen > PEER_TIMEOUT) {
        this._peers.delete(id);
        log(`Peer timed out: ${peer.hostname}`);
        this._emit('peerLost', peer);
      }
    }
  }

  /**
   * 注册 peer 发现回调
   */
  onPeerFound(fn) {
    this._onPeerFound.push(fn);
  }

  /**
   * 注册 peer 离线回调
   */
  onPeerLost(fn) {
    this._onPeerLost.push(fn);
  }

  /**
   * 触发事件
   */
  _emit(event, peer) {
    const handlers = event === 'peerFound' ? this._onPeerFound : this._onPeerLost;
    for (const fn of handlers) {
      try { fn(peer); } catch (e) { logError(`Peer ${event} callback error:`, e.message); }
    }
  }

  /**
   * 手动触发扫描（发送一次广播）
   */
  scan() {
    this._broadcast();
  }

  /**
   * 获取实例 ID
   */
  getInstanceId() {
    return this._instanceId;
  }
}

const peerDiscovery = new PeerDiscovery();
export default peerDiscovery;
