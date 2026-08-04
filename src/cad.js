// @ts-check
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import config from './config.js';
import { setCadConnected } from './metrics.js';
import { CircuitBreaker } from './cad-circuit-breaker.js';
import { log, error as logError } from './logger.js';
import { createError, ERROR_CODES, MCPError } from './errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(__dirname, 'cad-worker.js');

const MESSAGE_TIMEOUT = config.messageTimeout;
const CAD_COMMAND_TIMEOUT = config.cadCommandTimeout;
const STALL_COOLDOWN = config.stallCooldown;
const HEARTBEAT_PING_TIMEOUT = config.heartbeatPingTimeout;
const HEARTBEAT_INTERVAL = config.heartbeatInterval;
const MAX_RESTART_ATTEMPTS = 5;
const RESTART_BACKOFF_BASE = 1000;

const MAX_BUFFER_SIZE = 8 * 1024 * 1024;

const PRIORITY_HIGH = 0;
const PRIORITY_NORMAL = 1;
const PRIORITY_LOW = 2;
const MAX_QUEUE_SIZE = 500;

const READ_PREFIXES = new Set([
  '(tblnext', '(ssget', '(entget', '(entsel', '(tblsearch',
  '(layoutlist', '(layoutname', '(getvar', '(getcfg',
]);

function isReadCommand(code) {
  const trimmed = code.trim();
  for (const prefix of READ_PREFIXES) {
    if (trimmed.startsWith(prefix)) return true;
  }
  return false;
}

const _docChangeCallbacks = [];

export function onDocumentChanged(callback) {
  _docChangeCallbacks.push(callback);
}

function emitDocumentChanged(info) {
  for (const cb of _docChangeCallbacks) {
    try { cb(info); } catch (e) { logError('doc change callback error:', e.message); }
  }
}

/**
 * @typedef {{ type: string, code: string, platform: string, encoding: string, resolve: Function, reject: Function }} Command
 * @typedef {{ success: boolean, result?: string, error?: string, rawBase64?: string }} CommandResult
 */

class ReadBatcher {
  /** @param {object} connection @param {number} maxDelayMs @param {number} maxBatchSize */
  constructor(connection, maxDelayMs = 50, maxBatchSize = 10) {
    this._conn = connection;
    this._batch = [];
    this._timer = null;
    this._maxDelayMs = maxDelayMs;
    this._maxBatchSize = maxBatchSize;
  }

  add(command, dedupKey) {
    if (!isReadCommand(command.code)) return false;
    this._batch.push({ command, dedupKey });
    if (this._batch.length >= this._maxBatchSize) {
      this._flush();
    } else if (!this._timer) {
      this._timer = setTimeout(() => this._flush(), this._maxDelayMs);
    }
    return true;
  }

  _flush() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    const items = this._batch.splice(0);
    if (items.length === 0) return;
    if (items.length === 1) {
      const { command } = items[0];
      this._conn._commandQueue.enqueueHighPriority(command);
      return;
    }
    const combinedCode = items.map((item, idx) =>
      `(setq _br${idx} (${item.command.code.replace(/^\(/, '')}))`
    ).join(' ') + ` (list${items.map((_, idx) => ` _br${idx}`).join('')})`;
    const combinedCommand = {
      type: 'sendResult', code: combinedCode, platform: this._conn._platform, encoding: '',
      _dedupKeys: items.map(item => item.dedupKey).filter(Boolean),
      resolve: (result) => {
        if (!result.success || !result.result) {
          items.forEach(item => item.command.reject(new Error(result.error || 'Batch failed')));
          return;
        }
        try {
          const parts = typeof result.result === 'string' ? JSON.parse(result.result) : result.result;
          if (Array.isArray(parts)) {
            items.forEach((item, idx) => {
              if (idx < parts.length) {
                const partStr = typeof parts[idx] === 'string' ? parts[idx] : JSON.stringify(parts[idx]);
                item.command.resolve({ success: true, result: partStr });
              } else {
                item.command.resolve({ success: true, result: 'nil' });
              }
            });
          } else {
            items.forEach(item => item.command.reject(new Error('Batch result is not an array')));
          }
        } catch {
          items.forEach(item => item.command.reject(new Error('Failed to parse batch result')));
        }
      },
      reject: (err) => {
        items.forEach(item => item.command.reject(err));
      }
    };
    this._conn._commandQueue.enqueueHighPriority(combinedCommand);
  }
}

/**
 * @template T
 * @typedef {{ resolve: (v: T) => void, reject: (e: Error) => void, timeout: NodeJS.Timeout, _skipCb?: boolean }} PendingEntry
 */

