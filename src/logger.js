import fs from 'fs';
import path from 'path';
import os from 'os';
import config from './config.js';

const DEBUG_FILE = config.debugFile || path.join(os.tmpdir(), 'mcp-server-debug.log');
const MAX_LOG_SIZE = 10 * 1024 * 1024;
const MAX_LOG_FILES = 5;

let stream = null;

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
        ...meta,
        pid: process.pid,
        hostname: os.hostname(),
    };
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
const REQUEST_LOG_FILE = path.join(os.homedir(), '@lisp', 'logs', 'requests.log');

function ensureRequestLogDir() {
    const dir = path.dirname(REQUEST_LOG_FILE);
    if (!fs.existsSync(dir)) {
        try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { console.error('request log mkdir error:', e.message); }
    }
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