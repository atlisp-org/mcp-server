import { randomUUID } from 'crypto';

const DEFAULT_HEARTBEAT_INTERVAL = 30000;
const DEFAULT_RETRY_INTERVAL = 30000;
const MAX_SENT_MESSAGES = 1000;

export const SSE_EVENTS = {
    MESSAGE: 'message',
    ENDPOINT: 'endpoint',
    PING: 'ping',
    ERROR: 'error',
    PROGRESS: 'progress',
    CAPABILITIES: 'capabilities',
};

export class SseSession {
    #res;
    #clientId;
    #active = true;
    #heartbeatTimer = null;
    #lastEventId = 0;
    #heartbeatInterval;
    #retryInterval;
    #sessionData = {};
    #subscriptions = new Set();
    #sentMessages = [];
    #backpressureBuffer = [];
    #drainHandler = null;
    #lastActivity = Date.now();

    constructor(res, options = {}) {
        this.#res = res;
        this.#clientId = options.clientId || randomUUID();
        this.#heartbeatInterval = options.heartbeatInterval || DEFAULT_HEARTBEAT_INTERVAL;
        this.#retryInterval = options.retryInterval || DEFAULT_RETRY_INTERVAL;
        this.#sessionData = options.sessionData || {};

        if (options.resumeFromId && options.resumeFromId > 0) {
            this.#lastEventId = options.resumeFromId;
        }

        this._setupSseHeaders();
        this._sendRetry();
        this._setupDrain();
    }

    get clientId() {
        return this.#clientId;
    }

    get isActive() {
        return this.#active;
    }

    get lastEventId() {
        return this.#lastEventId;
    }

    get sessionData() {
        return this.#sessionData;
    }

    get lastActivity() {
        return this.#lastActivity;
    }

    updateActivity() {
        this.#lastActivity = Date.now();
    }