class CommandQueue {
  /** @param {object} connection */
  constructor(connection) {
    this._conn = connection;
    this._queues = [[], [], []];
    this._processing = false;
    this._dedupMap = new Map();
    this._batcher = null;
  }

  enableBatcher() {
    if (this._batcher) return;
    this._batcher = new ReadBatcher(this._conn, config.readBatchWindow, config.readBatchSize);
  }

  enqueue(command, priority = PRIORITY_NORMAL) {
    const total = this._queues.reduce((s, q) => s + q.length, 0);
    if (total >= MAX_QUEUE_SIZE) {
      command.reject(new Error('Command queue full, try again later'));
      return;
    }
    const dedupKey = this._dedupKey(command);
    if (dedupKey) {
      const existing = this._dedupMap.get(dedupKey);
      if (existing) {
        if (existing.resolve) {
          existing.reject(new Error('Deduplicated: replaced by newer command'));
        }
        existing.resolve = command.resolve;
        existing.reject = command.reject;
        return;
      }
    }
    if (this._batcher && command.type === 'sendResult') {
      if (this._batcher.add(command, dedupKey)) {
        if (dedupKey) this._dedupMap.set(dedupKey, command);
        return;
      }
    }
    this._queues[priority].push(command);
    if (dedupKey) {
      this._dedupMap.set(dedupKey, command);
    }
    this._process();
  }

  _dedupKey(command) {
    if (command.type === 'send' || command.type === 'sendResult') {
      return command.type + ':' + command.code;
    }
    return null;
  }

  async _process() {
    if (this._processing) return;
    this._processing = true;
    while (this._hasPending()) {
      const cmd = this._dequeue();
      if (!cmd) continue;
      if (cmd._dedupKeys) {
        for (const k of cmd._dedupKeys) this._dedupMap.delete(k);
      } else {
        const dedupKey = this._dedupKey(cmd);
        if (dedupKey) this._dedupMap.delete(dedupKey);
      }
      try {
        const result = await this._conn._sendMessageInternal(cmd);
        cmd.resolve(result);
      } catch (e) {
        cmd.reject(e);
      }
    }
    this._processing = false;
  }

  _hasPending() {
    return this._queues.some(q => q.length > 0);
  }

  _dequeue() {
    for (const q of this._queues) {
      if (q.length > 0) return q.shift();
    }
    return null;
  }

  clear(error) {
    for (const q of this._queues) {
      while (q.length) {
        const cmd = q.shift();
        cmd.reject(error || new Error('Queue cleared'));
      }
    }
    this._dedupMap.clear();
  }

  size() {
    return this._queues.reduce((s, q) => s + q.length, 0);
  }

