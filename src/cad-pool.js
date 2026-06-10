import { createCadConnection, setActiveConnection, getActiveConnection, cad } from './cad.js';
import { log, error as logError } from './logger.js';
import config from './config.js';

const POOL_STRATEGIES = {
  ROUND_ROBIN: 'round-robin',
  LEAST_BUSY: 'least-busy',
  MANUAL: 'manual',
};

class CadConnectionPool {
  _instances = new Map();
  _maxPoolSize = 3;
  _activeKey = 'default';
  _strategy = POOL_STRATEGIES.MANUAL;
  _rrIndex = 0;
  _reconnectTimers = new Map();
  _reconnectCounts = new Map();
  _maxReconnectAttempts = 10;
  _healthCheckTimer = null;
  _healthCheckInterval = 30000;

  constructor() {
    this._maxPoolSize = config.maxPoolSize || 3;
  }

  /**
   * Ensure the default entry exists. Created lazily to avoid
   * calling getActiveConnection() at module import time (which
   * breaks tests that mock cad.js).
   */
  _ensureDefault() {
    if (!this._instances.has('default')) {
      const defaultConn = getActiveConnection();
      this._instances.set('default', {
        key: 'default',
        connection: defaultConn,
        platform: null,
        version: null,
        connected: false,
        lastPing: Date.now(),
        createdAt: Date.now(),
        label: '默认 CAD',
        autoReconnect: true,
      });
    }
  }

  /**
   * Connect to a CAD instance and add it to the pool.
   * @param {string} key - Instance identifier
   * @param {string} [platform] - CAD platform (AutoCAD/ZWCAD/GStarCAD/BricsCAD)
   * @param {object} [options] - Additional options
   * @param {string} [options.label] - Human-readable label
   * @param {boolean} [options.autoReconnect=true] - Auto-reconnect on failure
   * @param {boolean} [options.makeActive=true] - Set as active after connecting
   */
  async connect(key = 'default', platform = null, options = {}) {
    this._ensureDefault();
    const { label, autoReconnect = true, makeActive = true } = options || {};

    if (this._instances.size >= this._maxPoolSize && !this._instances.has(key)) {
      throw new Error(`连接池已满 (${this._maxPoolSize})，无法添加新实例 "${key}"`);
    }

    let entry = this._instances.get(key);
    if (entry && entry.connected) {
      return true;
    }

    // Create a new connection if this is a new key or existing is disconnected
    if (!entry || entry.connection !== getActiveConnection()) {
      const conn = createCadConnection();
      entry = {
        key,
        connection: conn,
        platform: null,
        version: null,
        connected: false,
        lastPing: Date.now(),
        createdAt: Date.now(),
        label: label || key,
        autoReconnect,
      };
      this._instances.set(key, entry);
    }

    const conn = entry.connection;
    try {
      const ok = await conn.connect(platform);
      if (ok) {
        entry.connected = true;
        entry.platform = conn.getPlatform();
        entry.version = conn.getVersion();
        entry.lastPing = Date.now();

        if (makeActive) {
          this.setActive(key);
        }

        this._reconnectCounts.delete(key);
        log(`连接池: 实例 "${key}" 已连接 (${entry.platform} ${entry.version})`);
        return true;
      }
      log(`连接池: 实例 "${key}" 连接失败`);
      return false;
    } catch (e) {
      logError(`连接池: 实例 "${key}" 连接出错: ${e.message}`);
      return false;
    }
  }

  /**
   * Disconnect and remove an instance from the pool.
   */
  async disconnect(key) {
    this._ensureDefault();
    if (key === 'default') {
      // Cannot remove default, but can disconnect it
      const entry = this._instances.get('default');
      if (entry) {
        await entry.connection.disconnect();
        entry.connected = false;
        entry.platform = null;
        entry.version = null;
      }
      return true;
    }

    const entry = this._instances.get(key);
    if (!entry) return false;

    this._clearReconnectTimer(key);

    try {
      await entry.connection.disconnect();
    } catch (e) {
      logError(`连接池: 断开实例 "${key}" 出错: ${e.message}`);
    }

    this._instances.delete(key);

    // If the active instance was removed, switch to default
    if (this._activeKey === key) {
      this.setActive('default');
    }

    log(`连接池: 实例 "${key}" 已断开并移除`);
    return true;
  }

