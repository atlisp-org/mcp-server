import { AsyncLocalStorage } from 'async_hooks';
import { SessionTransport } from './session-transport.js';
import { createMcpServer } from './mcp-handlers.js';
import { log, error as logError } from './logger.js';
import { tools, handleToolCall } from './mcp-tools.js';
import { setActiveSessions } from './metrics.js';

export const mcpContext = new AsyncLocalStorage();
export const progressContext = new AsyncLocalStorage();

export const sessionServers = new Map();
export const sessionTransports = new Map();

let mcpHandlers = { tools, handleToolCall };
let _stdioServer = null;

export function setMcpHandlers(handlers) {
    mcpHandlers = handlers;
    broadcastToolListChanged();
}

export async function getOrCreateSessionServer(sessionId) {
    let entry = sessionServers.get(sessionId);
    if (!entry) {
        const server = createMcpServer(mcpHandlers);
        const transport = new SessionTransport(sessionId);
        server.connect(transport);
        entry = { server, transport };
        sessionServers.set(sessionId, entry);
        sessionTransports.set(sessionId, transport);
        setActiveSessions(sessionServers.size);
    }
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
        entry.transport.close().catch(() => {});
        entry.server.close().catch(() => {});
        sessionServers.delete(sessionId);
        sessionTransports.delete(sessionId);
        setActiveSessions(sessionServers.size);
    }
}

export function broadcastToAllSessions(uri) {
    for (const [sid, entry] of sessionServers) {
        entry.server.sendResourceUpdated({ uri }).catch(err => {
            logError(`Failed to send resource update to session ${sid}: ${err.message}`, { sessionId: sid, uri });
        });
    }
}

function broadcast(method, ...args) {
    for (const [sid, entry] of sessionServers) {
        try {
            entry.server[method](...args);
        } catch (err) {
            logError(`Failed to broadcast ${method} to session ${sid}: ${err.message}`, { sessionId: sid });
        }
    }
}

export function broadcastToolListChanged() {
    for (const [sid, entry] of sessionServers) {
        entry.server.sendToolListChanged().catch(err => {
            logError(`Failed to send tool list changed to session ${sid}: ${err.message}`, { sessionId: sid });
        });
    }
}

export function broadcastResourcesListChanged() {
    broadcast('sendResourceListChanged');
}

export function broadcastPromptsListChanged() {
    broadcast('sendPromptListChanged');
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