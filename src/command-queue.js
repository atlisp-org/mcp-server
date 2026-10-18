// @ts-check
/**
 * CAD 命令队列：优先级队列 + 读命令批处理。
 *
 * 从 cad.js 提取（cad.js 原 1170 行），便于单独测试与复用：
 *   - `CommandQueue`：三级优先级、相同代码去重、队列上限保护；
 *   - `ReadBatcher`：把窗口期内的只读命令合并成一次 CAD 调用（默认 50ms / 10 条）；
 *   - `isReadCommand`：判断是否为可批处理的只读命令。
 *
 * 连接对象只要求提供 `_sendMessageInternal(command)`。
 */
import config from './config.js';

export const PRIORITY_HIGH = 0;
export const PRIORITY_NORMAL = 1;
export const PRIORITY_LOW = 2;
export const MAX_QUEUE_SIZE = 1000;

const READ_PREFIXES = new Set([
  '(tblnext', '(ssget', '(entget', '(entsel', '(tblsearch',
  '(layoutlist', '(layoutname', '(getvar', '(getcfg',
]);

/** 只读命令前缀判断（大小写不敏感地按 trim 后的前缀匹配）。 */
export function isReadCommand(code) {
  const trimmed = code.trim();
  for (const prefix of READ_PREFIXES) {
    if (trimmed.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * @typedef {{ type: string, code: string, platform: string, encoding: string,
 *   resolve: Function, reject: Function, _dedupKeys?: string[] }} BatchCommand
 */

export class ReadBatcher {
  /**
   * @param {object} connection
   * @param {number} maxDelayMs
   * @param {number} maxBatchSize
   */
  constructor(connection, maxDelayMs = 50, maxBatchSize = 10) {
    this._conn = connection;
    this._batch = [];
    this._timer = null;
    this._maxDelayMs = maxDelayMs;
    this._maxBatchSize = maxBatchSize;
  }

  /**
   * 加入一条只读命令。
   * @param {BatchCommand} command
   * @param {string|null} dedupKey
   * @returns {boolean} 是否已被批处理器接管
   */
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

export class CommandQueue {
  /** @param {object} connection */
  constructor(connection) {
    this._conn = connection;
    this._queues = [[], [], []];
    this._processing = false;
    this._dedupMap = new Map();
    /** @type {ReadBatcher|null} */
    this._batcher = null;
  }

  enableBatcher() {
    if (this._batcher) return;
    this._batcher = new ReadBatcher(this._conn, config.readBatchWindow, config.readBatchSize);
  }

  enqueue(command, priority = PRIORITY_NORMAL) {
    const total = this.size();
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
      // 先登记去重键再入批：批处理可能在 add() 内同步 flush，
      // 若 flush 后再 set，会把已消费的键重新写回 _dedupMap（后续同键请求永远悬空）。
      if (dedupKey) this._dedupMap.set(dedupKey, command);
      if (this._batcher.add(command, dedupKey)) {
        return;
      }
    } else if (dedupKey) {
      this._dedupMap.set(dedupKey, command);
    }
    this._queues[priority].push(command);
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
    if (this.size() >= MAX_QUEUE_SIZE) {
      command.reject(new Error('Command queue full, try again later'));
      return;
    }
    this._queues[PRIORITY_HIGH].push(command);
    this._process();
  }
}