  /**
   * Set the active instance. All cad.* calls will be routed here.
   */
  setActive(key) {
    this._ensureDefault();
    const entry = this._instances.get(key);
    if (!entry) {
      logError(`连接池: 实例 "${key}" 不存在`);
      return false;
    }
    this._activeKey = key;
    setActiveConnection(entry.connection);

    // Sync the cad singleton's connected status
    cad.connected = entry.connected;

    log(`连接池: 已切换到实例 "${key}"`);
    return true;
  }

  /**
   * Discover and add all running CAD instances.
   * Tries each platform to find running CAD processes.
   */
  async discover() {
    this._ensureDefault();
    const platforms = ['AutoCAD', 'ZWCAD', 'GStarCAD', 'BricsCAD'];
    let foundCount = 0;

    for (const platform of platforms) {
      const key = platform.toLowerCase();
      if (this._instances.has(key) && this._instances.get(key).connected) {
        foundCount++;
        continue;
      }
      try {
        const tempConn = createCadConnection();
        const ok = await tempConn.connect(platform);
        if (ok) {
          const label = `${platform} ${tempConn.getVersion() || ''}`.trim();
          this._instances.set(key, {
            key,
            connection: tempConn,
            platform: tempConn.getPlatform(),
            version: tempConn.getVersion(),
            connected: true,
            lastPing: Date.now(),
            createdAt: Date.now(),
            label,
            autoReconnect: true,
          });
          foundCount++;
          log(`连接池: 发现 ${label}`);
        }
      } catch (e) {
        // Platform not available, skip
      }
    }

    return Array.from(this._instances.values()).map(e => ({
      key: e.key,
      connected: e.connected,
      platform: e.platform,
      version: e.version,
      label: e.label,
      lastPingAgo: Date.now() - e.lastPing,
    }));
  }

  /**
   * Health check for all instances.
   */
  async healthCheck() {
    this._ensureDefault();
    const results = [];
    for (const [key, entry] of this._instances) {
      try {
        const pingOk = await entry.connection.ping();
        entry.connected = pingOk;
        entry.lastPing = Date.now();
        results.push({ key, connected: pingOk, platform: entry.platform, label: entry.label });
        if (!pingOk && entry.autoReconnect) {
          this._scheduleReconnect(key);
        }
      } catch (e) {
        entry.connected = false;
        results.push({ key, connected: false, error: e.message, label: entry.label });
        if (entry.autoReconnect) this._scheduleReconnect(key);
      }
    }
    return results;
  }

  /**
   * Start periodic health checks.
   */
  startHealthCheck(intervalMs = 30000) {
    if (this._healthCheckTimer) clearInterval(this._healthCheckTimer);
    this._healthCheckInterval = intervalMs;
    this._healthCheckTimer = setInterval(() => {
      this.healthCheck().catch(e => {
        logError(`连接池: 健康检查出错: ${e.message}`);
      });
    }, intervalMs);
    log(`连接池: 健康检查已启动 (间隔 ${intervalMs}ms)`);
  }

  /**
   * Stop periodic health checks.
   */
  stopHealthCheck() {
    if (this._healthCheckTimer) {
      clearInterval(this._healthCheckTimer);
      this._healthCheckTimer = null;
      log('连接池: 健康检查已停止');
    }
  }

  /**
   * Get the active instance.
   */
  getActive() {
    this._ensureDefault();
    return this._instances.get(this._activeKey) || null;
  }

