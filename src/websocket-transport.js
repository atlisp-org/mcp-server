import { randomUUID } from 'crypto';
import { WebSocketServer } from 'ws';
import { getOrCreateSessionServer, removeSessionServer, mcpContext } from './mcp-server-state.js';
import { log, error as logError } from './logger.js';
import { cad, onDocumentChanged } from './cad.js';
import { SERVER_NAME, SERVER_VERSION, SERVER_CAPABILITIES } from './constants.js';
import { tools } from './tools/index.js';
import { subscribe, unsubscribe } from './subscription-manager.js';

const PING_INTERVAL = 30000;
const CAD_POLL_INTERVAL = 5000;

const connectedClients = new Map();

let _wss = null;
let _cadPollTimer = null;
let _lastCadConnected = null;

export { connectedClients };

export function pushToClient(clientId, event) {
    const ws = connectedClients.get(clientId);
    if (!ws || ws.readyState !== 1) return false;
    try {
        ws.send(JSON.stringify({ jsonrpc: '2.0', method: event.method || 'notification', params: event }));
    } catch (e) {
        logError(`pushToClient failed [${clientId}]: ${e.message}`);
        return false;
    }
    return true;
}

export function broadcast(event) {
    let sent = 0;
    for (const [clientId, ws] of connectedClients) {
        if (ws.readyState !== 1) continue;
        try {
            ws.send(JSON.stringify({ jsonrpc: '2.0', method: event.method || 'notification', params: event }));
            sent++;
        } catch (e) {
            logError(`broadcast failed [${clientId}]: ${e.message}`);
        }
    }
    return sent;
}

export function getConnectedClientCount() {
    return connectedClients.size;
}

export function getConnectedClientIds() {
    return Array.from(connectedClients.keys());
}

function sendWelcome(ws, clientId) {
    try {
        ws.send(JSON.stringify({
            jsonrpc: '2.0',
            method: 'server/welcome',
            params: {
                server: { name: SERVER_NAME, version: SERVER_VERSION },
                capabilities: SERVER_CAPABILITIES,
                clientId,
                toolCount: tools.length,
                cadConnected: cad.connected,
                cadPlatform: cad.connected ? cad.getPlatform() : null,
                cadVersion: cad.connected ? cad.getVersion() : null,
            }
        }));
    } catch (e) {
        logError(`sendWelcome failed [${clientId}]: ${e.message}`);
    }
}

function startPingPong(ws, clientId) {
    let isAlive = true;
    ws._isAlive = true;

    ws.on('pong', () => {
        isAlive = true;
        ws._isAlive = true;
    });

    const interval = setInterval(() => {
        if (ws.readyState !== 1) {
            clearInterval(interval);
            return;
        }
        if (!isAlive) {
            clearInterval(interval);
            log(`WebSocket ping timeout, terminating [${clientId}]`);
            ws.terminate();
            return;
        }
        isAlive = false;
        ws._isAlive = false;
        try { ws.ping(); } catch {}
    }, PING_INTERVAL);

    ws._pingInterval = interval;
}

function stopPingPong(ws) {
    if (ws._pingInterval) {
        clearInterval(ws._pingInterval);
        ws._pingInterval = null;
    }
}

function cleanupClient(ws, clientId) {
    stopPingPong(ws);
    connectedClients.delete(clientId);
    removeSessionServer(clientId);
    log(`WebSocket client removed: ${clientId} (${connectedClients.size} remaining)`);
}

// Exposed for integration: direct handler-based WebSocket request processing.
// Used by the connection handler below; can be reused elsewhere.
export async function handleWebSocketMessage(ws, clientId, message) {
    if (!message || !message.method) {
        if (message.id) {
            ws.send(JSON.stringify({
                jsonrpc: '2.0',
                id: message.id,
                error: { code: -32600, message: 'Invalid Request' }
            }));
        }
        return;
    }

    const startTime = Date.now();

    try {
        // Specific non-MCP methods handled at transport level
        if (message.method === 'ping') {
            ws.send(JSON.stringify({
                jsonrpc: '2.0',
                id: message.id,
                result: { pong: true, timestamp: Date.now() }
            }));
            return;
        }

        if (message.method === 'subscribe/cad') {
            const result = subscribe('atlisp://cad/state', clientId);
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
            return;
        }

        if (message.method === 'unsubscribe/cad') {
            const result = unsubscribe('atlisp://cad/state', clientId);
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
            return;
        }

        // Delegate to MCP session transport infrastructure
        const { server, transport } = await getOrCreateSessionServer(clientId);
        transport.resetCleanupTimer();

        const response = await mcpContext.run({ sessionId: clientId }, async () => {
            if (message.method === 'initialize') {
                server.sendResourceUpdated = () => {};
                server.sendToolListChanged = () => {};
            }
            return transport.handleRequest(message);
        });

        if (response) {
            ws.send(JSON.stringify(response));
        }

        const elapsed = Date.now() - startTime;
        if (elapsed > 1000) {
            log(`Slow WebSocket request [${clientId}]: ${message.method} (${elapsed}ms)`);
        }
    } catch (err) {
        logError(`WebSocket message error [${clientId}]: ${message.method} - ${err.message}`);
        if (message.id) {
            ws.send(JSON.stringify({
                jsonrpc: '2.0',
                id: message.id,
                error: { code: -32603, message: err.message }
            }));
        }
    }
}

