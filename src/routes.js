import os from 'os';
import v8 from 'v8';
import 'express';
import { randomUUID, createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import iconv from 'iconv-lite';
import config, { reloadConfig } from './config.js';
import { log, error as logError, logRequest, logResponse } from './logger.js';
import { cad } from './cad.js';
import { pool } from './cad-pool.js';
import peerManager from './peer-manager.js';
import { sessionManager } from './subscription-manager.js';

import { mcpContext, getOrCreateSessionServer, removeSessionServer, sessionServers, touchSession } from './mcp-server-state.js';
import { SseSession, parseLastEventId } from './sse-session.js';
import { subscribeEvents, unsubscribeEvents } from './cad-event-bus.js';
import { metrics, trackRequest, trackMcpMethod } from './metrics.js';
import { createRateLimitMiddleware, getRateLimitStatus, resetRateLimit } from './rate-limiter.js';
import { getVisibleTools } from './tools/index.js';
import { getApiKeyRole, canAccess, resolveApiKeyRole } from './auth.js';
import { SERVER_VERSION } from './constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlDir = path.join(__dirname, 'html');

function loadHtml(name, replacements = {}) {
    if (!htmlCache[name]) {
        htmlCache[name] = fs.readFileSync(path.join(htmlDir, `${name}.html`), 'utf-8');
    }
    let html = htmlCache[name];
    for (const [key, value] of Object.entries(replacements)) {
        html = html.replaceAll(`__${key}__`, String(value));
    }
    return html;
}

const htmlCache = {};

let cachedToolsJson = null; let cachedToolsJsonAt = 0;
function getToolsJson() {
    if (cachedToolsJson && Date.now() - cachedToolsJsonAt < 30000) return cachedToolsJson;
    cachedToolsJson = JSON.stringify(getVisibleTools().map(t => ({
        name: t.name, description: t.description, inputSchema: t.inputSchema
    })));
    cachedToolsJsonAt = Date.now();
    return cachedToolsJson;
}

const mcpLimiter = createRateLimitMiddleware();
const pendingMcpRequests = new Map();

const JSON_CONTENT_TYPES = ['application/json', 'application/json-rpc', 'application/vnd.api+json'];

export function createJsonBodyParser() {
    return async (req, res, next) => {
        const ct = (req.headers['content-type'] || '').toLowerCase();
        if (!JSON_CONTENT_TYPES.some(t => ct.startsWith(t))) return next();
        try {
            const chunks = [];
            for await (const chunk of req) {
                chunks.push(chunk);
            }
            const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
            if (totalLength > 10 * 1024 * 1024) {
                throw new Error('Request body too large');
            }
            const buf = Buffer.concat(chunks);
            const m = ct.match(/charset\s*=\s*([^\s;]+)/i);
            let charset = m ? m[1].toLowerCase() : 'utf-8';
            const charsetMap = { 'gb2312': 'gbk', 'gb18030': 'gbk', 'gbk': 'gbk', '936': 'gbk' };
            charset = charsetMap[charset] || charset;
            const str = iconv.decode(buf, charset);
            req.body = JSON.parse(str);
            next();
        } catch (e) {
            res.status(400).json({ error: 'Invalid JSON body', message: e.message });
        }
    };
}

export function createLoggingMiddleware() {
    return (req, res, next) => {
        log(`${req.method} ${req.path}`, { method: req.method, path: req.path, query: req.query });
        next();
    };
}

function extractBearerKey(req) {
    const auth = req.get('Authorization');
    if (!auth) return null;
    return auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth.trim();
}

export function createAuthMiddleware() {
    // 公开端点：仅保留监控与静态文档。管理/调试类端点（/debug、/health/full 等）
    // 必须经过鉴权，避免泄露会话/内存/环境等运行态信息。
    const PUBLIC_PATHS = ['/health', '/metrics', '/api/docs', '/playground', '/go'];
    return (req, res, next) => {
        // Public GET endpoints are unrestricted
        if (req.method === 'OPTIONS' || PUBLIC_PATHS.includes(req.path)) return next();

        const key = extractBearerKey(req);
        const role = resolveApiKeyRole(key, config);
        if (role) {
            req.apiKey = key;
            req.role = role;
            return next();
        }

        return res.status(401).json({ error: 'Unauthorized' });
    };
}

function createAdminMiddleware() {
    return (req, res, next) => {
        if (req.role === 'admin') return next();
        return res.status(403).json({ error: 'Forbidden: admin role required' });
    };
}

function originMatches(pattern, origin) {
    if (pattern === '*') return true;
    if (!origin) return false;
    const getHost = s => s.replace(/^https?:\/\//, '').replace(/:\d+$/, '').toLowerCase();
    const oHost = getHost(origin);
    const pHost = getHost(pattern);
    if (pHost.startsWith('*.')) {
        const suffix = pHost.slice(1);
        return oHost === suffix.slice(1) || oHost.endsWith(suffix);
    }
    return oHost === pHost;
}

export function createCorsMiddleware() {
    return (req, res, next) => {
        if (!config.enableCors) return next();
        const allowedOrigins = (config.corsOrigin || '').split(',').map(s => s.trim()).filter(Boolean);
        const allowAll = allowedOrigins.includes('*');
        const origin = req.headers.origin;
        const isPnaPreflight = req.method === 'OPTIONS' && req.headers['access-control-request-private-network'] === 'true';
        if (allowAll) {
            if (isPnaPreflight && origin) {
                res.setHeader('Access-Control-Allow-Origin', origin);
                res.setHeader('Vary', 'Origin');
            } else {
                res.setHeader('Access-Control-Allow-Origin', config.corsOrigin);
            }
        } else if (origin && allowedOrigins.some(p => originMatches(p, origin))) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
        } else if (!origin) {
            res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0] || '*');
        } else {
            return res.status(403).json({ error: 'Origin not allowed' });
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, CONNECT');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, mcp-session-id, last-event-id');
        res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id, content-type, x-accel-buffering');
        res.setHeader('Access-Control-Max-Age', '86400');
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
        if (req.method === 'OPTIONS') return res.status(204).end();
        next();
    };
}

