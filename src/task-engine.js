import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { log, error as logError } from './logger.js';
import { MCPError, ERROR_CODES } from './errors.js';

/**
 * 长任务引擎：把耗时工具调用从 MCP 请求里解耦出来。
 *
 * 设计约束：
 * - CAD COM 不可重入：引擎并发上限默认 2，真正的 CAD 命令仍由 command-queue 串行；
 * - 任务状态落盘（默认 ~/.atlisp/tasks.json），进程重启后未完成任务标记为 failed；
 * - 取消只在任务之间/工具调用返回后生效，不强行打断正在执行的 CAD 命令；
 * - 结果超过 MAX_RESULT_BYTES 时只保留摘要，避免磁盘被大结果撑爆。
 */

export const TASKS_FILE = process.env.ATLISP_TASKS_FILE
  || path.join(os.homedir(), '@lisp', 'tasks.json');

const MAX_TASKS = 200;
const TASK_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RESULT_BYTES = 256 * 1024;
const DEFAULT_CONCURRENCY = Number.parseInt(process.env.ATLISP_TASK_CONCURRENCY || '', 10) || 2;
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

function now() {
  return new Date().toISOString();
}

function truncateResult(result) {
  try {
    const json = JSON.stringify(result);
    if (json && Buffer.byteLength(json) > MAX_RESULT_BYTES) {
      return {
        truncated: true,
        content: [{
          type: 'text',
          text: `结果过大（${Buffer.byteLength(json)} 字节），仅保留摘要。请缩小参数范围后重试。`,
        }],
      };
    }
  } catch {
    // 无法序列化的结果原样保留，前端仍能在内存里读到
  }
  return result;
}

function publicView(task, { withResult = false } = {}) {
  const view = {
    taskId: task.id,
    tool: task.tool,
    status: task.status,
    createdAt: task.createdAt,
    startedAt: task.startedAt || null,
    finishedAt: task.finishedAt || null,
    progress: task.progress,
    error: task.error || null,
    cancelRequested: Boolean(task.cancelRequested),
  };
  if (withResult) view.result = task.result ?? null;
  return view;
}

export class TaskEngine {
  /**
   * @param {{file?: string, concurrency?: number, executor?: Function, now?: () => number}} [options]
   */
  constructor(options = {}) {
    this.file = options.file || TASKS_FILE;
    this.concurrency = Math.max(1, options.concurrency || DEFAULT_CONCURRENCY);
    this.executor = options.executor || null;
    this.tasks = new Map();
    this.queue = [];
    this.running = 0;
    this._clock = options.now || Date.now;
    this._loaded = false;
    this._writing = false;
  }

