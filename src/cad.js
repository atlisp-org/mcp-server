import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import config from './config.js';
import { setCadConnected } from './metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(__dirname, 'cad-worker.js');

const MESSAGE_TIMEOUT = config.messageTimeout;
const HEARTBEAT_INTERVAL = config.heartbeatInterval;
const MAX_RESTART_ATTEMPTS = 5;
const RESTART_BACKOFF_BASE = 1000;

const CB_CLOSED = 0;
const CB_OPEN = 1;
const CB_HALF_OPEN = 2;
const CB_FAILURE_THRESHOLD = 3;
const CB_RESET_TIMEOUT = 30000;

const MAX_BUFFER_SIZE = 1024 * 1024;

const PRIORITY_HIGH = 0;
const PRIORITY_NORMAL = 1;
const PRIORITY_LOW = 2;
const MAX_QUEUE_SIZE = 500;

const READ_PATTERN = /^\(tblnext|^\(ssget|^\(entget|^\(entsel|^\(tblsearch|^\(layoutlist|^\(layoutname|^\(getvar|^\(getcfg/;

// --- Module-level document change callbacks (shared across all instances) ---
const _docChangeCallbacks = [];

export function onDocumentChanged(callback) {
  _docChangeCallbacks.push(callback);
}

function emitDocumentChanged(info) {
  for (const cb of _docChangeCallbacks) {
    try { cb(info); } catch (e) { console.error('doc change callback error:', e.message); }
  }
}

// --- ReadBatcher (instance-aware) ---
class ReadBatcher {
  constructor(connection, maxDelayMs = 50, maxBatchSize = 10) {
    this._conn = connection;
    this._batch = [];
    this._timer = null;
    this._maxDelayMs = maxDelayMs;
    this._maxBatchSize = maxBatchSize;
  }

  add(command, dedupKey) {
    if (!READ_PATTERN.test(command.code.trim())) return false;
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

// --- CommandQueue (instance-aware) ---
class CommandQueue {
  constructor(connection) {
    this._conn = connection;
    this._queues = [[], [], []];
    this._processing = false;
    this._dedupMap = new Map();
    this._batcher = null;
  }

  enableBatcher() {
    if (this._batcher) return;
    this._batcher = new ReadBatcher(this._conn, 50, 10);
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
      const dedupKey = this._dedupKey(cmd);
      if (dedupKey) this._dedupMap.delete(dedupKey);
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

  clear() {
    for (const q of this._queues) {
      while (q.length) {
        const cmd = q.shift();
        cmd.reject(new Error('Queue cleared'));
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

// --- CadConnection instance ---
class CadConnection {
  _worker = null;
  _platform = null;
  _version = null;
  _product = null;
  connected = false;

  _heartbeatTimer = null;
  _pendingRequests = new Map();
  _stdoutHandlerSetup = false;
  _commandQueue = null;

  _cbState = CB_CLOSED;
  _cbFailureCount = 0;
  _cbLastFailureTime = 0;
  _cbTimer = null;

  _restartCount = 0;
  _restartTimer = null;
  _activeDocName = null;
  _monitorStarted = false;
  _connectionId = null;

  constructor() {
    this._connectionId = randomUUID().slice(0, 8);
    this._commandQueue = new CommandQueue(this);
  }

  isAvailable() {
    return process.platform === 'win32';
  }

  async connect(platform = null) {
    if (!this.isAvailable()) return false;
    this._cbSuccess();
    try {
      const msg = platform ? { type: 'connect', platform } : { type: 'connect' };
      const result = await this._sendMessage(msg);
      if (result && result.success) {
        this._version = result.version;
        this._product = result.platform;
        this._platform = result.platform;
        this.connected = true;
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
      console.error('CAD connect error:', e.message);
    }
    return false;
  }

  async sendCommand(code) {
    if (!this.connected) throw new Error('未连接 CAD');
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

  async sendCommandWithResult(code, encoding = null) {
    if (!this.connected) throw new Error('未连接 CAD');
    return new Promise((resolve, reject) => {
      this._commandQueue.enqueue({
        type: 'sendResult', code, platform: this._platform, encoding: encoding || '',
        resolve, reject
      }, PRIORITY_NORMAL);
    }).then(result => {
      if (result.success) return result.result || '';
      throw new Error(result.error || '发送失败');
    });
  }

  getVersion() { return this._version; }
  getPlatform() { return this._product; }
  getConnectionId() { return this._connectionId; }

  async isBusy() {
    if (!this.connected) return false;
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
    this.connected = false;
    setCadConnected(false);
    this._version = null;
    this._product = null;
    this._platform = null;
    this._activeDocName = null;
    this._monitorStarted = false;
    this._commandQueue.clear();
    this._cbState = CB_CLOSED;
    this._cbFailureCount = 0;
    if (this._cbTimer) { clearTimeout(this._cbTimer); this._cbTimer = null; }
    this._resetWorker();
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
    this._commandQueue.clear();
    this._cbState = CB_CLOSED;
    this._cbFailureCount = 0;
    if (this._cbTimer) { clearTimeout(this._cbTimer); this._cbTimer = null; }
    this._resetWorker();
  }

  _getQueueSize() { return this._commandQueue.size(); }
  _getRestartCount() { return this._restartCount; }

  // --- Circuit breaker ---
  _cbSuccess() {
    this._cbState = CB_CLOSED;
    this._cbFailureCount = 0;
    if (this._cbTimer) { clearTimeout(this._cbTimer); this._cbTimer = null; }
  }

  _cbFailure() {
    this._cbFailureCount++;
    this._cbLastFailureTime = Date.now();
    if (this._cbFailureCount >= CB_FAILURE_THRESHOLD && this._cbState !== CB_OPEN) {
      this._cbState = CB_OPEN;
      console.error(`[${this._connectionId}] Circuit breaker OPEN after ${this._cbFailureCount} failures`);
      this._cbTimer = setTimeout(() => {
        this._cbState = CB_HALF_OPEN;
        console.error(`[${this._connectionId}] Circuit breaker HALF_OPEN, allowing trial request`);
      }, CB_RESET_TIMEOUT);
    }
  }

  _cbAllowRequest() {
    if (this._cbState === CB_OPEN) {
      const elapsed = Date.now() - this._cbLastFailureTime;
      if (elapsed >= CB_RESET_TIMEOUT) {
        this._cbState = CB_HALF_OPEN;
        console.error(`[${this._connectionId}] Circuit breaker auto-transition to HALF_OPEN`);
      } else {
        return false;
      }
    }
    return true;
  }

  // --- Worker management ---
  _getWorker(force = false) {
    if (!this._worker || !this._worker.connected || force) {
      if (this._worker) this._worker.kill();
      const w = spawn('node', [workerPath], { stdio: ['pipe', 'pipe', 'pipe'] });
      w.connected = true;
      this._worker = w;
      this._cbSuccess();

      w.on('exit', (code) => {
        console.error(`[${this._connectionId}] worker exited with code:`, code);
        if (w !== this._worker) return;
        w.connected = false;
        this._cbFailure();
        const exitError = new Error(`Worker exited with code ${code}`);
        for (const [id, entry] of this._pendingRequests) {
          clearTimeout(entry.timeout);
          entry._skipCb = true;
          entry.reject(exitError);
        }
        this._pendingRequests.clear();
        this._stdoutHandlerSetup = false;
        if (this._heartbeatTimer) {
          clearInterval(this._heartbeatTimer);
          this._heartbeatTimer = null;
        }
        this._scheduleRestart();
      });
      this._setupStdoutHandler(w);
      this._startHeartbeat();
      this._restartCount = 0;
    }
    return this._worker;
  }

  _resetWorker() {
    for (const [id, { reject, timeout }] of this._pendingRequests) {
      clearTimeout(timeout);
      reject(new Error('Worker reset'));
    }
    this._pendingRequests.clear();
    this._stdoutHandlerSetup = false;
    this._commandQueue.clear();
    if (this._worker) {
      this._worker.kill();
      this._worker = null;
    }
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  _setupStdoutHandler(w) {
    let buffer = '';
    this._stdoutHandlerSetup = true;
    const self = this;

    w.stdout.on('data', (data) => {
      try {
        buffer += data.toString();
        if (buffer.length > MAX_BUFFER_SIZE) {
          buffer = buffer.slice(-MAX_BUFFER_SIZE);
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
              console.error(`[${self._connectionId}] JSON parse error in worker output:`, parseErr.message);
            }
          }
        }
      } catch (e) {
        console.error(`[${self._connectionId}] Unexpected error in worker stdout handler:`, e.message);
      }
    });

    w.stderr.on('data', (d) => console.error(`[${self._connectionId}] worker stderr:`, d.toString()));
  }

  _startHeartbeat() {
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
    const self = this;
    this._heartbeatTimer = setInterval(async () => {
      try {
        const result = await self._sendMessageInternal({ type: 'ping' }, true);
        if (!result?.pong) {
          console.error(`[${self._connectionId}] heartbeat failed, worker may be dead`);
          self._resetWorker();
          return;
        }
        if (self._platform) {
          try {
            const docResult = await self._sendMessageInternal({ type: 'getActiveDocInfo', platform: self._platform }, true);
            if (docResult?.docName) {
              emitDocumentChanged({ docName: docResult.docName, docPath: docResult.docPath || '' });
            }
          } catch (e) {
            console.error(`[${self._connectionId}] heartbeat doc poll error:`, e.message);
          }
        }
      } catch (e) {
        console.error(`[${self._connectionId}] heartbeat error:`, e.message);
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
      console.error(`[${this._connectionId}] Max worker restart attempts reached, giving up`);
      return;
    }
    const delay = Math.min(RESTART_BACKOFF_BASE * Math.pow(2, this._restartCount), 30000);
    this._restartCount++;
    console.error(`[${this._connectionId}] Scheduling worker restart in ${delay}ms (attempt ${this._restartCount}/${MAX_RESTART_ATTEMPTS})`);
    const self = this;
    this._restartTimer = setTimeout(() => {
      self._restartTimer = null;
      console.error(`[${self._connectionId}] Attempting worker restart...`);
      self._getWorker(true);
    }, delay);
  }

  _sendMessage(msg) {
    if (!this._cbAllowRequest()) {
      return Promise.reject(new Error(`Circuit breaker OPEN: CAD 不可用（${Math.ceil((CB_RESET_TIMEOUT - (Date.now() - this._cbLastFailureTime)) / 1000)}s 后重试）`));
    }
    return this._sendMessageInternal(msg);
  }

  _sendMessageInternal(msg, noCircuitBreaker = false) {
    const w = this._getWorker();
    const requestId = randomUUID();
    const self = this;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const p = self._pendingRequests.get(requestId);
        if (p) {
          self._pendingRequests.delete(requestId);
          if (!noCircuitBreaker) self._cbFailure();
          reject(new Error('Timeout waiting for worker'));
        }
      }, MESSAGE_TIMEOUT);

      const entry = {
        resolve: (v) => { if (!noCircuitBreaker && !entry._skipCb) self._cbSuccess(); resolve(v); },
        reject: (e) => { if (!noCircuitBreaker && !entry._skipCb) self._cbFailure(); reject(e); },
        timeout,
      };
      self._pendingRequests.set(requestId, entry);
      try {
        w.stdin.write(JSON.stringify({ ...msg, requestId }) + '\n');
      } catch (e) {
        clearTimeout(timeout);
        self._pendingRequests.delete(requestId);
        if (!noCircuitBreaker) self._cbFailure();
        reject(new Error(`Failed to write to worker: ${e.message}`));
      }
    });
  }
}

// --- Factory ---
export function createCadConnection() {
  return new CadConnection();
}

// --- Default singleton + active connection delegation ---
let _activeConnection = new CadConnection();

export function setActiveConnection(conn) {
  _activeConnection = conn;
}

export function getActiveConnection() {
  return _activeConnection;
}

export const cad = {
  get connected() { return _activeConnection.connected; },
  set connected(v) { _activeConnection.connected = v; },

  // Backward-compat direct property access for version/product
  get version() { return _activeConnection._version; },
  set version(v) { _activeConnection._version = v; },
  get product() { return _activeConnection._product; },
  set product(v) { _activeConnection._product = v; },
  get _platform() { return _activeConnection._platform; },
  set _platform(v) { _activeConnection._platform = v; },

  async connect(platform) { return _activeConnection.connect(platform); },
  async sendCommand(code) { return _activeConnection.sendCommand(code); },
  async sendCommandWithResult(code, encoding) { return _activeConnection.sendCommandWithResult(code, encoding); },
  getVersion() { return _activeConnection.getVersion(); },
  getPlatform() { return _activeConnection.getPlatform(); },
  getConnectionId() { return _activeConnection.getConnectionId(); },
  isAvailable() { return _activeConnection.isAvailable(); },
  async isBusy() { return _activeConnection.isBusy(); },
  async hasDoc() { return _activeConnection.hasDoc(); },
  async newDoc() { return _activeConnection.newDoc(); },
  async bringToFront() { return _activeConnection.bringToFront(); },
  async getActiveDocInfo() { return _activeConnection.getActiveDocInfo(); },
  async getInfo() { return _activeConnection.getInfo(); },
  async disconnect() { return _activeConnection.disconnect(); },
  async ping() { return _activeConnection.ping(); },
  _reset() { return _activeConnection._reset(); },
  _getQueueSize() { return _activeConnection._getQueueSize(); },
  _getRestartCount() { return _activeConnection._getRestartCount(); },
};

export default CadConnection;