export function createErrorHandler() {
    return (err, req, res, _next) => {
        logError(`Unhandled error: ${err.message}`, { stack: err.stack, path: req.path });
        res.status(500).json({ error: 'Internal server error', message: err.message });
    };
}

function authorizeRequest(req, toolName) {
    if (req.role) {
        return canAccess(req.role, toolName);
    }
    const role = getApiKeyRole(extractBearerKey(req), config);
    return canAccess(role, toolName);
}

function createRbacMiddleware() {
    return (req, res, next) => {
        // JSON-RPC 批量请求（数组）也要逐个校验，否则 viewer 可用 [{...tools/call...}] 绕过 RBAC
        const bodies = Array.isArray(req.body) ? req.body : [req.body];
        for (const body of bodies) {
            if (body && body.method === 'tools/call' && body.params && body.params.name) {
                const toolName = body.params.name;
                if (!authorizeRequest(req, toolName)) {
                    return res.status(403).json({
                        jsonrpc: '2.0',
                        id: body.id || null,
                        error: { code: -32000, message: 'Forbidden: insufficient permissions' }
                    });
                }
            }
        }
        next();
    };
}

export function setupRoutes(app, { registerMcpRoutes = true } = {}) {
    app.use(createJsonBodyParser());
    app.use(createLoggingMiddleware());
    // CORS 必须在鉴权之前：否则配置了 API Key 时，浏览器预检 OPTIONS 会被 401/403
    // 直接拒绝且不带 CORS 头，跨域请求一步都走不出去。
    app.use(createCorsMiddleware());
    app.use(createAuthMiddleware());

    app.use((req, res, next) => {
        const start = Date.now();
        res.on('finish', () => {
            logRequest(req);
            logResponse(req, res, Date.now() - start);
        });
        trackRequest();
        next();
    });

    app.get('/health', async (req, res) => {
        let cadResponseTime = 0;
        if (cad.connected) {
            const t0 = Date.now();
            try { await cad.ping(); } catch (e) { logError('health ping 失败:', e.message); }
            cadResponseTime = Date.now() - t0;
        }

        const memUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();

        let sseCount = 0;
        try { sseCount = sessionManager?.count?.() || 0; } catch (e) { logError('获取 SSE 会话数失败:', e.message); }
        res.json({
            status: 'ok',
            cad: {
                connected: cad.connected,
                platform: cad.getPlatform ? cad.getPlatform() : null,
                version: cad.getVersion ? cad.getVersion() : null,
                responseTime: cadResponseTime,
                commandQueueSize: cad._getQueueSize ? cad._getQueueSize() : 0,
                restartCount: cad._getRestartCount ? cad._getRestartCount() : 0
            },
            system: {
                uptime: process.uptime(),
                memory: {
                    rss: Math.round(memUsage.rss / 1024 / 1024),
                    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
                    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024)
                },
                cpu: {
                    user: cpuUsage.user,
                    system: cpuUsage.system
                }
            },
            mcp: {
                sessions: sessionServers.size,
                tools: getVisibleTools().length,
                sseSessions: sseCount
            },
            pool: {
                total: pool ? pool.getStats().total : 0,
                active: pool ? pool.getStats().active : null,
                instances: pool ? pool.getStats().instances : [],
            }
        });
    });

    app.get('/go', (req, res) => {
        const remoteUrl = 'https://atlisp.cn/agent';
        const cid = config.clientId || os.hostname();
        res.redirect(302, `${remoteUrl}?clientId=${encodeURIComponent(cid)}`);
    });

    app.get('/health/full', async (req, res) => {
        const memUsage = process.memoryUsage();
        // heapSizeLimit 不在 process.memoryUsage() 里，必须走 v8
        const heapSizeLimit = v8.getHeapStatistics().heap_size_limit;
        const poolStats = pool ? pool.getStats() : {};
        let sseCount = 0;
        try { sseCount = sessionManager?.count?.() || 0; } catch (e) { logError('获取 SSE 会话数失败:', e.message); }
        res.json({
            status: 'ok', timestamp: new Date().toISOString(),
            cad: { connected: cad.connected, platform: cad.getPlatform?.(), version: cad.getVersion?.(), commandQueueSize: cad._getQueueSize ? cad._getQueueSize() : 0, restartCount: cad._getRestartCount ? cad._getRestartCount() : 0 },
            system: {
                uptime: process.uptime(),
                memory: {
                    rssMB: Math.round(memUsage.rss / 1024 / 1024),
                    heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
                    heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
                    externalMB: Math.round(memUsage.external / 1024 / 1024),
                    arrayBuffersMB: Math.round((memUsage.arrayBuffers || 0) / 1024 / 1024),
                    heapLimitMB: Math.round(heapSizeLimit / 1024 / 1024),
                    heapUsedPct: heapSizeLimit
                        ? Number(((memUsage.heapUsed / heapSizeLimit) * 100).toFixed(1))
                        : null,
                },
                cpu: process.cpuUsage(),
            },
            mcp: { sessions: sessionServers.size, tools: getVisibleTools().length, sseSessions: sseCount },
            pool: poolStats,
        });
    });

    if (config.metricsEnabled) {
        app.get('/metrics', (req, res) => {
            res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
            res.send(metrics.getMetrics());
        });
    }

    app.post('/config/reload', createAdminMiddleware(), (req, res) => {
        const success = reloadConfig();
        if (success) {
            log('Configuration reloaded');
            res.json({ status: 'ok', message: 'Configuration reloaded' });
        } else {
            res.status(500).json({ error: 'Failed to reload configuration' });
        }
    });

    app.get('/rate-limit/status', (req, res) => {
        const apiKey = extractBearerKey(req);
        const status = getRateLimitStatus(apiKey);
        res.json({
            limit: status.limit,
            remaining: status.remaining,
            resetIn: Math.ceil(status.resetIn / 1000)
        });
    });

    app.post('/rate-limit/reset', createAdminMiddleware(), (req, res) => {
        const apiKey = extractBearerKey(req);
        resetRateLimit(apiKey);
        res.json({ status: 'ok', message: 'Rate limit reset' });
    });

    app.get('/api/docs', (req, res) => {
        const html = loadHtml('api-docs', {
            VERSION: SERVER_VERSION,
            TOOLS_COUNT: getVisibleTools().length,
        });
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    });

    app.get('/debug', async (req, res) => {
        const memUsage = process.memoryUsage();
        const uptime = process.uptime();
        let cadConnected = false;
        let cadStatusText = 'Disconnected';
        if (cad.connected) {
            cadConnected = true;
            cadStatusText = `Connected - ${cad.getPlatform ? cad.getPlatform() : 'unknown'} ${cad.getVersion ? cad.getVersion() : 'unknown'}`;
        }
        const html = loadHtml('debug', {
            UPTIME_MIN: Math.floor(uptime / 60),
            MEMORY_RSS_MB: Math.round(memUsage.rss / 1024 / 1024),
            HEAP_USED_MB: Math.round(memUsage.heapUsed / 1024 / 1024),
            SESSIONS_COUNT: sessionServers.size,
            CAD_STATUS_CLASS: cadConnected ? 'status-ok' : 'status-error',
            CAD_STATUS_TEXT: cadStatusText,
            TOOLS_COUNT: getVisibleTools().length,
        });
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    });

    app.get('/playground', async (req, res) => {
        const html = loadHtml('playground', {
            TOOLS_JSON: getToolsJson(),
        });
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    });

    if (registerMcpRoutes) {
        // 具体路径必须注册在参数路径之前，否则 /mcp/:path 会先匹配掉 /mcp/stream
        app.get('/mcp/stream', mcpLimiter, createRbacMiddleware(), handleMcpPost);
        app.all('/mcp', mcpLimiter, createRbacMiddleware(), handleMcpPost);
        app.all('/mcp/:path', mcpLimiter, createRbacMiddleware(), handleMcpPost);
    }

    app.get('/sse', mcpLimiter, handleSse);
    app.post('/message', mcpLimiter, createRbacMiddleware(), handleMessage);

    app.get('/cad/events', (req, res) => {
        const sessionId = randomUUID();
        subscribeEvents(sessionId, res);
        req.on('close', () => {
            unsubscribeEvents(sessionId);
        });
    });

    // === Peer Discovery API ===
    app.get('/peers', (req, res) => {
        const stats = peerManager.getStats();
        res.json(stats);
    });

    app.post('/peers/scan', createAdminMiddleware(), async (req, res) => {
        try {
            const found = await peerManager.scanLan(req.body || {});
            res.json({ discovered: found.length, peers: found });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/peers/connect', createAdminMiddleware(), (req, res) => {
        const { host, port, apikey } = req.body || {};
        if (!host) {
            return res.status(400).json({ error: 'host is required' });
        }
        const peer = peerManager.addPeer(host, port || 8110, { apikey });
        res.json({ connected: peer.healthy, peer });
    });

    app.delete('/peers/:id', createAdminMiddleware(), (req, res) => {
        const removed = peerManager.removePeer(req.params.id);
        res.json({ removed });
    });

    app.use(createErrorHandler());

    return app;
}

