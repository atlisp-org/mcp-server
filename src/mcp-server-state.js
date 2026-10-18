import { AsyncLocalStorage } from 'async_hooks';
import { SessionTransport } from './session-transport.js';
import { createMcpServer } from './mcp-handlers.js';
import {  error as logError, log } from './logger.js';
import { tools, handleToolCall } from './mcp-tools.js';
import { setActiveSessions } from './metrics.js';
import config from './config.js';

export const mcpContext = new AsyncLocalStorage();
export const progressContext = new AsyncLocalStorage();

export const sessionServers = new Map();
export const sessionTransports = new Map();

// 每个会话记录最后活跃时间，供空闲清扫使用
const _sessionLastActivity = new Map();

let mcpHandlers = { tools, handleToolCall };
let _stdioServer = null;

// 空闲会话清扫：定期移除长时间无活动的 HTTP 会话，
// 防止 sessionServers/sessionTransports Map 单调增长导致 OOM。
// 默认 30 分钟，与 SessionTransport.SESSION_TIMEOUT 对齐。
const SESSION_IDLE_TTL = config.sessionIdleTtl || 30 * 60 * 1000;
const SESSION_SWEEP_INTERVAL = 5 * 60 * 1000;
let _sweepTimer = null;

function _ensureSweep() {
    if (_sweepTimer) return;
    _sweepTimer = setInterval(() => {
        const now = Date.now();
        for (const [sid, lastAt] of _sessionLastActivity) {
            if (now - lastAt >= SESSION_IDLE_TTL) {
                // SSE 会话由 req.on('close') 自行清理；
                // 这里只清理纯 HTTP POST 会话（无关联 SSE 时才删）
                const entry = sessionServers.get(sid);
                if (entry) {
                    log(`Removing idle MCP session ${sid} (idle ${Math.round((now - lastAt) / 1000)}s)`);
                    removeSessionServer(sid);
                } else {
                    _sessionLastActivity.delete(sid);
                }
            }
        }
    }, SESSION_SWEEP_INTERVAL);
    _sweepTimer.unref();
}

function _touchSession(sessionId) {
    _sessionLastActivity.set(sessionId, Date.now());
    _ensureSweep();
}

export function setMcpHandlers(handlers) {
    mcpHandlers = handlers;
    broadcastToolListChanged();
}

export async function getOrCreateSessionServer(sessionId) {
    let entry = sessionServers.get(sessionId);
    if (!entry) {
        const server = createMcpServer(mcpHandlers);
        const transport = new SessionTransport(sessionId);
        // 关键修复：transport.close() 时同步清理 sessionServers Map，
        // 否则 SessionTransport 的 30 分钟定时器超时后 Server 对象永远泄漏。
        transport.onclose = () => {
            sessionServers.delete(sessionId);
            sessionTransports.delete(sessionId);
            _sessionLastActivity.delete(sessionId);
            setActiveSessions(sessionServers.size);
        };
        server.connect(transport);
        entry = { server, transport };
        sessionServers.set(sessionId, entry);
        sessionTransports.set(sessionId, transport);
        setActiveSessions(sessionServers.size);
    }
    _touchSession(sessionId);
    return entry;
}

export function createStdioServer(handlers) {
    mcpHandlers = handlers;
    _stdioServer = createMcpServer(handlers);
    return _stdioServer;
}

export function removeSessionServer(sessionId) {
    const entry = sessionServers.get(sessionId);
    if (entry) {
        // 先断开 onclose 防止 close() 内部回调再次触发本函数（重入）
        entry.transport.onclose = null;
        entry.transport.close().catch(() => {});
        entry.server.close().catch(() => {});
        sessionServers.delete(sessionId);
        sessionTransports.delete(sessionId);
        _sessionLastActivity.delete(sessionId);
        setActiveSessions(sessionServers.size);
    }
}

/** 标记会话活跃（供 routes.js 在每次请求后调用） */
export function touchSession(sessionId) {
    if (sessionServers.has(sessionId)) {
        _sessionLastActivity.set(sessionId, Date.now());
    }
}

export function broadcastToAllSessions(uri) {
    for (const [sid, entry] of sessionServers) {
        entry.server.sendResourceUpdated({ uri }).catch(err => {
            logError(`Failed to send resource update to session ${sid}: ${err.message}`, { sessionId: sid, uri });
        });
    }
}

function broadcast(server, method, ...args) {
  try {
    return server[method](...args);
  } catch (err) {
    logError(`Failed to broadcast ${method}: ${err.message}`);
  }
}

export function broadcastToolListChanged() {
    for (const [, entry] of sessionServers) {
        broadcast(entry.server, 'sendToolListChanged');
    }
}

export function broadcastResourcesListChanged() {
    for (const [, entry] of sessionServers) {
        broadcast(entry.server, 'sendResourceListChanged');
    }
}

export function broadcastPromptsListChanged() {
    for (const [, entry] of sessionServers) {
        broadcast(entry.server, 'sendPromptListChanged');
    }
}

/**
 * Batch resource updated notifications for multiple URIs.
 * Deduplicates and sends in a single batch.
 */
const _pendingResourceUpdated = new Set();
let _resourceUpdatedTimer = null;

export function scheduleResourceUpdated(uri) {
    _pendingResourceUpdated.add(uri);
    if (!_resourceUpdatedTimer) {
        _resourceUpdatedTimer = setTimeout(() => {
            _resourceUpdatedTimer = null;
            const uris = Array.from(_pendingResourceUpdated);
            _pendingResourceUpdated.clear();
            for (const u of uris) {
                broadcastToAllSessions(u);
            }
        }, 200);
    }
}