  enqueueHighPriority(command) {
    this._queues[PRIORITY_HIGH].push(command);
    this._process();
  }
}

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
      (id) => logError(`[${id}] Circuit breaker OPEN`),
      (id) => logError(`[${id}] Circuit breaker HALF_OPEN, allowing trial request`)
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
        this._clearStall();
        setCadConnected(true);
        this._activeDocName = null;
        this._commandQueue.enableBatcher();
        if (!this._monitorStarted) {
          this._monitorStarted = true;
          this._sendMessage({ type: 'startMonitor', platform: this._platform }).catch(() => { this._monitorStarted = false; });
        }
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
    if (!this.connected) throw new Error('未连接 CAD');
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
   * @returns {Promise<string|{ text: string, rawBase64: string }>}
   */
  async sendCommandWithResult(code, encoding = null, raw = false) {
    if (!this.connected) throw new Error('未连接 CAD');
    if (this.isStalled()) throw this._stallError();
    return new Promise((resolve, reject) => {
      this._commandQueue.enqueue({
        type: 'sendResult', code, platform: this._platform, encoding: encoding || '',
        resolve, reject
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

  _stallError(reason = this._stallReason || 'CAD 停滞') {
    const info = this.getStallInfo();
    return new MCPError(
      ERROR_CODES.CAD_BUSY,
      `CAD 停滞中（可能等待输入或弹窗）：${reason}。冷却期内命令将快速失败，可人工处理 CAD 后重试，或打开新 CAD 实例继续任务`,
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
    } catch (e) {
      return false;
    }
  }

  async hasDoc() {
    if (!this.connected) return { hasDoc: false, docCount: 0 };
    try {
      const result = await this._sendMessage({ type: 'hasdoc', platform: this._platform });
      return result || { hasDoc: false, docCount: 0 };
    } catch (e) {
      return { hasDoc: false, docCount: 0 };
    }
  }

  async newDoc() {
    if (!this.connected) throw new Error('未连接 CAD');
    try {
      const result = await this._sendMessage({ type: 'newdoc', platform: this._platform });
      return result && result.success;
    } catch (e) {
      return false;
    }
  }

  async bringToFront() {
    if (!this.connected) throw new Error('未连接 CAD');
    try {
      const result = await this._sendMessage({ type: 'bringToFront', platform: this._platform });
      return result && result.success;
    } catch (e) {
      return false;
    }
  }

  async getActiveDocInfo() {
    if (!this.connected) return { docName: '', docPath: '', docCount: 0 };
    if (this.isStalled()) return { docName: '', docPath: '', docCount: 0 };
    try {
      const result = await this._sendMessage({ type: 'getActiveDocInfo', platform: this._platform });
      return result || { docName: '', docPath: '', docCount: 0 };
    } catch (e) {
      return { docName: '', docPath: '', docCount: 0 };
    }
  }

  async getInfo() {
    if (!this.connected) return 'CAD 未连接';
    return `Platform: ${this._product}, Version: ${this._version}, Status: Connected`;
  }

  async disconnect() {
    this._reset();
    this._cb.reset();
  }

  async ping() {
    try {
      const result = await this._sendMessage({ type: 'ping' });
      return result && result.pong;
    } catch (e) {
      return false;
    }
  }

  _reset() {
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
  }

  _getQueueSize() { return this._commandQueue.size(); }
  _getRestartCount() { return this._restartCount; }

  _spawnWorker(type) {
    const w = spawn('node', [workerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        BUSY_RETRIES: String(config.busyRetries ?? 5),
        BUSY_DELAY: String(config.busyDelay ?? 300),
      },
    });
    w.connected = true;
    w._workerType = type;

    this._setupStdoutHandler(w);

    w.on('exit', (code) => {
      logError(`[${this._connectionId}] ${type} worker exited with code:`, code);
      w.connected = false;

      if (type === 'primary') {
        if (w !== this._primaryWorker) return;
        this._cb.recordFailure();
        this._clearStall();
        const exitError = new Error(`Primary worker exited with code ${code}`);
        for (const [id, entry] of this._pendingRequests) {
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
        const idx = this._readWorkers.indexOf(w);
        if (idx >= 0) this._readWorkers.splice(idx, 1);
        const poolSize = this._workerPoolSize;
        const alive = this._readWorkers.filter(rw => rw.connected).length;
        if (alive < poolSize - 1) {
          const rw = this._spawnWorker('read');
          this._readWorkers.push(rw);
        }
      }
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
    }

    if (isReadOnly && poolSize > 1) {
      this._readWorkers = this._readWorkers.filter(rw => rw.connected);
      const needed = poolSize - 1 - this._readWorkers.length;
      for (let i = 0; i < needed; i++) {
        const rw = this._spawnWorker('read');
        this._readWorkers.push(rw);
      }
      if (this._readWorkers.length > 0) {
        this._readWorkerIndex = (this._readWorkerIndex + 1) % this._readWorkers.length;
        return this._readWorkers[this._readWorkerIndex];
      }
    }

    return this._primaryWorker;
  }

  _resetWorker() {
    for (const [id, { reject, timeout }] of this._pendingRequests) {
      clearTimeout(timeout);
      reject(new Error('Worker reset'));
    }
    this._pendingRequests.clear();
    this._commandQueue.clear();

    if (this._primaryWorker) {
      try { this._primaryWorker.kill(); } catch (e) { logError('[cad]', e?.message || e); }
      this._primaryWorker = null;
    }
    for (const rw of this._readWorkers) {
      try { rw.kill(); } catch (e) { logError('[cad]', e?.message || e); }
    }
    this._readWorkers = [];
    this._readWorkerIndex = 0;

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

  _setupStdoutHandler(w) {
    let buffer = '';
    const self = this;

    w.stdout.on('data', (data) => {
      try {
        buffer += data.toString();
        if (buffer.length > MAX_BUFFER_SIZE) {
          const lastNewline = buffer.lastIndexOf('\n');
          buffer = lastNewline >= 0 ? buffer.slice(lastNewline + 1) : buffer.slice(-MAX_BUFFER_SIZE);
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

  _startHeartbeat() {
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
    const self = this;
    this._heartbeatTimer = setInterval(async () => {
      if (self._stalledUntil > Date.now()) return;
      try {
        const result = await self._sendMessageInternal({ type: 'ping' }, true, HEARTBEAT_PING_TIMEOUT);
        if (!result?.pong) {
          logError(`[${self._connectionId}] heartbeat failed, worker may be dead`);
          self._resetWorker();
          return;
        }
        if (self._platform) {
          try {
            const docResult = await self._sendMessageInternal({ type: 'getActiveDocInfo', platform: self._platform }, true, HEARTBEAT_PING_TIMEOUT);
            if (docResult?.docName) {
              emitDocumentChanged({ docName: docResult.docName, docPath: docResult.docPath || '' });
            }
          } catch (e) {
            logError(`[${self._connectionId}] heartbeat doc poll error:`, e.message);
          }
        }
      } catch (e) {
        logError(`[${self._connectionId}] heartbeat error:`, e.message);
        self._resetWorker();
      }
    }, HEARTBEAT_INTERVAL);
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
      logError(`[${this._connectionId}] Circuit breaker OPEN, auto-recovering...`);
      this._cb.reset();
      await this._resetWorker();
      await this._getWorker(false);
    }
    return this._sendMessageInternal(msg);
  }

  _sendMessageInternal(msg, noCircuitBreaker = false, timeoutMs = null) {
    const isReadOnly = this._isReadOnlyMessage(msg);
    const w = this._getWorker(isReadOnly);
    const requestId = randomUUID();
    const self = this;

    const effectiveTimeout = timeoutMs ?? (msg.type === 'ping' ? MESSAGE_TIMEOUT : CAD_COMMAND_TIMEOUT);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const p = self._pendingRequests.get(requestId);
        if (p) {
          self._pendingRequests.delete(requestId);
          if (!noCircuitBreaker) self._cb.recordFailure();
          if (!noCircuitBreaker && msg.type !== 'ping') {
            self._markStalled(`消息 ${msg.type} 超时 (${effectiveTimeout}ms)`);
            reject(self._stallError());
            return;
          }
          reject(new Error('Timeout waiting for worker'));
        }
      }, effectiveTimeout);

      const entry = {
        resolve: (v) => { if (!noCircuitBreaker && !entry._skipCb) self._cb.recordSuccess(); resolve(v); },
        reject: (e) => { if (!noCircuitBreaker && !entry._skipCb) self._cb.recordFailure(); reject(e); },
        timeout,
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
 *   version: string|null,
 *   product: string|null,
 *   _platform: string|null,
 *   connect(platform?: string|null, options?: { moniker?: string, key?: string, forceLaunch?: boolean }): Promise<boolean>,
 *   sendCommand(code: string): Promise<boolean>,
 *   sendCommandWithResult(code: string, encoding?: string|null, raw?: boolean): Promise<string|{text:string,rawBase64:string}>,
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

  get version() { return _resolveConn()._version; },
  set version(v) { _resolveConn()._version = v; },
  get product() { return _resolveConn()._product; },
  set product(v) { _resolveConn()._product = v; },
  get _platform() { return _resolveConn()._platform; },
  set _platform(v) { _resolveConn()._platform = v; },

  async connect(platform, options) { return _resolveConn().connect(platform, options); },
  async sendCommand(code) { return _resolveConn().sendCommand(code); },
  async sendCommandWithResult(code, encoding, raw) { return _resolveConn().sendCommandWithResult(code, encoding, raw); },
  getVersion() { return _resolveConn().getVersion(); },
  getPlatform() { return _resolveConn().getPlatform(); },
  getConnectionId() { return _resolveConn().getConnectionId(); },
  isAvailable() { return _resolveConn().isAvailable(); },
  async isBusy() { return _resolveConn().isBusy(); },
  isStalled() { return _resolveConn().isStalled(); },
  getStallInfo() { return _resolveConn().getStallInfo(); },
  async hasDoc() { return _resolveConn().hasDoc(); },
  async newDoc() { return _resolveConn().newDoc(); },
  async bringToFront() { return _resolveConn().bringToFront(); },
  async getActiveDocInfo() { return _resolveConn().getActiveDocInfo(); },
  async getInfo() { return _resolveConn().getInfo(); },
  async disconnect() { return _resolveConn().disconnect(); },
  async ping() { return _resolveConn().ping(); },
  _reset() { return _resolveConn()._reset(); },
  _getQueueSize() { return _resolveConn()._getQueueSize(); },
  _getRestartCount() { return _resolveConn()._getRestartCount(); },
};

/** @typedef {typeof CadConnection.prototype} CadConnectionInstance */

export { ReadBatcher, isReadCommand, CommandQueue };
export default CadConnection;
