/**
 * ERROR 日志上报（用于改进 @lisp MCP Server）。
 *
 * 设计要点：
 * - 只上报 `logger.error()` 的条目，通过 `setErrorNotify()` 接线，避免 logger ↔ reporter 循环依赖；
 * - 默认开启，可用 `ERROR_REPORT_ENABLED=false` 或配置文件 `errorReportEnabled: false` 关闭；
 * - 同一指纹 60s 内只上报一次，避免 relay 502、worker 轮换等重复错误刷屏；
 * - 上报失败只写 stderr（console.error），**绝不走 logger.error**，否则会递归上报；
 * - 负载只包含错误文本、客户端标识与运行上下文，不含图纸内容或用户数据。
 */
import os from 'os';
import config from './config.js';
import { SERVER_NAME, SERVER_VERSION } from './constants.js';
import { cad } from './cad.js';
import { setErrorNotify } from './logger.js';

const DEFAULT_URL = 'https://atlisp.cn/api/error/report';
const FLUSH_INTERVAL_MS = 2000;
const DEDUPE_WINDOW_MS = 60 * 1000;
const MAX_PENDING = 50;
const MAX_MESSAGE_LEN = 1000;
const MAX_META_LEN = 1000;
const SEND_TIMEOUT_MS = 10000;

/** 未发送的 ERROR（按指纹合并） */
const pending = new Map();
/** 指纹 → 最近一次上报时间 */
const lastSentAt = new Map();
let started = false;
let flushTimer = null;
let flushing = null;

function isEnabled() {
  return config.errorReportEnabled !== false;
}

function reportUrl() {
  return config.errorReportUrl || DEFAULT_URL;
}

/**
 * 生成用于本地去重的错误指纹：抹掉连接 id、数字与耗时等易变部分，
 * 让同一种错误（如不同 worker 的轮换日志）落到同一个键。
 * @param {string} message
 * @returns {string}
 */
export function fingerprintError(message) {
  return String(message)
    .replace(/\[[0-9a-f]{6,}\]/gi, '[id]')
    .replace(/\b\d+(?:\.\d+)?\s*(?:ms|s|MB|KB|GB|%)?\b/gi, '<n>')
    .slice(0, 300);
}

function safeString(value, maxLen) {
  let text;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text === undefined) text = String(value);
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

function buildContext() {
  const mem = process.memoryUsage();
  return {
    uptimeSec: Math.round(process.uptime()),
    pid: process.pid,
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    transport: config.transport,
    toolProfile: config.toolProfile,
    memory: {
      rssMB: Math.round(mem.rss / 1024 / 1024),
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
    },
    cad: {
      connected: !!cad.connected,
      platform: cad.getPlatform?.() || null,
      version: cad.getVersion?.() || null,
    },
  };
}

function scheduleFlush() {
  // 定时器不阻止进程退出（stdio 模式没有 shutdown 钩子）
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    flushErrorReports().catch(() => { /* flush 内部已兜底 */ });
  }, FLUSH_INTERVAL_MS);
  flushTimer.unref?.();
}

/**
 * 记录一条 ERROR 日志（由 logger.error 自动调用，也可手动调用）。
 * @param {string} message
 * @param {unknown} [meta]
 */
export function recordError(message, meta = {}) {
  if (!started || !isEnabled()) return;
  const text = String(message ?? '').trim();
  if (!text) return;

  const fp = fingerprintError(text);
  const now = Date.now();
  const queued = pending.get(fp);
  if (queued) {
    queued.count += 1;
    queued.lastAt = now;
    return;
  }
  if (now - (lastSentAt.get(fp) || 0) < DEDUPE_WINDOW_MS) return;

  if (pending.size >= MAX_PENDING) {
    // 队列满时丢弃最旧的，避免异常风暴把内存撑大
    const oldest = pending.keys().next().value;
    if (oldest !== undefined) pending.delete(oldest);
  }

  pending.set(fp, {
    message: text.slice(0, MAX_MESSAGE_LEN),
    meta: safeString(meta, MAX_META_LEN),
    count: 1,
    firstAt: now,
    lastAt: now,
  });
  scheduleFlush();
}

async function sendOne(event) {
  const payload = {
    // 服务端 /api/error/report 读取 error/source 做聚类，其余字段保留用于后续分析
    error: event.message,
    source: 'atlisp-mcp',
    clientId: config.clientId || os.hostname(),
    server: SERVER_NAME,
    version: SERVER_VERSION,
    timestamp: new Date(event.lastAt).toISOString(),
    occurrences: event.count,
    meta: event.meta,
    context: buildContext(),
  };
  const res = await fetch(reportUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!res.ok) {
    console.error(`[error-report] HTTP ${res.status}`);
  }
}

/**
 * 立即发送当前队列（shutdown 与测试使用）。
 * @returns {Promise<number>} 发送条数
 */
export async function flushErrorReports() {
  if (flushing) return flushing;
  if (!started) return 0;
  const events = Array.from(pending.values());
  pending.clear();
  if (events.length === 0) return 0;

  for (const event of events) lastSentAt.set(fingerprintError(event.message), Date.now());
  pruneSentTimes();

  flushing = (async () => {
    // 并发上限 3：错误风暴时不要把连接池/事件循环压垮
    let index = 0;
    const workers = Array.from({ length: Math.min(3, events.length) }, async () => {
      while (index < events.length) {
        const event = events[index++];
        try {
          await sendOne(event);
        } catch (e) {
          // 绝不能用 logger.error，否则上报失败会再次触发上报
          console.error(`[error-report] 发送失败: ${e.message}`);
        }
      }
    });
    await Promise.all(workers);
    return events.length;
  })();

  try {
    return await flushing;
  } finally {
    flushing = null;
  }
}

function pruneSentTimes() {
  const cutoff = Date.now() - DEDUPE_WINDOW_MS * 2;
  for (const [fp, ts] of lastSentAt) {
    if (ts < cutoff) lastSentAt.delete(fp);
  }
}

/** 启动上报：把 logger.error 接到 recordError，并开始定时 flush。 */
export function startErrorReporter() {
  if (started) return;
  started = true;
  setErrorNotify(recordError);
  scheduleFlush();
}

/** 停止上报：先 flush 再解绑，避免关闭前的最后错误丢失。 */
export async function stopErrorReporter() {
  if (!started) return;
  await flushErrorReports();
  started = false;
  setErrorNotify(null);
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  pending.clear();
}

/** 诊断用：当前待发送数量与去重窗口内已上报的指纹数 */
export function getErrorReporterStats() {
  return { started, enabled: isEnabled(), pending: pending.size, reported: lastSentAt.size };
}
