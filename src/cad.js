// @ts-check
import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import config from './config.js';
import { setCadConnected } from './metrics.js';
import { CircuitBreaker } from './cad-circuit-breaker.js';
import {  error as logError, warn as logWarn } from './logger.js';
import {  ERROR_CODES, MCPError } from './errors.js';
import { withSpan } from './tracing.js';
import { t } from './i18n.js';
import { CommandQueue, PRIORITY_NORMAL, ReadBatcher, isReadCommand } from './command-queue.js';
import { callPluginHook } from './plugin-loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(__dirname, 'cad-worker.js');

// 兜底：队列清理/去重、worker 重置等产生的 promise rejection 不应杀死进程
process.on('unhandledRejection', (reason) => {
  try { logError('[atlisp-mcp:cad] unhandledRejection:', reason?.message || reason); } catch { /* 兜底 handler 自身异常忽略 */ }
});

const MESSAGE_TIMEOUT = config.messageTimeout;
const CAD_COMMAND_TIMEOUT = config.cadCommandTimeout;
const STALL_COOLDOWN = config.stallCooldown;
const HEARTBEAT_PING_TIMEOUT = config.heartbeatPingTimeout;
const HEARTBEAT_INTERVAL = config.heartbeatInterval;
// worker 刚 spawn 时，edge-js 要先加载 CLR、初始化十几个 edge.func 再连上 CAD。
// 冷启动实测可超过 HEARTBEAT_PING_TIMEOUT(5s)，这段预热期内的 ping 超时不能当作
// 「worker 死亡」，否则会出现「spawn → 判死 → 重启 → 再判死」的重启风暴。
const HEARTBEAT_WARMUP = config.heartbeatWarmupMs ?? 15000;
// 连续失败触发自动重启后的最小间隔。CAD 停在模态对话框/长命令里时，杀 worker
// 并不能让 CAD 恢复，只会把在途请求一起打断；限频给人工处理留出时间。
const HEARTBEAT_RESET_COOLDOWN = config.heartbeatResetCooldown ?? 60000;
const DOC_POLL_COOLDOWN = Math.max(HEARTBEAT_INTERVAL * 2, 30000);
const MAX_RESTART_ATTEMPTS = 10; // 增加重启次数
const RESTART_BACKOFF_BASE = 500; // 减少基础延迟
// 每个 worker 最大处理请求数，超过后轮换（释放 edge-js/.NET 侧原生内存）。
// 可配置：高频调用场景调大可以减少 worker 冷启动（CLR 初始化）次数。
const MAX_REQUESTS_PER_WORKER = config.workerMaxRequests ?? 100;

const MAX_BUFFER_SIZE = 8 * 1024 * 1024;

const _docChangeCallbacks = [];
const _connectCallbacks = [];

export function onDocumentChanged(callback) {
  _docChangeCallbacks.push(callback);
}

/**
 * 注册「CAD 连接已就绪」回调。
 *
 * 与插件钩子 onCadConnected 的区别：插件钩子会跨进程/跨模块分发且允许用户插件注册；
 * 这里只服务于进程内基础能力（如 @lisp 自动安装），回调同步触发、不得阻塞连接。
 * cad.js 不能反向依赖 handler 层，所以由 atlisp-bootstrap.js 动态 import 本函数注册。
 *
 * @param {(info: {connection: CadConnection, platform?: string, version?: string, reason: string}) => void} callback
 */
export function onCadConnected(callback) {
  _connectCallbacks.push(callback);
}

/** 触发进程内连接回调（连接池切换活动实例等场景复用）。 */
export function notifyCadConnected(info) {
  for (const cb of _connectCallbacks) {
    try {
      cb(info);
    } catch (e) {
      logError('cad connect callback error:', e.message);
    }
  }
}

function emitDocumentChanged(info) {
  for (const cb of _docChangeCallbacks) {
    try { cb(info); } catch (e) { logError('doc change callback error:', e.message); }
  }
  // 插件钩子按 docs/plugins.md 的 payload 约定分发（name/action/path）
  callPluginHook('onDocumentChanged', {
    name: info?.docName || '',
    action: 'changed',
    path: info?.docPath || '',
  });
}

/**
 * @typedef {{ type: string, code: string, platform: string, encoding: string, resolve: Function, reject: Function }} Command
 * @typedef {{ success: boolean, result?: string, error?: string, rawBase64?: string }} CommandResult
 */

/**
 * @template T
 * @typedef {{ resolve: (v: T) => void, reject: (e: Error) => void, timeout: NodeJS.Timeout, _skipCb?: boolean }} PendingEntry
 */


/**
 * @typedef {import('child_process').ChildProcess} ChildProcess
 */

class CadConnection {
  /** @type {ChildProcess|null} */
  _primaryWorker = null;
  /** @type {ChildProcess[]} */
  _readWorkers = [];
  _readWorkerIndex = 0;
  /** @type {string|null} */
  _platform = null;
  /** @type {string|null} */
  _version = null;
  /** @type {string|null} */
  _product = null;
  connected = false;
  /** 每次成功连接递增：@lisp 引导缓存据此判断是否需要重新探测 */
  _connectionEpoch = 0;

