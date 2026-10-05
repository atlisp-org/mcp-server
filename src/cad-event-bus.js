import { onDocumentChanged, cad } from './cad.js';
import {  error as logError } from './logger.js';

const subscribers = new Map();

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
    // 连接状态必须按订阅者记录：原来是模块级变量，多个客户端会互相覆盖判断，
    // 而且同 sessionId 重复订阅时旧的 heartbeatTimer 不会被清掉（定时器 + res 泄漏）。
    const state = { wasConnected: cad.connected };

    const prev = subscribers.get(sessionId);
    if (prev) {
        clearInterval(prev.heartbeatTimer);
        try { prev.res.end(); } catch (e) { logError('[cad-event-bus]', e?.message || e); }
    }

    const heartbeatTimer = setInterval(() => {
        const sub = subscribers.get(sessionId);
        if (!sub || sub.heartbeatTimer !== heartbeatTimer) {
            clearInterval(heartbeatTimer);
            return;
        }
        const connected = cad.connected;
        const ts = new Date().toISOString();

        if (connected !== sub.wasConnected) {
            sub.wasConnected = connected;
            broadcastEvent(connected ? 'cadConnected' : 'cadDisconnected', connected
                ? {
                    platform: cad.getPlatform() || 'Unknown',
                    version: cad.getVersion() || 'Unknown',
                    timestamp: ts,
                }
                : { timestamp: ts });
        }

        sendEvent(res, 'heartbeat', { timestamp: ts });
    }, 15000);

    res.on('close', () => {
        clearInterval(heartbeatTimer);
        subscribers.delete(sessionId);
    });

    subscribers.set(sessionId, { res, heartbeatTimer, wasConnected: state.wasConnected, createdAt: Date.now() });
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