  /**
   * Get stats for all instances.
   */
  getStats() {
    this._ensureDefault();
    return {
      total: this._instances.size,
      maxPoolSize: this._maxPoolSize,
      active: this._activeKey,
      strategy: this._strategy,
      instances: Array.from(this._instances.values()).map(i => ({
        key: i.key,
        connected: i.connected,
        platform: i.platform,
        version: i.version,
        label: i.label,
        queueSize: i.connection._getQueueSize ? i.connection._getQueueSize() : 0,
        lastPingAgo: Date.now() - (i.lastPing || 0),
        uptime: i.connected ? Math.round((Date.now() - i.createdAt) / 1000) : 0,
      })),
    };
  }

  /**
   * List all instances.
   */
  listInstances() {
    this._ensureDefault();
    return Array.from(this._instances.values()).map(i => ({
      key: i.key,
      connected: i.connected,
      platform: i.platform,
      version: i.version,
      label: i.label,
      isActive: i.key === this._activeKey,
      autoReconnect: i.autoReconnect,
    }));
  }

  /**
   * Disconnect all instances.
   */
  async disconnectAll() {
    this.stopHealthCheck();
    for (const [key, timer] of this._reconnectTimers) {
      clearTimeout(timer);
    }
    this._reconnectTimers.clear();
    this._reconnectCounts.clear();

    for (const [key, entry] of this._instances) {
      try {
        await entry.connection.disconnect();
      } catch (e) {
        logError(`连接池: 断开 "${key}" 出错: ${e.message}`);
      }
    }
    this._instances.clear();
    this._activeKey = 'default';
    // Re-initialize default entry (disconnected)
    const defaultConn = getActiveConnection();
    this._instances.set('default', {
      key: 'default',
      connection: defaultConn,
      platform: null,
      version: null,
      connected: false,
      lastPing: Date.now(),
      createdAt: Date.now(),
      label: '默认 CAD',
      autoReconnect: true,
    });
    log('连接池: 所有实例已断开');
  }

  // --- Internal ---

  _scheduleReconnect(key) {
    if (this._reconnectTimers.has(key)) return;
    let count = this._reconnectCounts.get(key) || 0;
    if (count >= this._maxReconnectAttempts) {
      logError(`连接池: 实例 "${key}" 重试已达上限 (${this._maxReconnectAttempts})，放弃`);
      return;
    }
    this._reconnectCounts.set(key, count + 1);
    const delay = Math.min(5000 * Math.pow(1.5, count), 60000);
    log(`连接池: 计划在 ${delay}ms 后重连 "${key}" (第 ${count + 1}/${this._maxReconnectAttempts} 次)`);
    const timer = setTimeout(async () => {
      this._reconnectTimers.delete(key);
      log(`连接池: 正在重连 "${key}"...`);
      try {
        const entry = this._instances.get(key);
        if (!entry) return;
        const ok = await entry.connection.connect(entry.platform);
        if (ok) {
          entry.connected = true;
          entry.lastPing = Date.now();
          this._reconnectCounts.delete(key);
          log(`连接池: 实例 "${key}" 重连成功`);
        } else {
          this._scheduleReconnect(key);
        }
      } catch (e) {
        logError(`连接池: 重连 "${key}" 失败: ${e.message}`);
        this._scheduleReconnect(key);
      }
    }, delay);
    this._reconnectTimers.set(key, timer);
  }

  _clearReconnectTimer(key) {
    const timer = this._reconnectTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this._reconnectTimers.delete(key);
    }
    this._reconnectCounts.delete(key);
  }

  /**
   * Set the load-balancing strategy.
   */
  setStrategy(strategy) {
    if (!Object.values(POOL_STRATEGIES).includes(strategy)) {
      throw new Error(`未知策略: ${strategy}，可选: ${Object.values(POOL_STRATEGIES).join(', ')}`);
    }
    this._strategy = strategy;
    log(`连接池: 策略已切换为 "${strategy}"`);
  }
}

export const pool = new CadConnectionPool();
export { POOL_STRATEGIES };