  /** @type {NodeJS.Timeout|null} */
  _heartbeatTimer = null;
  /** @type {Map<string, PendingEntry<any>>} */
  _pendingRequests = new Map();
  /** @type {CommandQueue|null} */
  _commandQueue = null;

  _restartCount = 0;
  /** @type {NodeJS.Timeout|null} */
  _restartTimer = null;
  _activeDocName = null;
  _monitorStarted = false;
  /** 文档轮询是否在途（worker 串行，避免轮询排到命令后面叠加超时） */
  _docPollInFlight = false;
  _docPollCooldownUntil = 0;
  /** 上一次心跳触发的自动重启时间（限频用） */
  _lastHeartbeatResetAt = 0;
  /** @type {string|null} */
  _connectionId = null;
  /** @type {NodeJS.Timeout[]} */
  _readRestartTimers = [];

  /** Stall (CAD stuck/busy-waiting) cooldown deadline, 0 when not stalled. */
  _stalledUntil = 0;
  /** @type {string|null} */
  _stallReason = null;

  constructor() {
    this._connectionId = randomUUID().slice(0, 8);
    this._commandQueue = new CommandQueue(this);
    this._cb = new CircuitBreaker(
      this._connectionId,
      // 熔断是保护动作而非根因：真正的失败（stall/heartbeat）已经各自记过 ERROR，
      // 这里记 WARN，避免同一故障在日志里出现三层 ERROR。
      (id) => logWarn(`[${id}] Circuit breaker OPEN`),
      (id) => logWarn(`[${id}] Circuit breaker HALF_OPEN, allowing trial request`)
    );
  }

  get _workerPoolSize() {
    return config.workerPoolSize || 2;
  }

  isAvailable() {
    return process.platform === 'win32';
  }

  /**
   * @param {string|null} [platform]
   * @param {{ moniker?: string, key?: string, forceLaunch?: boolean }} [options]
   * @returns {Promise<boolean>}
   */
  async connect(platform = null, options = {}) {
    if (!this.isAvailable()) return false;
    this._cb.recordSuccess();
    try {
      const msg = platform ? { type: 'connect', platform } : { type: 'connect' };
      if (options.moniker) {
        msg.moniker = options.moniker;
        msg.monikerKey = options.key || 'moniker';
      }
      if (options.forceLaunch) {
        msg.forceLaunch = true;
      }
      const result = await this._sendMessage(msg);
      if (result && result.success) {
        this._version = result.version;
        this._product = result.platform;
        this._platform = result.platform;
        this.connected = true;
        this._connectionEpoch += 1;
        this._clearStall();
        setCadConnected(true);
        this._activeDocName = null;
        this._lastHeartbeatResetAt = 0;
        this._commandQueue.enableBatcher();
        this._startMonitor();
        callPluginHook('onCadConnected', { platform: result.platform, version: result.version });
        // 进程内连接回调（@lisp 自动安装依赖此事件，不能只依赖工具调用路径：
        // 很多 handler 直接调 cad.connect()，不经过 ensureCadConnected）
        notifyCadConnected({
          connection: this,
          platform: result.platform,
          version: result.version,
          reason: 'connect',
        });
        return true;
      }
    } catch (e) {
      logError('CAD connect error:', e.message);
    }
    return false;
  }

  /**
   * @param {string} code
   * @returns {Promise<boolean>}
   */
  async sendCommand(code) {
    if (!this.connected) throw new Error(t('cad.notConnected'));
    if (this.isStalled()) throw this._stallError();
    return new Promise((resolve, reject) => {
      this._commandQueue.enqueue({
        type: 'send', code, platform: this._platform,
        resolve, reject
      }, PRIORITY_NORMAL);
    }).then(result => {
      if (result.success) return true;
      throw new Error(result.error || '发送失败');
    });
  }

  /**
   * @param {string} code
   * @param {string|null} [encoding]
   * @param {boolean} [raw]
   * @param {number|null} [timeoutMs] 单条命令超时覆盖（默认 CAD_COMMAND_TIMEOUT）
   * @param {boolean} [trusted] 内部可信代码，跳过安全规则（仅 @lisp 引导使用）
   * @returns {Promise<string|{ text: string, rawBase64: string }>}
   */
  async sendCommandWithResult(code, encoding = null, raw = false, timeoutMs = null, trusted = false) {
    if (!this.connected) throw new Error(t('cad.notConnected'));
    if (this.isStalled()) throw this._stallError();
    return new Promise((resolve, reject) => {
      this._commandQueue.enqueue({
        type: 'sendResult', code, platform: this._platform, encoding: encoding || '',
        timeoutMs, trusted, resolve, reject
      }, PRIORITY_NORMAL);
    }).then(result => {
      if (result.success) {
        if (raw && result.rawBase64 !== undefined) {
          return { text: result.result || '', rawBase64: result.rawBase64 };
        }
        return result.result || '';
      }
      throw new Error(result.error || '发送失败');
    });
  }

