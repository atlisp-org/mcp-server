import { randomUUID } from 'crypto';
import { WebSocketServer } from 'ws';
import { getOrCreateSessionServer, removeSessionServer, mcpContext } from './mcp-server-state.js';
import { log, error as logError } from './logger.js';

export function createWebSocketServer(httpServer) {
    const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    wss.on('connection', (ws, req) => {
        const sessionId = randomUUID();
        log(`WebSocket connected: ${sessionId}`);

        ws.on('message', async (raw) => {
            let message;
            try {
                message = JSON.parse(raw.toString());
            } catch {
                ws.send(JSON.stringify({ error: { code: -32700, message: 'Parse error' } }));
                return;
            }

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

            try {
                const { server, transport } = await getOrCreateSessionServer(sessionId);
                transport.resetCleanupTimer();

                await mcpContext.run({ sessionId }, async () => {
                    if (message.method === 'initialize') {
                        server.sendResourceUpdated = () => {};
                        server.sendToolListChanged = () => {};
                    }

                    const response = await transport.handleRequest(message);
                    if (response) {
                        ws.send(JSON.stringify(response));
                    }
                });
            } catch (err) {
                logError(`WebSocket error [${sessionId}]: ${err.message}`);
                if (message.id) {
                    ws.send(JSON.stringify({
                        jsonrpc: '2.0',
                        id: message.id,
                        error: { code: -32603, message: err.message }
                    }));
                }
            }
        });

        ws.on('close', () => {
            log(`WebSocket disconnected: ${sessionId}`);
            removeSessionServer(sessionId);
        });

        ws.on('error', (err) => {
            logError(`WebSocket error [${sessionId}]: ${err.message}`);
            removeSessionServer(sessionId);
        });
    });

    return wss;
}