// Poll CAD connection state and broadcast changes
function startCadPolling() {
    _lastCadConnected = cad.connected;

    _cadPollTimer = setInterval(() => {
        const currentConnected = cad.connected;
        if (currentConnected !== _lastCadConnected) {
            _lastCadConnected = currentConnected;
            if (currentConnected) {
                const platform = cad.getPlatform();
                const version = cad.getVersion();
                log(`CAD connected: ${platform} ${version}, broadcasting to ${connectedClients.size} WS clients`);
                broadcast({
                    method: 'cadConnected',
                    event: 'cadConnected',
                    platform,
                    version,
                    timestamp: Date.now()
                });
            } else {
                log(`CAD disconnected, broadcasting to ${connectedClients.size} WS clients`);
                broadcast({
                    method: 'cadDisconnected',
                    event: 'cadDisconnected',
                    timestamp: Date.now()
                });
            }
        }
    }, CAD_POLL_INTERVAL);
}

function stopCadPolling() {
    if (_cadPollTimer) {
        clearInterval(_cadPollTimer);
        _cadPollTimer = null;
    }
}

// Set up document change listener once
let _docChangeListenerRegistered = false;

function setupDocumentChangeListener() {
    if (_docChangeListenerRegistered) return;
    _docChangeListenerRegistered = true;

    onDocumentChanged((info) => {
        log(`Document changed: ${info.docName || info.docPath}, broadcasting to ${connectedClients.size} WS clients`);
        broadcast({
            method: 'documentChanged',
            event: 'documentChanged',
            docName: info.docName || '',
            docPath: info.docPath || '',
            timestamp: Date.now()
        });
    });
}

export function createWebSocketServer(httpServer) {
    if (_wss) {
        log('WebSocket server already exists, reusing');
        return _wss;
    }

    setupDocumentChangeListener();
    startCadPolling();

    _wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    _wss.on('connection', (ws, req) => {
        const clientId = randomUUID();
        connectedClients.set(clientId, ws);
        log(`WebSocket connected: ${clientId} (${connectedClients.size} total) from ${req.socket.remoteAddress}`);

        sendWelcome(ws, clientId);
        startPingPong(ws, clientId);

        // Pre-create session to speed up first tool call
        getOrCreateSessionServer(clientId).catch(() => {});

        ws.on('message', async (raw) => {
            let message;
            try {
                const text = typeof raw === 'string' ? raw : raw.toString();
                message = JSON.parse(text);
            } catch {
                ws.send(JSON.stringify({
                    jsonrpc: '2.0',
                    id: null,
                    error: { code: -32700, message: 'Parse error' }
                }));
                return;
            }

            // Handle batch requests (array)
            if (Array.isArray(message)) {
                const results = [];
                for (const single of message) {
                    if (!single || !single.method) {
                        results.push({
                            jsonrpc: '2.0',
                            id: single?.id || null,
                            error: { code: -32600, message: 'Invalid Request' }
                        });
                        continue;
                    }
                    try {
                        const { server, transport } = await getOrCreateSessionServer(clientId);
                        transport.resetCleanupTimer();
                        const response = await mcpContext.run({ sessionId: clientId }, async () => {
                            if (single.method === 'initialize') {
                                server.sendResourceUpdated = () => {};
                                server.sendToolListChanged = () => {};
                            }
                            return transport.handleRequest(single);
                        });
                        if (response !== undefined) results.push(response);
                    } catch (err) {
                        logError(`Batch WS error [${clientId}]: ${single.method} - ${err.message}`);
                        results.push({
                            jsonrpc: '2.0',
                            id: single.id || null,
                            error: { code: -32603, message: err.message }
                        });
                    }
                }
                ws.send(JSON.stringify(results));
                return;
            }

            await handleWebSocketMessage(ws, clientId, message);
        });

        ws.on('close', (code, reason) => {
            log(`WebSocket disconnected: ${clientId} code=${code} reason=${reason || 'none'}`);
            cleanupClient(ws, clientId);
        });

        ws.on('error', (err) => {
            logError(`WebSocket error [${clientId}]: ${err.message}`);
            cleanupClient(ws, clientId);
        });
    });

    _wss.on('error', (err) => {
        logError(`WebSocket server error: ${err.message}`);
    });

    _wss.on('close', () => {
        log('WebSocket server closed');
        stopCadPolling();
        for (const [clientId, ws] of connectedClients) {
            cleanupClient(ws, clientId);
        }
        _wss = null;
    });

    log(`WebSocket server created on path /ws`);
    return _wss;
}

export function closeWebSocketServer() {
    stopCadPolling();
    if (_wss) {
        for (const [clientId, ws] of connectedClients) {
            stopPingPong(ws);
            try { ws.close(1001, 'Server shutting down'); } catch {}
        }
        connectedClients.clear();
        _wss.close(() => {
            log('WebSocket server closed gracefully');
        });
        _wss = null;
    }
}