    get sentMessages() {
        return [...this.#sentMessages];
    }

    getMessagesSince(eventId) {
        return this.#sentMessages.filter(m => m.id > eventId);
    }

    setSessionData(key, value) {
        this.#sessionData[key] = value;
    }

    getSessionData(key) {
        return this.#sessionData[key];
    }

    get subscriptions() {
        return this.#subscriptions;
    }

    addSubscription(uri) {
        this.#subscriptions.add(uri);
    }

    removeSubscription(uri) {
        return this.#subscriptions.delete(uri);
    }

    hasSubscription(uri) {
        for (const sub of this.#subscriptions) {
            if (sub === uri) return true;
            if (sub.endsWith('/') && uri.startsWith(sub)) return true;
        }
        return false;
    }

    listSubscriptions() {
        return Array.from(this.#subscriptions);
    }

    get retryInterval() {
        return this.#retryInterval;
    }

    setRetryInterval(ms) {
        this.#retryInterval = ms;
    }

    _sendRetry() {
        this._write(`retry: ${this.#retryInterval}\n\n`);
    }

    _setupSseHeaders() {
        this.#res.setHeader('Content-Type', 'text/event-stream');
        this.#res.setHeader('Cache-Control', 'no-cache');
        this.#res.setHeader('Connection', 'keep-alive');
        this.#res.setHeader('Transfer-Encoding', 'chunked');
        this.#res.setHeader('X-Accel-Buffering', 'no');
        if (typeof this.#res.flush !== 'function') {
            this.#res.flush = () => {};
        }
    }

    _formatEvent(event, data, id = null) {
        const lines = [];
        if (id !== null) {
            lines.push(`id: ${id}`);
        }
        lines.push(`event: ${event}`);

        if (data !== null && data !== undefined) {
            const jsonStr = JSON.stringify(data);
            lines.push(`data: ${jsonStr}`);
        } else {
            lines.push('data:');
        }

        return lines.join('\n') + '\n\n';
    }

    _setupDrain() {
        if (typeof this.#res.on !== 'function') return;
        this.#drainHandler = () => {
            if (!this.#active) return;
            if (this.#backpressureBuffer.length > 0) {
                this._drainBuffer();
            }
        };
        this.#res.on('drain', this.#drainHandler);
    }

    _drainBuffer() {
        while (this.#backpressureBuffer.length > 0) {
            const batch = this.#backpressureBuffer.splice(0, 50);
            for (const item of batch) {
                const ok = this.#res.write(item);
                if (!ok) {
                    this.#backpressureBuffer.unshift(...batch.slice(batch.indexOf(item)));
                    return;
                }
            }
            this._flush();
        }
    }

    _write(content) {
        if (!this.#active) return false;
        try {
            if (this.#backpressureBuffer.length > 0) {
                this.#backpressureBuffer.push(content);
                return true;
            }
            const result = this.#res.write(content);
            if (typeof this.#res.flush === 'function') {
                this.#res.flush();
            }
            if (result === false) {
                this.#backpressureBuffer.push(content);
                return true;
            }
            return true;
        } catch (e) {
            this.#active = false;
            this.close();
            return false;
        }
    }

    _flush() {
        try {
            if (typeof this.#res.flush === 'function') {
                this.#res.flush();
            }
        } catch (e) {
            // Ignore flush errors
        }
    }

    flushBackpressure() {
        if (this.#backpressureBuffer.length > 0) {
            this._drainBuffer();
        }
    }

    sendEvent(event, data, id = null) {
        const eventId = id !== null ? id : ++this.#lastEventId;
        this.updateActivity();
        const formatted = this._formatEvent(event, data, eventId);
        this.#sentMessages.push({ event, data, id: eventId, timestamp: Date.now() });
        if (this.#sentMessages.length > MAX_SENT_MESSAGES) {
            this.#sentMessages.splice(0, this.#sentMessages.length - MAX_SENT_MESSAGES);
        }
        this._write(formatted);
        this._flush();
        return true;
    }

    sendMessage(data) {
        return this.sendEvent(SSE_EVENTS.MESSAGE, data);
    }

    sendEndpoint(path) {
        return this.sendEvent(SSE_EVENTS.ENDPOINT, path);
    }

    sendError(code, message, id = null) {
        return this.sendEvent(SSE_EVENTS.ERROR, { code, message }, id);
    }

    sendPing() {
        return this.sendEvent(SSE_EVENTS.PING, { timestamp: Date.now() });
    }

    sendProgress(current, total, message = '') {
        return this.sendEvent(SSE_EVENTS.PROGRESS, { current, total, message });
    }

    sendCapabilities(capabilities) {
        return this.sendEvent(SSE_EVENTS.CAPABILITIES, capabilities);
    }

    sendResponse(jsonrpcResponse, id = null) {
        const eventId = id !== null ? id : this.#lastEventId;
        return this.sendEvent(SSE_EVENTS.MESSAGE, jsonrpcResponse, eventId);
    }

    startHeartbeat(interval = null) {
        this.stopHeartbeat();
        const ms = interval || this.#heartbeatInterval;
        
        this.#heartbeatTimer = setInterval(() => {
            if (!this.#active) {
                this.stopHeartbeat();
                return;
            }
            if (!this.sendPing()) {
                this.stopHeartbeat();
                this.close();
            }
        }, ms);
    }

    stopHeartbeat() {
        if (this.#heartbeatTimer) {
            clearInterval(this.#heartbeatTimer);
            this.#heartbeatTimer = null;
        }
    }

    close() {
        this.#active = false;
        this.updateActivity();
        this.stopHeartbeat();
        if (this.#drainHandler) {
            this.#res.removeListener('drain', this.#drainHandler);
            this.#drainHandler = null;
        }
        this.#backpressureBuffer = [];
        try {
            this.#res.end();
        } catch (e) {
            // Ignore errors during close
        }
    }
}

export function setupSseHeaders(res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Vary', 'Accept');
    if (typeof res.flush !== 'function') {
        res.flush = () => {};
    }
}

let sseGlobalId = 0;

export function sendSSE(res, data, event = SSE_EVENTS.MESSAGE, id = null) {
    const eventId = id !== null ? id : ++sseGlobalId;
    const lines = [
        `id: ${eventId}`,
        `event: ${event}`,
        `data: ${JSON.stringify(data)}`,
        ''
    ];
    res.write(lines.join('\n') + '\n');
    if (typeof res.flush === 'function') res.flush();
}

export function createSseResponseHandler(res, acceptSse = false) {
    if (acceptSse) {
        setupSseHeaders(res);
    }

    return {
        send: (data, done = false) => {
            if (acceptSse) {
                sendSSE(res, data);
            } else {
                const json = JSON.stringify(data);
                res.setHeader('Content-Type', 'application/json');
                res.end(json);
            }
        }
    };
}

export function parseLastEventId(req) {
    const lastEventId = req.get('Last-Event-ID') || req.get('last-event-id');
    if (lastEventId) {
        const parsed = parseInt(lastEventId, 10);
        return isNaN(parsed) ? null : parsed;
    }
    return null;
}