  getVersion() { return this._version; }
  getPlatform() { return this._product; }
  getConnectionId() { return this._connectionId; }

  isStalled() {
    return this._stalledUntil > Date.now();
  }

  getStallInfo() {
    if (!this._stalledUntil) return { stalled: false, reason: null, remainingMs: 0 };
    const remainingMs = this._stalledUntil - Date.now();
    return { stalled: remainingMs > 0, reason: this._stallReason, remainingMs: Math.max(0, remainingMs) };
  }

  _stallError(reason = this._stallReason || t('cad.stalled')) {
    const info = this.getStallInfo();
    return new MCPError(
      ERROR_CODES.CAD_BUSY,
      `${t('cad.stalled')}中（可能等待输入或弹窗）：${reason}。冷却期内命令将快速失败，可人工处理 CAD 后重试，或打开新 CAD 实例继续任务`,
      { reason: info.reason || reason, remainingMs: info.remainingMs }
    );
  }

  _markStalled(reason = 'command timeout') {
    this._stalledUntil = Date.now() + STALL_COOLDOWN;
    this._stallReason = reason;
    const err = this._stallError(reason);
    this._commandQueue.clear(err);
    logError(`[${this._connectionId}] CAD 停滞已标记 (${reason}), ${STALL_COOLDOWN}ms 内命令将快速失败`);
  }

  _clearStall() {
    this._stalledUntil = 0;
    this._stallReason = null;
  }

  async isBusy() {
    if (!this.connected) return false;
    if (this.isStalled()) return true;
    try {
      const result = await this._sendMessage({ type: 'isBusy', platform: this._platform });
      return result && result.isBusy;
    } catch {
      return false;
    }
  }

  async hasDoc() {
    if (!this.connected) return { hasDoc: false, docCount: 0 };
    try {
      const result = await this._sendMessage({ type: 'hasdoc', platform: this._platform });
      return result || { hasDoc: false, docCount: 0 };
    } catch {
      return { hasDoc: false, docCount: 0 };
    }
  }

  async newDoc() {
    if (!this.connected) throw new Error(t('cad.notConnected'));
    try {
      const result = await this._sendMessage({ type: 'newdoc', platform: this._platform });
      return result && result.success;
    } catch {
      return false;
    }
  }