  /** 懒加载落盘任务；进程重启时把未完成任务标记失败。 */
  _load() {
    if (this._loaded) return;
    this._loaded = true;
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return;
    }
    const list = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
    for (const task of list) {
      if (!task?.id) continue;
      if (task.status === 'queued' || task.status === 'running') {
        task.status = 'failed';
        task.error = '服务重启，任务中断';
        task.finishedAt = now();
      }
      this.tasks.set(task.id, task);
    }
    this._prune();
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const payload = {
        version: 1,
        updatedAt: now(),
        tasks: [...this.tasks.values()],
      };
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (e) {
      logError(`[task-engine] 持久化失败: ${e.message}`);
    }
  }

  _prune() {
    const cutoff = this._clock() - TASK_TTL_MS;
    for (const [id, task] of this.tasks) {
      const finished = task.finishedAt ? Date.parse(task.finishedAt) : 0;
      if (TERMINAL.has(task.status) && finished && finished < cutoff) {
        this.tasks.delete(id);
      }
    }
    if (this.tasks.size <= MAX_TASKS) return;
    const ordered = [...this.tasks.values()].sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
    );
    for (const task of ordered.slice(0, this.tasks.size - MAX_TASKS)) {
      if (TERMINAL.has(task.status)) this.tasks.delete(task.id);
    }
  }

  /**
   * 提交任务。executor 签名与工具处理函数一致：(tool, args, options) => result。
   * @param {{tool: string, args?: object, sessionId?: string, timeoutMs?: number, notifyProgress?: Function}} spec
   * @param {Function} [executor]
   * @returns {object} 公开任务视图
   */
  submit(spec, executor) {
    this._load();
    const { tool, args = {}, sessionId = '', timeoutMs = 0, notifyProgress = null } = spec || {};
    if (!tool || typeof tool !== 'string') {
      throw new MCPError(ERROR_CODES.INVALID_ARGS, 'task_submit 需要 tool 名称');
    }
    if (tool.startsWith('task_')) {
      throw new MCPError(ERROR_CODES.INVALID_ARGS, '任务工具不能提交任务（禁止递归）');
    }
    const exec = executor || this.executor;
    if (typeof exec !== 'function') {
      throw new MCPError(ERROR_CODES.INTERNAL_ERROR, '任务引擎未配置执行器');
    }

    const task = {
      id: `task_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      tool,
      args,
      sessionId,
      timeoutMs: Math.min(Math.max(Number(timeoutMs) || 0, 0), 10 * 60 * 1000),
      status: 'queued',
      createdAt: now(),
      startedAt: null,
      finishedAt: null,
      progress: { current: 0, total: 1, message: '排队中' },
      result: null,
      error: null,
      cancelRequested: false,
      executor: exec,
      notifyProgress,
      timer: null,
    };
    this.tasks.set(task.id, task);
    this.queue.push(task.id);
    this._prune();
    this._save();
    this._pump();
    return publicView(task);
  }

  _pump() {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const id = this.queue.shift();
      const task = this.tasks.get(id);
      if (!task || task.status !== 'queued') continue;
      this._run(task);
    }
  }

  _emitProgress(task, current, total, message) {
    task.progress = { current, total, message };
    if (typeof task.notifyProgress === 'function') {
      try {
        task.notifyProgress(current, total, `[${task.id}] ${message}`);
      } catch (e) {
        log(`[task-engine] 进度通知失败: ${e.message}`);
      }
    }
  }

  async _run(task) {
    this.running += 1;
    task.status = 'running';
    task.startedAt = now();
    this._emitProgress(task, 0, 1, `开始执行 ${task.tool}`);

    const execOptions = {
      sessionId: task.sessionId,
      correlationId: task.id,
      notifyProgress: (current, total, message) => this._emitProgress(task, current, total, message),
    };

    let timer = null;
    try {
      const work = Promise.resolve().then(() => task.executor(task.tool, task.args, execOptions));
      const guarded = task.timeoutMs > 0
        ? Promise.race([
          work,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new MCPError(
              ERROR_CODES.TIMEOUT,
              `任务超过 ${task.timeoutMs}ms 未完成`,
            )), task.timeoutMs);
            timer.unref?.();
          }),
        ])
        : work;

      const result = await guarded;
      if (task.cancelRequested) {
        task.status = 'cancelled';
        task.error = '任务被取消';
        this._emitProgress(task, 1, 1, '已取消');
      } else if (result?.isError) {
        task.status = 'failed';
        task.error = result?.content?.[0]?.text || '工具执行失败';
      } else {
        task.status = 'succeeded';
        task.result = truncateResult(result);
        this._emitProgress(task, 1, 1, '执行完成');
      }
    } catch (e) {
      if (task.cancelRequested) {
        task.status = 'cancelled';
        task.error = '任务被取消';
      } else {
        task.status = 'failed';
        task.error = e?.message || String(e);
      }
      this._emitProgress(task, 1, 1, '执行失败');
    } finally {
      if (timer) clearTimeout(timer);
      task.finishedAt = now();
      task.executor = null;
      task.notifyProgress = null;
      this.running -= 1;
      this._save();
      this._pump();
    }
  }

  get(taskId, options = {}) {
    this._load();
    this._prune();
    const task = this.tasks.get(taskId);
    if (!task) throw new MCPError(ERROR_CODES.TASK_NOT_FOUND, `任务不存在: ${taskId}`);
    return publicView(task, options);
  }

  list({ status = '', limit = 50 } = {}) {
    this._load();
    this._prune();
    let tasks = [...this.tasks.values()];
    if (status) tasks = tasks.filter((t) => t.status === status);
    tasks.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return {
      total: tasks.length,
      tasks: tasks.slice(0, Math.min(Math.max(Number(limit) || 50, 1), MAX_TASKS)).map((t) => publicView(t)),
    };
  }

  cancel(taskId) {
    this._load();
    const task = this.tasks.get(taskId);
    if (!task) throw new MCPError(ERROR_CODES.TASK_NOT_FOUND, `任务不存在: ${taskId}`);
    if (TERMINAL.has(task.status)) {
      return publicView(task);
    }
    task.cancelRequested = true;
    if (task.status === 'queued') {
      task.status = 'cancelled';
      task.error = '任务被取消';
      task.finishedAt = now();
      this.queue = this.queue.filter((id) => id !== taskId);
      this._emitProgress(task, 0, 1, '已取消（尚未开始）');
    } else {
      this._emitProgress(task, task.progress.current, task.progress.total, '取消请求已记录，等待当前步骤结束');
    }
    this._save();
    return publicView(task);
  }

  /** 长轮询：最多等 waitMs（上限 30s），返回最新视图。 */
  async wait(taskId, waitMs = 0) {
    const deadline = this._clock() + Math.min(Math.max(Number(waitMs) || 0, 0), 30000);
    let task = this.get(taskId);
    while (!TERMINAL.has(task.status) && this._clock() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      task = this.get(taskId);
    }
    return this.get(taskId, { withResult: TERMINAL.has(task.status) });
  }

  /** 测试/关闭时清空内存与落盘。 */
  reset({ keepFile = false } = {}) {
    this.tasks.clear();
    this.queue = [];
    this.running = 0;
    this._loaded = true;
    if (!keepFile) {
      try { fs.unlinkSync(this.file); } catch { /* 文件本来就不存在 */ }
    }
  }
}

export const taskEngine = new TaskEngine();
