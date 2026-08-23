import { onDocumentChanged, cad } from './cad.js';
import {  error as logError } from './logger.js';

const subscribers = new Map();
let wasConnected = false;

onDocumentChanged((info) => {
    broadcastEvent('documentChanged', {
        docName: info.docName || '',
        docPath: info.docPath || '',
        timestamp: new Date().toISOString(),
    });
});

export function subscribeEvents(sessionId, res) {
    const headers = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    };
    res.writeHead(200, headers);

    const now = new Date().toISOString();
    if (cad.connected) {
        sendEvent(res, 'cadConnected', {
            platform: cad.getPlatform() || 'Unknown',
            version: cad.getVersion() || 'Unknown',
            timestamp: now,
        });
    }
    wasConnected = cad.connected;

    const heartbeatTimer = setInterval(() => {
        if (!subscribers.has(sessionId)) {
            clearInterval(heartbeatTimer);
            return;
        }
        const connected = cad.connected;
        const ts = new Date().toISOString();

        if (connected !== wasConnected) {
            wasConnected = connected;
            if (connected) {
                broadcastEvent('cadConnected', {
                    platform: cad.getPlatform() || 'Unknown',
                    version: cad.getVersion() || 'Unknown',
                    timestamp: ts,
                });
            } else {
                broadcastEvent('cadDisconnected', { timestamp: ts });
            }
        }

        sendEvent(res, 'heartbeat', { timestamp: ts });
    }, 15000);

    res.on('close', () => {
        clearInterval(heartbeatTimer);
        subscribers.delete(sessionId);
    });

    subscribers.set(sessionId, { res, heartbeatTimer, createdAt: Date.now() });
}

export function unsubscribeEvents(sessionId) {
    const sub = subscribers.get(sessionId);
    if (sub) {
        clearInterval(sub.heartbeatTimer);
        try { sub.res.end(); } catch (e) { logError('[cad-event-bus]', e?.message || e); }
        subscribers.delete(sessionId);
    }
}

export function getEventSubscribers() {
    return Array.from(subscribers.entries()).map(([id, sub]) => ({
        sessionId: id,
        createdAt: new Date(sub.createdAt).toISOString(),
    }));
}

function broadcastEvent(event, data) {
    const formatted = formatSSE(event, data);
    for (const [sessionId, sub] of subscribers) {
        try {
            sub.res.write(formatted);
        } catch {
            clearInterval(sub.heartbeatTimer);
            subscribers.delete(sessionId);
        }
    }
}

function sendEvent(res, event, data) {
    try {
        res.write(formatSSE(event, data));
    } catch (e) { logError('[cad-event-bus]', e?.message || e); }
}

function formatSSE(event, data) {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