  async openDoc(filePath) {
    if (!this.connected) throw new Error(t('cad.notConnected'));
    if (this.isStalled()) throw this._stallError();
    try {
      const result = await this._sendMessage({ type: 'opendoc', platform: this._platform, filePath });
      return result || { success: false, error: 'unknown' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async saveDoc(filePath = null) {
    if (!this.connected) throw new Error(t('cad.notConnected'));
    if (this.isStalled()) throw this._stallError();
    try {
      const result = await this._sendMessage({ type: 'savedoc', platform: this._platform, filePath });
      return result || { success: false, error: 'unknown' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async bringToFront() {
    if (!this.connected) throw new Error(t('cad.notConnected'));
    try {
      const result = await this._sendMessage({ type: 'bringToFront', platform: this._platform });
      return result && result.success;
    } catch {
      return false;
    }
  }

  async sendEsc(front = true) {
    if (!this.connected) throw new Error(t('cad.notConnected'));
    try {
      const result = await this._sendMessage({ type: 'sendEsc', platform: this._platform, front });
      return result && result.success;
    } catch {
      return false;
    }
  }

  async getActiveDocInfo() {
    if (!this.connected) return { docName: '', docPath: '', docCount: 0 };
    if (this.isStalled()) return { docName: '', docPath: '', docCount: 0 };
    try {
      const result = await this._sendMessage({ type: 'getActiveDocInfo', platform: this._platform });
      return result || { docName: '', docPath: '', docCount: 0 };
    } catch {
      return { docName: '', docPath: '', docCount: 0 };
    }
  }

  async getInfo() {
    if (!this.connected) return 'CAD 未连接';
    return `Platform: ${this._product}, Version: ${this._version}, Status: Connected`;
  }

  async disconnect() {
    this._reset('disconnect');
    this._cb.reset();
  }

  /**
   * 只释放底层资源（worker 子进程 + 心跳定时器），不动全局连接状态。
   * 连接池在失败路径上用它回收已 spawn 的 worker——否则每次重试都会留下一个
   * 被 setInterval 闭包永久引用的 CadConnection，进程数和堆一起涨。
   */
  releaseResources() {
    this._resetWorker();
  }

  async ping() {
    try {
      const result = await this._sendMessage({ type: 'ping' });
      return result && result.pong;
    } catch {
      return false;
    }
  }

  async healthCheck() {
    try {
      const result = await this._sendMessage({ type: 'healthCheck' });
      return result;
    } catch (e) {
      return { healthy: false, error: e.message };
    }
  }

  _reset(reason = 'reset') {
    const wasConnected = this.connected;
    this.connected = false;
    setCadConnected(false);
    this._version = null;
    this._product = null;
    this._platform = null;
    this._activeDocName = null;
    this._monitorStarted = false;
    this._clearStall();
    this._commandQueue.clear();
    this._resetWorker();
    if (wasConnected) callPluginHook('onCadDisconnected', { reason });
  }

  _getQueueSize() { return this._commandQueue.size(); }
  _getRestartCount() { return this._restartCount; }

  /**
   * 启动 CAD 侧的文档变更监控（.NET Timer → stdout event）。
   * 监控可用时心跳里的文档轮询就是多余的；moniker 连接不支持监控，
   * 此时保持 _monitorStarted=false，由心跳轮询兜底。
   */
  _startMonitor() {
    if (this._monitorStarted || !this._platform) return;
    this._monitorStarted = true;
    this._sendMessage({ type: 'startMonitor', platform: this._platform })
      .then((r) => {
        if (!r || r.success === false) this._monitorStarted = false;
      })
      .catch(() => { this._monitorStarted = false; });
  }

  _spawnWorker(type) {
    const w = spawn('node', [workerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      // CWD 用临时目录：Windows 把「进程当前目录」算作占用，worker 若继承服务端的
      // 包目录（老托盘会把 CWD 设成 node_modules\@atlisp\mcp），npm 升级时改不了
      // 包目录名（EBUSY）。worker 只用绝对路径，不依赖 CWD。
      cwd: os.tmpdir(),
      env: {
        ...process.env,
        BUSY_RETRIES: String(config.busyRetries ?? 5),
        BUSY_DELAY: String(config.busyDelay ?? 300),
      },
    });
    w.connected = true;
    w._workerType = type;
    w._spawnTime = Date.now();
    w._warmupUntil = Date.now() + HEARTBEAT_WARMUP;
    w._requestCount = 0;

    this._setupStdoutHandler(w);

    w.on('exit', (code) => {
      w.connected = false;

      if (type === 'primary') {
        if (w !== this._primaryWorker) return;
        // 主动轮换（_rotateWorker）和心跳重置（_resetWorker）不是故障：
        // 前者已经打过轮换日志，后者本身就是恢复动作，别再刷 ERROR。
        if (!w._intentionalExit) {
          logError(`[${this._connectionId}] ${type} worker exited with code:`, code);
        } else {
          logWarn(`[${this._connectionId}] ${type} worker 已按预期退出`, code);
        }
        this._cb.recordFailure();
        this._clearStall();
        this._monitorStarted = false;
        const exitError = new Error(`Primary worker exited with code ${code}`);
        for (const entry of this._pendingRequests.values()) {
          clearTimeout(entry.timeout);
          entry._skipCb = true;
          entry.reject(exitError);
        }
        this._pendingRequests.clear();
        if (this._heartbeatTimer) {
          clearInterval(this._heartbeatTimer);
          this._heartbeatTimer = null;
        }
        this._scheduleRestart();
      } else {
        if (!w._intentionalExit) {
          logError(`[${this._connectionId}] ${type} worker exited with code:`, code);
        }
        const idx = this._readWorkers.indexOf(w);
        if (idx >= 0) this._readWorkers.splice(idx, 1);
        // 读 worker 退出（崩溃或主动轮换）时，挂在它身上的在途请求必须立即失败，
        // 否则只能干等 CAD_COMMAND_TIMEOUT。primary 的 exit 处理会兜底全部请求，
        // 读 worker 原本没有任何清理路径。
        const readExitError = new Error(`Read worker exited with code ${code}`);
        for (const [id, entry] of this._pendingRequests) {
          if (entry._worker !== w) continue;
          clearTimeout(entry.timeout);
          entry._skipCb = true;
          this._pendingRequests.delete(id);
          entry.reject(readExitError);
        }
        // 主动轮换/重置导致的退出由调用方负责补位，避免重复 spawn
        if (w._intentionalExit) return;
        this._scheduleReadWorkerRestart();
      }
    });

    w.on('error', (err) => {
      logError(`[${this._connectionId}] ${type} worker error:`, err.message);
      w.connected = false;
    });

    return w;
  }

  _getWorker(isReadOnly = false) {
    const poolSize = this._workerPoolSize;

    if (!this._primaryWorker || !this._primaryWorker.connected) {
      if (this._primaryWorker) {
        try { this._primaryWorker.kill(); } catch (e) { logError('[cad]', e?.message || e); }
        this._primaryWorker = null;
      }
      this._primaryWorker = this._spawnWorker('primary');
      this._cb.recordSuccess();
      if (!this._heartbeatTimer) this._startHeartbeat();
      this._restartCount = 0;
      // 新 worker 没有 .NET 监控：连接还在的话补上，否则心跳轮询兜底
      if (this.connected) this._startMonitor();
    }

    if (isReadOnly && poolSize > 1) {
      this._ensureReadWorkers();
      if (this._readWorkers.length > 0) {
        this._readWorkerIndex = (this._readWorkerIndex + 1) % this._readWorkers.length;
        return this._readWorkers[this._readWorkerIndex];
      }
    }

    return this._primaryWorker;
  }

  /** 同步补齐读 worker 池到 poolSize-1，返回存活的读 worker 列表。*/
  _ensureReadWorkers() {
    const poolSize = this._workerPoolSize;
    if (poolSize <= 1) return this._readWorkers;
    this._readWorkers = this._readWorkers.filter(rw => rw.connected);
    const needed = poolSize - 1 - this._readWorkers.length;
    for (let i = 0; i < needed; i++) {
      this._readWorkers.push(this._spawnWorker('read'));
    }
    return this._readWorkers;
  }

  /** 读 worker 崩溃后的补位：指数退避，避免 worker 秒退时形成紧凑重启循环。*/
  _scheduleReadWorkerRestart() {
    const poolSize = this._workerPoolSize;
    if (poolSize <= 1) return;
    const attempt = (this._readRestartAttempts = (this._readRestartAttempts || 0) + 1);
    const delay = Math.min(200 * Math.pow(2, attempt - 1), 5000);
    const timer = setTimeout(() => {
      this._readRestartTimers = this._readRestartTimers.filter(t => t !== timer);
      if (this._readWorkers.filter(rw => rw.connected).length < poolSize - 1) {
        this._readWorkers.push(this._spawnWorker('read'));
      }
    }, delay);
    this._readRestartTimers.push(timer);
  }

  _failPending(message) {
    for (const entry of this._pendingRequests.values()) {
      clearTimeout(entry.timeout);
      entry._skipCb = true;
      entry.reject(new Error(message));
    }
    this._pendingRequests.clear();
  }

  _resetWorker() {
    for (const { reject, timeout } of this._pendingRequests.values()) {
      clearTimeout(timeout);
      reject(new Error('Worker reset'));
    }
    this._pendingRequests.clear();
    this._commandQueue.clear();

    if (this._primaryWorker) {
      try { this._primaryWorker.connected = false; this._primaryWorker._intentionalExit = true; this._primaryWorker.kill(); } catch (e) { logError('[cad]', e?.message || e); }
      this._primaryWorker = null;
    }
    for (const rw of this._readWorkers) {
      try { rw.connected = false; rw._intentionalExit = true; rw.kill(); } catch (e) { logError('[cad]', e?.message || e); }
    }
    this._readWorkers = [];
    this._readWorkerIndex = 0;
    this._readRestartAttempts = 0;
    this._monitorStarted = false;
    this._docPollInFlight = false;
    this._docPollCooldownUntil = 0;

    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
    for (const t of this._readRestartTimers) {
      clearTimeout(t);
    }
    this._readRestartTimers = [];
  }

  _rotateWorker(oldWorker) {
    // 清除轮换标记：旧 worker 上可能仍有在途请求，避免它们再次触发轮换
    oldWorker._needsRotation = false;
    // 优雅地关闭旧 worker
    try {
      oldWorker.connected = false;
      oldWorker._intentionalExit = true;
      oldWorker.kill();
    } catch (e) {
      logError('[cad]', '轮换 worker 时关闭旧 worker 失败:', e?.message || e);
    }

    // 如果是 primary worker，创建新的
    if (oldWorker === this._primaryWorker) {
      this._primaryWorker = this._spawnWorker('primary');
      this._cb.recordSuccess();
      if (!this._heartbeatTimer) this._startHeartbeat();
      this._restartCount = 0;
      // 新 worker 需要重新挂 .NET 文档监控
      this._monitorStarted = false;
      if (this.connected) this._startMonitor();
    } else {
      // 如果是 read worker，从列表中移除并补齐
      const idx = this._readWorkers.indexOf(oldWorker);
      if (idx >= 0) this._readWorkers.splice(idx, 1);
      this._ensureReadWorkers();
    }
  }

  _setupStdoutHandler(w) {
    let buffer = '';
    let overflowing = false;
    const self = this;

    w.stdout.on('data', (data) => {
      try {
        buffer += data.toString();
        if (buffer.length > MAX_BUFFER_SIZE) {
          const lastNewline = buffer.lastIndexOf('\n');
          if (lastNewline < 0) {
            // 单条响应就超过上限：没有换行就无法按行解析。原来的做法是从中间截断，
            // 会把 JSON 截成非法文本 → 解析失败 → 请求只能干等到超时。这里显式失败。
            if (!overflowing) {
              overflowing = true;
              self._failPending(`worker 响应超过 ${MAX_BUFFER_SIZE} 字节上限`);
            }
            buffer = '';
            return;
          }
          buffer = buffer.slice(lastNewline + 1);
        }
        if (overflowing) {
          // 丢弃超大消息的剩余字节，直到遇到行尾再恢复正常解析
          const nl = buffer.indexOf('\n');
          if (nl < 0) {
            buffer = '';
            return;
          }
          buffer = buffer.slice(nl + 1);
          overflowing = false;
        }
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const result = JSON.parse(line);
            const rid = result.requestId;
            if (rid && self._pendingRequests.has(rid)) {
              const { resolve, reject, timeout } = self._pendingRequests.get(rid);
              clearTimeout(timeout);
              self._pendingRequests.delete(rid);
              if (result.error) {
                reject(new Error(result.error));
              } else {
                resolve(result);
              }
            } else if (result.type === 'event' && result.eventType === 'documentChanged') {
              emitDocumentChanged({ docName: result.docName, docPath: result.docPath });
            }
          } catch (parseErr) {
            if (line.startsWith('{') || line.startsWith('[')) {
              logError(`[${self._connectionId}] JSON parse error in worker output:`, parseErr.message);
            }
          }
        }
      } catch (e) {
        logError(`[${self._connectionId}] Unexpected error in worker stdout handler:`, e.message);
      }
    });

    w.stderr.on('data', (d) => logError(`[${self._connectionId}] ${w._workerType || 'worker'} stderr:`, d.toString()));
  }

  /**
   * 心跳只回答一个问题：worker 进程还能不能及时回话。
   * 判断时必须排除两种「假死」：
   *   1. 新 worker 的预热期（edge-js 加载 CLR + 连 CAD 可能超过 ping 超时）；
   *   2. worker 正在串行执行真实命令（ping 只是排在命令后面，超时≠死亡）。
   * 另外，文档轮询已由 CAD 侧 .NET 监控推送事件，监控可用时不再轮询；
   * 监控不可用（moniker 连接）时轮询失败会进入冷却，避免把串行队列越堆越长。
   */
  _startHeartbeat() {
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
    const self = this;
    let consecutiveFailures = 0;
    let busyLogged = false;

    const onFailure = (reason) => {
      consecutiveFailures++;
      logError(`[${self._connectionId}] heartbeat failed (consecutive: ${consecutiveFailures}): ${reason}`);
      if (consecutiveFailures < 3) return;

      const now = Date.now();
      const sinceLastReset = now - self._lastHeartbeatResetAt;
      if (self._lastHeartbeatResetAt && sinceLastReset < HEARTBEAT_RESET_COOLDOWN) {
        const waitSec = Math.ceil((HEARTBEAT_RESET_COOLDOWN - sinceLastReset) / 1000);
        logWarn(`[${self._connectionId}] worker 连续 ${consecutiveFailures} 次无响应，但 ${waitSec}s 内已重启过，暂不重启（CAD 可能停在模态对话框或长命令中）`);
        return;
      }

      logError(`[${self._connectionId}] heartbeat failed ${consecutiveFailures} times, resetting worker`);
      self._lastHeartbeatResetAt = now;
      self._resetWorker();
      consecutiveFailures = 0;
    };

    this._heartbeatTimer = setInterval(async () => {
      if (self._stalledUntil > Date.now()) return;

      const w = self._primaryWorker;
      // 没有 worker 就不探测：心跳不应该负责拉起 worker。否则「重置 → 心跳拉起 →
      // 仍然无响应 → 再重置」会自己形成循环；下一次真实请求会触发 spawn。
      if (!w || !w.connected) return;

      // 预热期：刚 spawn 的 worker 还在初始化，此期间的超时不算失败
      if (w._warmupUntil && Date.now() < w._warmupUntil) return;

      // 正在执行真实命令：worker 是串行的，ping 只会排在命令后面。
      // 命令自身有 CAD_COMMAND_TIMEOUT 兜底，这里直接跳过本轮。
      if (self._hasCommandInFlight()) {
        if (!busyLogged) {
          logWarn(`[${self._connectionId}] heartbeat 跳过：worker 正在执行命令（串行队列）`);
          busyLogged = true;
        }
        return;
      }
      busyLogged = false;

      try {
        const result = await self._sendMessageInternal({ type: 'ping' }, true, HEARTBEAT_PING_TIMEOUT);
        if (!result?.pong) {
          onFailure('no pong');
          return;
        }

        consecutiveFailures = 0;

        if (self._shouldPollDoc()) {
          self._docPollInFlight = true;
          try {
            const docResult = await self._sendMessageInternal({ type: 'getActiveDocInfo', platform: self._platform }, true, HEARTBEAT_PING_TIMEOUT);
            if (docResult?.docName) {
              emitDocumentChanged({ docName: docResult.docName, docPath: docResult.docPath || '' });
            }
          } catch (e) {
            self._docPollCooldownUntil = Date.now() + DOC_POLL_COOLDOWN;
            logWarn(`[${self._connectionId}] heartbeat doc poll error:`, e.message);
          } finally {
            self._docPollInFlight = false;
          }
        }
      } catch (e) {
        onFailure(e.message);
      }
    }, HEARTBEAT_INTERVAL);
  }

  /** worker 是否正在执行真实 LISP 命令（send/sendResult），而非内部探测请求。 */
  _hasCommandInFlight() {
    for (const entry of this._pendingRequests.values()) {
      if (entry._isCommand) return true;
    }
    return false;
  }

  /** 文档轮询的准入条件：已有监控/轮询在途/冷却中/有其它在途请求时都不轮询。 */
  _shouldPollDoc() {
    if (!this._platform) return false;
    if (this._monitorStarted) return false;
    if (this._docPollInFlight) return false;
    if (this._docPollCooldownUntil > Date.now()) return false;
    if (this._pendingRequests.size > 0) return false;
    return true;
  }

  _scheduleRestart() {
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
    if (this._restartCount >= MAX_RESTART_ATTEMPTS) {
      logError(`[${this._connectionId}] Max worker restart attempts reached, giving up`);
      return;
    }
    const delay = Math.min(RESTART_BACKOFF_BASE * Math.pow(2, this._restartCount), 30000);
    this._restartCount++;
    logError(`[${this._connectionId}] Scheduling worker restart in ${delay}ms (attempt ${this._restartCount}/${MAX_RESTART_ATTEMPTS})`);
    const self = this;
    this._restartTimer = setTimeout(() => {
      self._restartTimer = null;
      logError(`[${self._connectionId}] Attempting worker restart...`);
      self._resetWorker();
      self._getWorker(false);
    }, delay);
  }

  async _sendMessage(msg) {
    if (!this._cb.allowRequest()) {
      // 自愈动作：重置熔断器 + 重建 worker，不属于新的故障
      logWarn(`[${this._connectionId}] Circuit breaker OPEN, auto-recovering...`);
      this._cb.reset();
      await this._resetWorker();
      await this._getWorker(false);
    }
    return withSpan(`cad.${msg.type}`, { 'cad.msg_type': msg.type }, () =>
      this._sendMessageInternal(msg)
    );
  }

  _sendMessageInternal(msg, noCircuitBreaker = false, timeoutMs = null) {
    const isReadOnly = this._isReadOnlyMessage(msg);
    const w = this._getWorker(isReadOnly);
    const requestId = randomUUID();
    const self = this;

    // 增加请求计数：仅统计外部（经命令队列）请求，排除心跳/ping、getActiveDocInfo
    // 等内部请求（内部请求以 noCircuitBreaker=true 调用）。否则心跳会持续抬高计数，
    // 使轮换日志里的「已处理 N 个请求」远大于 MAX_REQUESTS_PER_WORKER。
    if (!noCircuitBreaker) {
      w._requestCount = (w._requestCount || 0) + 1;

      // 检查是否需要轮换 worker（只在跨越阈值时标记一次，避免重复刷日志）
      if (w._requestCount >= MAX_REQUESTS_PER_WORKER && !w._needsRotation) {
        // 主动轮换是设计内的生命周期动作，不是故障：用 WARN，
        // 否则每次轮换都会进错误上报，把真实的 ERROR 淹没。
        logWarn(`[${self._connectionId}] worker 达到最大请求数 ${MAX_REQUESTS_PER_WORKER}，准备轮换`);
        // 标记需要轮换，但在当前请求完成后执行
        w._needsRotation = true;
      }
    }

    const effectiveTimeout = timeoutMs ?? (msg.type === 'ping' ? MESSAGE_TIMEOUT : CAD_COMMAND_TIMEOUT);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const p = self._pendingRequests.get(requestId);
        if (p) {
          self._pendingRequests.delete(requestId);
          if (p.timeout !== timeout) clearTimeout(p.timeout);
          if (!noCircuitBreaker) self._cb.recordFailure();
          if (!noCircuitBreaker && msg.type !== 'ping') {
            self._markStalled(t('cad.stallTimeout', [msg.type, effectiveTimeout]));
            p.reject(self._stallError());
            return;
          }
          p.reject(new Error('Timeout waiting for worker'));
        }
      }, effectiveTimeout);

      const entry = {
        resolve: (v) => { 
          if (!noCircuitBreaker && !entry._skipCb) self._cb.recordSuccess(); 
          clearTimeout(timeout);
          // 检查是否需要轮换 worker。这里不能按消息是否只读来过滤：
          // 只读请求全部落在读 worker 上，加 !isReadOnly 会让读 worker 永远不轮换。
          if (w._needsRotation) {
            logWarn(`[${self._connectionId}] 轮换 ${w._workerType || 'primary'} worker (已处理 ${w._requestCount} 个请求)`);
            self._rotateWorker(w);
          }
          resolve(v); 
        },
        reject: (e) => { 
          if (!noCircuitBreaker && !entry._skipCb) self._cb.recordFailure(); 
          clearTimeout(timeout);
          // 检查是否需要轮换 worker（失败路径同样需要，否则阈值标记会一直挂着）
          if (w._needsRotation) {
            logWarn(`[${self._connectionId}] 轮换 ${w._workerType || 'primary'} worker (已处理 ${w._requestCount} 个请求)`);
            self._rotateWorker(w);
          }
          reject(e); 
        },
        timeout,
        // 心跳据此区分「worker 正在跑真实命令」与「worker 无响应」
        _isCommand: msg.type === 'send' || msg.type === 'sendResult',
        _startedAt: Date.now(),
        // 记录归属 worker：读 worker 退出时只清理自己的在途请求
        _worker: w,
      };
      self._pendingRequests.set(requestId, entry);
      try {
        w.stdin.write(JSON.stringify({ ...msg, requestId }) + '\n');
      } catch (e) {
        clearTimeout(timeout);
        self._pendingRequests.delete(requestId);
        if (!noCircuitBreaker) self._cb.recordFailure();
        reject(new Error(`Failed to write to worker: ${e.message}`));
      }
    });
  }