async function handleMcpPost(req, res) {
    const sessionId = req.headers['mcp-session-id'] || req.query.sessionId || randomUUID();
    sessionManager.createSession(sessionId);
    const body = req.body;
    if (!body) {
        return res.status(400).json({ error: 'Invalid request' });
    }

    if (Array.isArray(body)) {
        const results = [];
        for (const single of body) {
            if (!single || !single.method) {
                results.push({ jsonrpc: '2.0', id: single?.id || null, error: { code: -32600, message: 'Invalid Request' } });
                continue;
            }
            try {
                const result = await getMcpResponse(sessionId, single);
                if (result !== undefined) results.push(result);
            } catch (err) {
                results.push({ jsonrpc: '2.0', id: single.id || null, error: { code: -32603, message: err.message } });
            }
        }
        const headers = { 'Content-Type': 'application/json' };
        res.writeHead(200, headers);
        res.end(JSON.stringify(results));
        return;
    }

    if (!body.method) {
        return res.status(400).json({ error: 'Invalid request' });
    }
    try {
        const result = await getMcpResponse(sessionId, body);
        if (result !== undefined) {
            const headers = { 'Content-Type': 'application/json' };
            res.writeHead(200, headers);
            res.end(JSON.stringify(result));
        } else {
            if (!res.headersSent) res.status(202).end();
        }
    } catch (err) {
        res.status(500).json({ error: 'Internal server error', message: err.message });
    }
}

