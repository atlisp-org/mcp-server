import fs from 'fs';
import path from 'path';
import os from 'os';
import config from './config.js';

const DEBUG_FILE = config.debugFile || path.join(os.tmpdir(), 'mcp-server-debug.log');
const MAX_LOG_SIZE = 10 * 1024 * 1024;
const MAX_LOG_FILES = 5;

let stream = null;
// hostname 不会变，缓存一次，避免每条日志都走一次系统调用
const HOSTNAME = os.hostname();

function rotateLog() {
    try {
        if (!fs.existsSync(DEBUG_FILE)) return;
        const stat = fs.statSync(DEBUG_FILE);
        if (stat.size < MAX_LOG_SIZE) return;
        if (stream) { stream.end(); stream = null; }
        for (let i = MAX_LOG_FILES - 1; i > 0; i--) {
            const oldPath = `${DEBUG_FILE}.${i}`;
            if (fs.existsSync(oldPath)) {
                try { fs.renameSync(oldPath, `${DEBUG_FILE}.${i + 1}`); } catch (e) { console.error('log rotate rename error:', e.message); }
            }
        }
        try { fs.renameSync(DEBUG_FILE, `${DEBUG_FILE}.1`); } catch (e) { console.error('log rotate rename error:', e.message); }
    } catch (e) { console.error('log rotate error:', e.message); }
}

function getStream() {
    if (!stream) {
        rotateLog();
        stream = fs.createWriteStream(DEBUG_FILE, { flags: 'a' });
    }
    return stream;
}

function formatMessage(level, message, meta = {}) {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
    };
    // 只有普通对象才展开成字段。字符串/数字/Buffer 直接 spread 会把内容拆成
    // 逐字符/逐字节的键（worker stderr 因此被写成 {"0":"C","1":"o",...}，
    // 单行日志膨胀十几倍，重启风暴时日志一天涨 70MB）。
    const isPlainObject = meta && typeof meta === 'object'
        && !Array.isArray(meta) && !Buffer.isBuffer(meta) && !(meta instanceof Error);
    if (isPlainObject) {
        Object.assign(entry, meta);
    } else if (meta !== undefined && meta !== null && meta !== '') {
        entry.meta = meta instanceof Error ? (meta.stack || meta.message) : meta;
    }
    entry.pid = process.pid;
    entry.hostname = HOSTNAME;
    return JSON.stringify(entry);
}

export function log(message, meta = {}) {
    getStream().write(formatMessage('INFO', message, meta) + '\n');
    notify('info', message);
    if (config.debug) {
        console.log(`[INFO] ${message}`, meta);
    }
}

export function error(message, meta = {}) {
    getStream().write(formatMessage('ERROR', message, meta) + '\n');
    notify('error', message);
    notifyError(message, meta);
    // ERROR 始终输出到终端（stderr），与 debug 开关无关；stdio 模式下 stderr 不污染协议通道
    console.error(`[ERROR] ${message}`, meta);
}

export function warn(message, meta = {}) {
    getStream().write(formatMessage('WARN', message, meta) + '\n');
    notify('warning', message);
    // WARN 始终输出到终端（stderr），与 debug 开关无关
    console.warn(`[WARN] ${message}`, meta);
}

export function debug(message, meta = {}) {
    if (config.debug) {
        getStream().write(formatMessage('DEBUG', message, meta) + '\n');
    }
}

let _logNotify = null;

export function setLoggingNotify(fn) {
  _logNotify = fn;
}

export function getLoggingNotify() {
  return _logNotify;
}

let _errorNotify = null;

/**
 * 注册 ERROR 监听（错误上报用）。与 setLoggingNotify 分开，
 * 避免 MCP 客户端日志通知与上报逻辑互相覆盖。
 * @param {((message: unknown, meta: unknown) => void)|null} fn
 */
export function setErrorNotify(fn) {
  _errorNotify = fn;
}

function notifyError(message, meta) {
  if (!_errorNotify) return;
  try {
    _errorNotify(message, meta);
  } catch (e) {
    // 上报回调自身异常不能影响日志写入，也不能再走 logger.error（会递归）
    console.error('[logger] error notify 回调失败:', e.message);
  }
}

function notify(level, message) {
  if (_logNotify) {
    try { _logNotify(level, message); } catch (e) { console.error('[logger] notify 回调失败:', e.message); }
  }
}

export function closeLog() {
    if (stream) {
        stream.end();
        stream = null;
    }
}

let requestStream = null;
let requestDirReady = false;
const REQUEST_LOG_FILE = path.join(os.homedir(), '@lisp', 'logs', 'requests.log');

function ensureRequestLogDir() {
    if (requestDirReady) return;
    const dir = path.dirname(REQUEST_LOG_FILE);
    if (!fs.existsSync(dir)) {
        try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { console.error('request log mkdir error:', e.message); return; }
    }
    requestDirReady = true;
}

function rotateRequestLog() {
    try {
        if (!fs.existsSync(REQUEST_LOG_FILE)) return;
        const stat = fs.statSync(REQUEST_LOG_FILE);
        if (stat.size < 10 * 1024 * 1024) return;
        if (requestStream) { requestStream.end(); requestStream = null; }
        for (let i = 5; i > 0; i--) {
            const oldPath = `${REQUEST_LOG_FILE}.${i}`;
            if (fs.existsSync(oldPath)) {
                try { fs.renameSync(oldPath, `${REQUEST_LOG_FILE}.${i + 1}`); } catch (e) { console.error('request log rotate error:', e.message); }
            }
        }
        try { fs.renameSync(REQUEST_LOG_FILE, `${REQUEST_LOG_FILE}.1`); } catch (e) { console.error('request log rotate error:', e.message); }
    } catch (e) { console.error('request log rotate error:', e.message); }
}

export function logRequest(req) {
    if (!config.requestLogEnabled) return;
    try {
        ensureRequestLogDir();
        rotateRequestLog();
        if (!requestStream) {
            requestStream = fs.createWriteStream(REQUEST_LOG_FILE, { flags: 'a' });
        }
        const entry = {
            timestamp: new Date().toISOString(),
            method: req.method,
            path: req.path,
            query: req.query,
            ip: req.ip || req.connection?.remoteAddress,
            userAgent: req.get('user-agent'),
        };
        requestStream.write(JSON.stringify(entry) + '\n');
    } catch (e) { console.error('request log error:', e.message); }
}

export function logResponse(req, res, duration) {
    if (!config.requestLogEnabled) return;
    try {
        ensureRequestLogDir();
        if (!requestStream) {
            requestStream = fs.createWriteStream(REQUEST_LOG_FILE, { flags: 'a' });
        }
        const entry = {
            timestamp: new Date().toISOString(),
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            duration: `${duration}ms`,
        };
        requestStream.write(JSON.stringify(entry) + '\n');
    } catch (e) { console.error('request log error:', e.message); }
}