  _isReadOnlyMessage(msg) {
    if (msg.code) return isReadCommand(msg.code);
    return false;
  }
}

/** @returns {CadConnection} */
export function createCadConnection() {
  return new CadConnection();
}

/** @type {CadConnection} */
let _activeConnection = new CadConnection();

/** @param {CadConnection} conn */
export function setActiveConnection(conn) {
  _activeConnection = conn;
}

/** @returns {CadConnection} */
export function getActiveConnection() {
  return _activeConnection;
}

/** @type {(() => CadConnection|null)|null} */
let _resolveInstanceConn = null;
/** @param {() => CadConnection|null} fn */
export function _setInstanceResolver(fn) {
  _resolveInstanceConn = fn;
}

/** @returns {CadConnection} */
function _resolveConn() {
  if (_resolveInstanceConn) {
    const conn = _resolveInstanceConn();
    if (conn) return conn;
  }
  return _activeConnection;
}

/** @returns {CadConnection} */
export function resolveCadConnection() {
  return _resolveConn();
}

/**
 * @type {{
 *   connected: boolean,
 *   connectionEpoch: number,
 *   version: string|null,
 *   product: string|null,
 *   _platform: string|null,
 *   connect(platform?: string|null, options?: { moniker?: string, key?: string, forceLaunch?: boolean }): Promise<boolean>,
 *   sendCommand(code: string): Promise<boolean>,
 *   sendCommandWithResult(code: string, encoding?: string|null, raw?: boolean, timeoutMs?: number|null, trusted?: boolean): Promise<string|{text:string,rawBase64:string}>,
 *   getVersion(): string|null,
 *   getPlatform(): string|null,
 *   getConnectionId(): string|null,
 *   isAvailable(): boolean,
 *   isBusy(): Promise<boolean>,
 *   isStalled(): boolean,
 *   getStallInfo(): { stalled: boolean, reason: string|null, remainingMs: number },
 *   hasDoc(): Promise<{hasDoc:boolean,docCount:number}>,
 *   newDoc(): Promise<boolean>,
 *   bringToFront(): Promise<boolean>,
 *   getActiveDocInfo(): Promise<{docName:string,docPath:string,docCount:number}>,
 *   getInfo(): Promise<string>,
 *   disconnect(): Promise<void>,
 *   ping(): Promise<boolean>,
 *   _reset(): void,
 *   _getQueueSize(): number,
 *   _getRestartCount(): number,
 * }}
 */