async function getMcpResponse(sessionId, body) {
    trackMcpMethod(body.method);
    if (body.method === 'tools/call') {
        // 去重键必须包含 sessionId：否则不同会话发出内容相同的调用会共享同一个 promise，
        // 导致跨会话结果串用（对破坏性调用尤其危险）。
        const dedupKey = createHash('sha256').update(`${sessionId}:${JSON.stringify(body)}`).digest('hex');
        let promise = pendingMcpRequests.get(dedupKey);
        if (!promise) {
            promise = (async () => {
                const { transport } = await getOrCreateSessionServer(sessionId);
                transport.resetCleanupTimer();
                touchSession(sessionId);
                return mcpContext.run({ sessionId }, async () => {
                    return transport.handleRequest(body);
                });
            })();
            pendingMcpRequests.set(dedupKey, promise);
            promise.finally(() => pendingMcpRequests.delete(dedupKey)).catch(() => {});
        }
        return promise;
    }

    const { transport } = await getOrCreateSessionServer(sessionId);
    transport.resetCleanupTimer();
    touchSession(sessionId);
    return mcpContext.run({ sessionId }, async () => {
        return transport.handleRequest(body);
    });
}

async function handleSse(req, res) {
    const lastEventId = parseLastEventId(req);
    const sessionId = randomUUID();
    let resumeMessages = [];

    if (lastEventId !== null) {
        // Try to find an existing session with this ID (client reconnecting)
        const existingSession = sessionManager.get(sessionId);
        if (existingSession) {
            resumeMessages = existingSession.getMessagesSince(lastEventId);
            sessionManager.remove(sessionId);
        }
    }

    sessionManager.createSession(sessionId);
    getOrCreateSessionServer(sessionId);

    const sseSession = new SseSession(res, { clientId: sessionId, resumeFromId: lastEventId });
    sessionManager.add(sessionId, sseSession);

    // Replay missed messages
    for (const msg of resumeMessages) {
        sseSession.sendResponse(msg.data, msg.id);
    }

    sseSession.sendEndpoint(`/message?sessionId=${sessionId}`);

    req.on('close', () => {
        sessionManager.remove(sessionId);
        removeSessionServer(sessionId);
    });
}

async function handleMessage(req, res) {
    const sessionId = req.query.sessionId;
    if (!sessionId) {
        return res.status(400).json({ error: 'Missing sessionId' });
    }
    const sseSession = sessionManager.get(sessionId);
    if (!sseSession) {
        return res.status(404).json({ error: 'Session not found' });
    }
    sessionManager.createSession(sessionId);
    const { transport } = await getOrCreateSessionServer(sessionId);
    transport.resetCleanupTimer();

    const body = req.body;
    if (body && typeof body === 'object' && !Array.isArray(body) && body.method) {
        try {
            const response = await transport.handleRequest(body);
            if (response) {
                sseSession.sendResponse(response);
            }
            if (!res.headersSent) {
                res.status(202).end();
            }
        } catch (err) {
            logError(`SSE message error [${sessionId}]: ${err.message}`);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Internal server error' });
            }
        }
    } else {
        res.status(400).json({ error: 'Invalid request' });
    }
}