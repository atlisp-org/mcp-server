// @ts-check
import { log, error as logError } from './logger.js';
import config from './config.js';
import peerDiscovery from './peer-discovery.js';

const HEALTH_CHECK_INTERVAL = 30000;
const HEALTH_CHECK_TIMEOUT = 5000;

/** 熔断状态机：连续失败达到该阈值即打开熔断 */
export const CIRCUIT_FAILURE_THRESHOLD = 3;
/** 熔断状态机：open 冷却期（毫秒），到期允许放行一次 half-open 探测 */
export const CIRCUIT_COOLDOWN_MS = 30000;
/** 时延 EWMA 平滑系数（新样本权重） */
export const LATENCY_EWMA_ALPHA = 0.3;
/** 排序用：无时延样本视为最慢 */
const MAX_LATENCY = Number.MAX_SAFE_INTEGER;

/**
 * @typedef {'closed'|'open'|'half-open'} CircuitState
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
 *   apikey?: string,
 *   circuit?: CircuitState,
 *   circuitOpenedAt?: number,
 *   consecutiveFailures?: number,
 *   lastSuccess?: number,
 *   lastFailure?: number,
 *   latencyEwma?: number|null,
 *   probeInFlight?: boolean,
 *   forwardSuccess?: number,
 *   forwardFailure?: number,
 *   lastForwardAt?: number
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
    // host === 'auto' 表示"总是自动选路"，不注册固定 peer
    if (rp && rp.host && rp.host !== 'auto') {
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
    if (!rp || !rp.host || rp.host === 'auto') return null;
    return this._peers.get(`remote-${rp.host}-${rp.port || 8110}`) || null;
  }

  // ===== 熔断状态机 + 转发指标 =====

  /**
   * 初始化 peer 的熔断/指标字段（幂等）
   * @param {ManagedPeer} peer
   * @returns {ManagedPeer}
   */
  _ensureCircuit(peer) {
    if (peer.circuit === undefined) peer.circuit = 'closed';
    if (peer.circuitOpenedAt === undefined) peer.circuitOpenedAt = 0;
    if (peer.consecutiveFailures === undefined) peer.consecutiveFailures = 0;
    if (peer.lastSuccess === undefined) peer.lastSuccess = 0;
    if (peer.lastFailure === undefined) peer.lastFailure = 0;
    if (peer.latencyEwma === undefined) peer.latencyEwma = null;
    if (peer.probeInFlight === undefined) peer.probeInFlight = false;
    if (peer.forwardSuccess === undefined) peer.forwardSuccess = 0;
    if (peer.forwardFailure === undefined) peer.forwardFailure = 0;
    if (peer.lastForwardAt === undefined) peer.lastForwardAt = 0;
    return peer;
  }

  /**
   * 获取熔断状态（open 冷却到期时惰性转为 half-open，无需定时器）
   * @param {ManagedPeer|string|null|undefined} peerOrId - peer 对象或 id
   * @returns {CircuitState|null} null 表示 peer 不存在
   */
  getCircuitState(peerOrId) {
    const peer = typeof peerOrId === 'string' ? this._peers.get(peerOrId) : peerOrId;
    if (!peer) return null;
    this._ensureCircuit(peer);
    if (peer.circuit === 'open' && Date.now() - (peer.circuitOpenedAt || 0) >= CIRCUIT_COOLDOWN_MS) {
      peer.circuit = 'half-open';
      peer.probeInFlight = false;
      log(`Peer circuit half-open (冷却到期): ${peer.hostname} (${peer.url})`);
    }
    return peer.circuit;
  }

  /**
   * 记录一次成功（健康探测/转发）：清零连续失败并关闭熔断
   * @param {ManagedPeer} peer
   * @param {number} [latencyMs] - 本次耗时（毫秒）
   */
  recordSuccess(peer, latencyMs) {
    if (!peer) return;
    this._ensureCircuit(peer);
    const prev = peer.circuit;
    this.getCircuitState(peer);
    peer.consecutiveFailures = 0;
    peer.circuit = 'closed';
    peer.circuitOpenedAt = 0;
    peer.probeInFlight = false;
    peer.lastSuccess = Date.now();
    this._recordLatency(peer, latencyMs);
    if (prev === 'open' || prev === 'half-open') {
      log(`Peer circuit closed (恢复): ${peer.hostname} (${peer.url})`);
    }
  }

  /**
   * 记录一次失败（健康探测/转发）：连续失败达阈值打开熔断；
   * half-open 中再失败则重新打开并重置冷却期
   * @param {ManagedPeer} peer
   * @param {number} [latencyMs] - 本次耗时（毫秒）
   */
  recordFailure(peer, latencyMs) {
    if (!peer) return;
    this._ensureCircuit(peer);
    const state = this.getCircuitState(peer);
    peer.consecutiveFailures = (peer.consecutiveFailures || 0) + 1;
    peer.lastFailure = Date.now();
    peer.probeInFlight = false;
    this._recordLatency(peer, latencyMs);
    if (peer.circuit !== 'open' &&
        (state === 'half-open' || peer.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD)) {
      peer.circuit = 'open';
      peer.circuitOpenedAt = Date.now();
      log(`Peer circuit OPEN (${peer.consecutiveFailures} 连续失败): ${peer.hostname} (${peer.url})`);
    }
  }

  /**
   * 更新时延 EWMA
   * @param {ManagedPeer} peer
   * @param {number} [latencyMs]
   */
  _recordLatency(peer, latencyMs) {
    if (typeof latencyMs !== 'number' || !Number.isFinite(latencyMs) || latencyMs < 0) return;
    peer.latencyEwma = (peer.latencyEwma === null || peer.latencyEwma === undefined)
      ? latencyMs
      : LATENCY_EWMA_ALPHA * latencyMs + (1 - LATENCY_EWMA_ALPHA) * peer.latencyEwma;
  }

  /**
   * 记录一次转发结果（成功/失败 + 耗时），并驱动熔断状态机
   * @param {ManagedPeer} peer
   * @param {boolean} ok
   * @param {number} [latencyMs]
   */
  recordForwardResult(peer, ok, latencyMs) {
    if (!peer) return;
    this._ensureCircuit(peer);
    peer.lastForwardAt = Date.now();
    if (ok) {
      peer.forwardSuccess = (peer.forwardSuccess || 0) + 1;
      this.recordSuccess(peer, latencyMs);
    } else {
      peer.forwardFailure = (peer.forwardFailure || 0) + 1;
      this.recordFailure(peer, latencyMs);
    }
  }

  /**
   * 是否可作为转发目标：健康 且 熔断 closed/half-open（half-open 未被探测占用）
   * @param {ManagedPeer} peer
   * @returns {boolean}
   */
  isPeerRoutable(peer) {
    if (!peer) return false;
    this._ensureCircuit(peer);
    if (!peer.healthy) return false;
    const state = this.getCircuitState(peer);
    if (state === 'open') return false;
    if (state === 'half-open' && peer.probeInFlight) return false;
    return true;
  }

  /**
   * 可路由 peer 列表，按时延 EWMA 升序（无样本视为最慢）
   * @returns {ManagedPeer[]}
   */
  getRoutablePeers() {
    return this.getPeers()
      .filter(p => this.isPeerRoutable(p))
      .sort((a, b) => {
        const la = typeof a.latencyEwma === 'number' ? a.latencyEwma : MAX_LATENCY;
        const lb = typeof b.latencyEwma === 'number' ? b.latencyEwma : MAX_LATENCY;
        return la - lb;
      });
  }

  /**
   * 自动选路：返回时延 EWMA 最低的可用 peer；
   * 选中 half-open peer 时占用其唯一探测名额（probeInFlight）
   * @returns {ManagedPeer|null}
   */
  selectBestPeer() {
    const best = this.getRoutablePeers()[0];
    if (!best) return null;
    if (this.getCircuitState(best) === 'half-open') best.probeInFlight = true;
    return best;
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
   *
   * 发现用的 id 是 peer 进程的实例 ID（randomUUID，每次重启都变），
   * 同一地址每重启一次就会以新 id 再注册一条，而旧条目可能尚未被清理
   * （健康探测按地址进行，只要地址存活就一直成功），getPeers() 会为同一
   * 地址堆积多条重复条目——get_cad_info 就会把同一 peer 列出 N 行。
   * 这里按「地址」归一：同一地址任一时刻至多一条，重复广播就地更新既有条目。
   */
  _onPeerDiscovered(peer) {
    const url = `http://${peer.host}:${peer.port}`;
    const sameUrl = this.getPeers().filter(p => p.url === url);

    if (sameUrl.length === 0) {
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
      this._ensureCircuit(managedPeer);
      this._peers.set(peer.id, managedPeer);
      this._probePeer(managedPeer);
      this._notifyPeersChanged();
      return;
    }

    // 同一地址已有多个条目（历史堆积）：只保留一条。优先级：
    // 当前正在广播的 id → remote-* 配置 id（getRemotePeer() 依赖按该 id 查找）
    // → 静态条目（id 稳定）→ 首条
    const keep = sameUrl.find(p => p.id === peer.id) ||
      sameUrl.find(p => p.id === `remote-${peer.host}-${peer.port}`) ||
      sameUrl.find(p => p.static) || sameUrl[0];
    for (const p of sameUrl) {
      if (p !== keep) this._peers.delete(p.id);
    }

    if (!keep.static && keep.id !== peer.id) {
      // 非静态条目：id 跟随当前正在广播的实例 ID，
      // 使健康检查的「不在 discovery」清理能正确跟踪该地址的进程
      this._peers.delete(keep.id);
      keep.id = peer.id;
      this._peers.set(peer.id, keep);
    }
    keep.version = peer.version;
    keep.hostname = peer.hostname;
    keep.lastSeen = Date.now();
    if (peer.apikey) keep.apikey = peer.apikey;
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
      this.recordFailure(managed);
      log(`Peer offline: ${managed.hostname} (${managed.url})`);
      this._notifyPeersChanged();
    }
  }

  /**
   * 探测 peer 是否可达（探测结果接入熔断状态机）
   */
  async _probePeer(peer) {
    const startedAt = Date.now();
    try {
      const { probeMcp } = await import('./mcp-scanner.js');
      const result = await probeMcp(peer.host, peer.port, HEALTH_CHECK_TIMEOUT, peer.apikey);
      const latencyMs = Date.now() - startedAt;

      if (result) {
        peer.connected = true;
        peer.healthy = true;
        peer.lastSeen = Date.now();
        this.recordSuccess(peer, latencyMs);
        log(`Peer reachable: ${peer.hostname} (${peer.url})`);
      } else {
        peer.connected = false;
        peer.healthy = false;
        this.recordFailure(peer, latencyMs);
      }
    } catch {
      peer.connected = false;
      peer.healthy = false;
      this.recordFailure(peer, Date.now() - startedAt);
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

      const startedAt = Date.now();
      try {
        const { probeMcp } = await import('./mcp-scanner.js');
        const result = await probeMcp(peer.host, peer.port, HEALTH_CHECK_TIMEOUT, peer.apikey);
        const latencyMs = Date.now() - startedAt;
        const wasHealthy = peer.healthy;

        peer.healthy = !!result;
        peer.connected = !!result;
        peer.lastHealthCheck = Date.now();

        if (result) {
          peer.lastSeen = Date.now();
          this.recordSuccess(peer, latencyMs);
        } else {
          this.recordFailure(peer, latencyMs);
        }

        if (wasHealthy && !peer.healthy) {
          log(`Peer unhealthy: ${peer.hostname} (${peer.url})`);
          this._notifyPeersChanged();
        } else if (!wasHealthy && peer.healthy) {
          log(`Peer recovered: ${peer.hostname} (${peer.url})`);
          this._notifyPeersChanged();
        }
      } catch {
        this.recordFailure(peer, Date.now() - startedAt);
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

    // 同一地址可能已以其他 id 存在（发现/手动/lan/静态来源不同），
    // 合并进既有条目，避免 getPeers() 对同一地址列出多行
    const existing = this.getPeerByUrl(url);
    if (existing) {
      const remoteId = `remote-${host}-${port}`;
      if ((options.static && !existing.static) || id === remoteId) {
        // 稳定配置 id 优先于发现的随机实例 id
        // （getRemotePeer() 按 remote-* id 查找，必须保住该键）
        this._peers.delete(existing.id);
        existing.id = id;
        existing.static = true;
        this._peers.set(id, existing);
      }
      if (options.hostname) existing.hostname = options.hostname;
      if (options.version) existing.version = options.version;
      if (options.apikey) existing.apikey = options.apikey;
      existing.lastSeen = Date.now();
      this._notifyPeersChanged();
      return existing;
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

    this._ensureCircuit(peer);
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
        circuit: this.getCircuitState(p) || 'closed',
        consecutiveFailures: p.consecutiveFailures || 0,
        latencyEwma: p.latencyEwma ?? null,
        forwardSuccess: p.forwardSuccess || 0,
        forwardFailure: p.forwardFailure || 0,
      })),
    };
  }
}

const peerManager = new PeerManager();
export default peerManager;