export const cad = {
  get connected() { return _resolveConn().connected; },
  set connected(v) { _resolveConn().connected = v; },
  get connectionEpoch() { return _resolveConn()._connectionEpoch; },

  get version() { return _resolveConn()._version; },
  set version(v) { _resolveConn()._version = v; },
  get product() { return _resolveConn()._product; },
  set product(v) { _resolveConn()._product = v; },
  get _platform() { return _resolveConn()._platform; },
  set _platform(v) { _resolveConn()._platform = v; },

  async connect(platform, options) { return _resolveConn().connect(platform, options); },
  async sendCommand(code) { return _resolveConn().sendCommand(code); },
  async sendCommandWithResult(code, encoding, raw, timeoutMs, trusted) {
    return _resolveConn().sendCommandWithResult(code, encoding, raw, timeoutMs, trusted);
  },
  getVersion() { return _resolveConn().getVersion(); },
  getPlatform() { return _resolveConn().getPlatform(); },
  getConnectionId() { return _resolveConn().getConnectionId(); },
  isAvailable() { return _resolveConn().isAvailable(); },
  async isBusy() { return _resolveConn().isBusy(); },
  isStalled() { return _resolveConn().isStalled(); },
  getStallInfo() { return _resolveConn().getStallInfo(); },
  async hasDoc() { return _resolveConn().hasDoc(); },
  async newDoc() { return _resolveConn().newDoc(); },
  async openDoc(filePath) { return _resolveConn().openDoc(filePath); },
  async saveDoc(filePath = null) { return _resolveConn().saveDoc(filePath); },
  async bringToFront() { return _resolveConn().bringToFront(); },
  async sendEsc(front = true) { return _resolveConn().sendEsc(front); },
  async getActiveDocInfo() { return _resolveConn().getActiveDocInfo(); },
  async getInfo() { return _resolveConn().getInfo(); },
  async disconnect() { return _resolveConn().disconnect(); },
  async ping() { return _resolveConn().ping(); },
  _reset(reason) { return _resolveConn()._reset(reason); },
  _getQueueSize() { return _resolveConn()._getQueueSize(); },
  _getRestartCount() { return _resolveConn()._getRestartCount(); },
};

/** @typedef {typeof CadConnection.prototype} CadConnectionInstance */

export { ReadBatcher, isReadCommand, CommandQueue };
export default CadConnection;
