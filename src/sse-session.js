import { randomUUID } from 'crypto';
import config from './config.js';

const DEFAULT_HEARTBEAT_INTERVAL = config.heartbeatInterval || 30000;
const DEFAULT_RETRY_INTERVAL = 30000;
const MAX_SENT_MESSAGES = 1000;
// 条数上限之外再加一道字节上限：#sentMessages 里存的是完整的 JSON-RPC 响应对象，
// 单条 get_entities/stream_entities 结果可达数 MB，只按条数淘汰等于没有上限。
const MAX_SENT_BYTES = Math.max(1, config.sseReplayMaxBytes || 8 * 1024 * 1024);
// 客户端半开（不再读 socket）时 res.write 永远返回 false，背压缓冲只进不出，
// 必须在超限时断开连接，否则单条 SSE 连接就能吃光整个堆。
const MAX_BACKPRESSURE_BYTES = Math.max(1, config.sseBackpressureMaxBytes || 4 * 1024 * 1024);

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
    #sentBytes = 0;
    #backpressureBuffer = [];
    #backpressureBytes = 0;
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
            let drained = 0;
            for (const item of batch) {
                const ok = this.#res.write(item);
                if (!ok) {
                    this.#backpressureBytes -= drained;
                    this.#backpressureBuffer.unshift(...batch.slice(batch.indexOf(item)));
                    return;
                }
                drained += item.length;
            }
            this.#backpressureBytes -= drained;
            this._flush();
        }
    }

    _enqueueBackpressure(content) {
        if (this.#backpressureBytes + content.length > MAX_BACKPRESSURE_BYTES) {
            // 客户端已经读不走了，继续缓冲只会把进程堆吃光——断开，让它重连。
            this.close();
            return false;
        }
        this.#backpressureBuffer.push(content);
        this.#backpressureBytes += content.length;
        return true;
    }

    _write(content) {
        if (!this.#active) return false;
        try {
            if (this.#backpressureBuffer.length > 0) {
                return this._enqueueBackpressure(content);
            }
            const result = this.#res.write(content);
            if (typeof this.#res.flush === 'function') {
                this.#res.flush();
            }
            if (result === false) {
                return this._enqueueBackpressure(content);
            }
            return true;
        } catch {
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
        } catch {
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
        this.#sentMessages.push({ event, data, id: eventId, timestamp: Date.now(), bytes: formatted.length });
        this.#sentBytes += formatted.length;
        while (this.#sentMessages.length > MAX_SENT_MESSAGES
            || (this.#sentBytes > MAX_SENT_BYTES && this.#sentMessages.length > 1)) {
            this.#sentBytes -= this.#sentMessages.shift().bytes || 0;
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
        this.#backpressureBytes = 0;
        // 会话已终止，重放缓冲（可能几十 MB 的实体查询结果）没有任何读取方了。
        this.#sentMessages = [];
        this.#sentBytes = 0;
        try {
            this.#res.end();
        } catch {
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
        send: (data, _done = false) => {
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
