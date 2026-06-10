import { SseSession, SSE_EVENTS } from './sse-session.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

const SESSION_STORE_DIR = path.join(os.homedir(), '.atlisp', 'sessions');
const SESSION_STORE_TTL = 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 100;
const IDLE_SESSION_TIMEOUT = 30 * 60 * 1000;
const CLEANUP_INTERVAL = 5 * 60 * 1000;

function getSessionStorePath(clientId) {
    return path.join(SESSION_STORE_DIR, `${clientId}.json`);
}

function persistSessionData(clientId, sessionData) {
    try {
        fs.mkdirSync(SESSION_STORE_DIR, { recursive: true });
        const store = {
            clientId,
            sessionData,
            savedAt: Date.now()
        };
        fs.writeFileSync(getSessionStorePath(clientId), JSON.stringify(store), 'utf-8');
    } catch (e) {
        console.error('Failed to persist session:', e.message);
    }
}

function loadPersistedSessionData(clientId) {
    try {
        const filePath = getSessionStorePath(clientId);
        if (!fs.existsSync(filePath)) return null;
        const raw = fs.readFileSync(filePath, 'utf-8');
        const store = JSON.parse(raw);
        if (Date.now() - store.savedAt > SESSION_STORE_TTL) {
            fs.unlinkSync(filePath);
            return null;
        }
        return store.sessionData || {};
    } catch (e) {
        return null;
    }
}

function cleanupStaleSessions() {
    try {
        if (!fs.existsSync(SESSION_STORE_DIR)) return;
        const files = fs.readdirSync(SESSION_STORE_DIR);
        for (const file of files) {
            if (!file.endsWith('.json')) continue;
            const filePath = path.join(SESSION_STORE_DIR, file);
            try {
                const raw = fs.readFileSync(filePath, 'utf-8');
                const store = JSON.parse(raw);
                if (Date.now() - store.savedAt > SESSION_STORE_TTL) {
                    fs.unlinkSync(filePath);
                }
            } catch (e) {
                try { fs.unlinkSync(filePath); } catch (e2) { console.error('Failed to remove corrupt session file:', filePath, e2.message); }
            }
        }
    } catch (e) {
        console.error('Failed to cleanup stale sessions:', e.message);
    }
}

export class SseSessionManager {
    #sessions = new Map();
    #lightweightSessions = new Set();
    #eventHandlers = new Map();
    #accessOrder = [];
    #subscriptionMaps = null;
    #cleanupTimer = null;

    constructor() {
        this.#sessions = new Map();
        this.#lightweightSessions = new Set();
        this.#eventHandlers = new Map();
        this.#accessOrder = [];
        this.#subscriptionMaps = null;
        this._startCleanupTimer();
    }

    _startCleanupTimer() {
        this._stopCleanupTimer();
        this.#cleanupTimer = setInterval(() => {
            this.cleanupIdle();
        }, CLEANUP_INTERVAL);
        this.#cleanupTimer.unref();
    }

    _stopCleanupTimer() {
        if (this.#cleanupTimer) {
            clearInterval(this.#cleanupTimer);
            this.#cleanupTimer = null;
        }
    }

    createSession(clientId) {
        this.#lightweightSessions.add(clientId);
    }

    hasSession(clientId) {
        return this.#sessions.has(clientId) || this.#lightweightSessions.has(clientId);
    }

    removeSession(clientId) {
        return this.#lightweightSessions.delete(clientId);
    }

    _touch(clientId) {
        const idx = this.#accessOrder.indexOf(clientId);
        if (idx !== -1) {
            this.#accessOrder.splice(idx, 1);
        }
        this.#accessOrder.push(clientId);
    }

    _evictLru() {
        while (this.#sessions.size >= MAX_SESSIONS && this.#accessOrder.length > 0) {
            const lruId = this.#accessOrder.shift();
            const session = this.#sessions.get(lruId);
            if (session) {
                persistSessionData(lruId, session.sessionData);
                session.close();
                this.#sessions.delete(lruId);
            }
        }
    }

    add(clientId, session) {
        if (this.#sessions.has(clientId)) {
            this.remove(clientId);
        }
        this._evictLru();
        if (!(session instanceof SseSession)) {
            throw new Error('session must be an SseSession instance');
        }
        const persisted = loadPersistedSessionData(clientId);
        if (persisted) {
            for (const [key, value] of Object.entries(persisted)) {
                session.setSessionData(key, value);
            }
        }
        this.#sessions.set(clientId, session);
        this._touch(clientId);
        session.startHeartbeat();
    }

    remove(clientId) {
        const session = this.#sessions.get(clientId);
        if (session) {
            persistSessionData(clientId, session.sessionData);
            session.close();
            this.#sessions.delete(clientId);
            const idx = this.#accessOrder.indexOf(clientId);
            if (idx !== -1) this.#accessOrder.splice(idx, 1);
            return true;
        }
        return false;
    }

    get(clientId) {
        const session = this.#sessions.get(clientId) || null;
        if (session) {
            this._touch(clientId);
        }
        return session;
    }

    has(clientId) {
        return this.#sessions.has(clientId);
    }

    list() {
        return Array.from(this.#sessions.keys()).map(id => ({
            clientId: id,
            isActive: this.#sessions.get(id)?.isActive ?? false
        }));
    }

    listActive() {
        return this.list().filter(s => s.isActive);
    }

    count() {
        return this.#sessions.size;
    }

    sendToClient(clientId, event, data, id = null) {
        const session = this.#sessions.get(clientId);
        if (!session || !session.isActive) {
            return false;
        }
        return session.sendEvent(event, data, id);
    }

    sendMessageToClient(clientId, data) {
        return this.sendToClient(clientId, SSE_EVENTS.MESSAGE, data);
    }

    sendErrorToClient(clientId, code, message, id = null) {
        return this.sendToClient(clientId, SSE_EVENTS.ERROR, { code, message }, id);
    }

    sendProgressToClient(clientId, current, total, message = '') {
        return this.sendToClient(clientId, SSE_EVENTS.PROGRESS, { current, total, message });
    }

    broadcast(event, data) {
        let successCount = 0;
        for (const [clientId, session] of this.#sessions) {
            if (session.isActive && session.sendEvent(event, data)) {
                successCount++;
            }
        }
        return successCount;
    }

    broadcastMessage(data) {
        return this.broadcast(SSE_EVENTS.MESSAGE, data);
    }

    broadcastError(code, message) {
        return this.broadcast(SSE_EVENTS.ERROR, { code, message });
    }

    on(event, handler) {
        if (!this.#eventHandlers.has(event)) {
            this.#eventHandlers.set(event, new Set());
        }
        this.#eventHandlers.get(event).add(handler);
    }

    off(event, handler) {
        const handlers = this.#eventHandlers.get(event);
        if (handlers) {
            handlers.delete(handler);
        }
    }

    emit(event, data) {
        const handlers = this.#eventHandlers.get(event);
        if (handlers) {
            for (const handler of handlers) {
                try {
                    handler(data);
                } catch (e) {
                    // Ignore handler errors
                }
            }
        }
    }

    cleanupInactive() {
        for (const [clientId, session] of this.#sessions) {
            if (!session.isActive) {
                session.close();
                this.#sessions.delete(clientId);
                const idx = this.#accessOrder.indexOf(clientId);
                if (idx !== -1) this.#accessOrder.splice(idx, 1);
            }
        }
    }

    cleanupIdle() {
        const now = Date.now();
        for (const [clientId, session] of this.#sessions) {
            if (!session.isActive) continue;
            const idle = now - (session.lastActivity || now);
            if (idle > IDLE_SESSION_TIMEOUT) {
                console.error(`Closing idle SSE session ${clientId} (idle ${Math.round(idle / 1000)}s)`);
                persistSessionData(clientId, session.sessionData);
                session.close();
                this.#sessions.delete(clientId);
                const idx = this.#accessOrder.indexOf(clientId);
                if (idx !== -1) this.#accessOrder.splice(idx, 1);
            }
        }
    }

    closeAll() {
        this._stopCleanupTimer();
        for (const [clientId, session] of this.#sessions) {
            persistSessionData(clientId, session.sessionData);
            session.close();
        }
        this.#sessions.clear();
        this.#accessOrder = [];
        this.#lightweightSessions.clear();
        if (this.#subscriptionMaps) this.#subscriptionMaps.clear();
    }

    _ensureSubscriptionMap(clientId) {
        if (!this.#sessions.has(clientId) && !this.#lightweightSessions.has(clientId)) {
            this.#lightweightSessions.add(clientId);
        }
        if (!this.#subscriptionMaps) this.#subscriptionMaps = new Map();
        if (!this.#subscriptionMaps.has(clientId)) {
            this.#subscriptionMaps.set(clientId, new Set());
        }
        return this.#subscriptionMaps.get(clientId);
    }

    subscribe(clientId, uri) {
        const session = this.#sessions.get(clientId);
        if (session) {
            session.addSubscription(uri);
            return true;
        }
        const subs = this._ensureSubscriptionMap(clientId);
        subs.add(uri);
        return true;
    }

    _getSubscriptionSet(clientId) {
        const session = this.#sessions.get(clientId);
        if (session) return session.subscriptions;
        if (this.#subscriptionMaps && this.#subscriptionMaps.has(clientId)) {
            return this.#subscriptionMaps.get(clientId);
        }
        return null;
    }

    unsubscribe(clientId, uri) {
        const subs = this._getSubscriptionSet(clientId);
        if (subs) return subs.delete(uri);
        return false;
    }

    getSubscriptions(clientId) {
        const subs = this._getSubscriptionSet(clientId);
        return subs ? Array.from(subs) : [];
    }

    isSubscribed(clientId, uri) {
        const subs = this._getSubscriptionSet(clientId);
        if (!subs) return false;
        for (const sub of subs) {
            if (sub === uri) return true;
            if (sub.endsWith('/') && uri.startsWith(sub)) return true;
        }
        return false;
    }

    getAllSubscribedUris() {
        const all = new Set();
        for (const session of this.#sessions.values()) {
            for (const uri of session.subscriptions) {
                all.add(uri);
            }
        }
        if (this.#subscriptionMaps) {
            for (const subs of this.#subscriptionMaps.values()) {
                for (const uri of subs) {
                    all.add(uri);
                }
            }
        }
        return all;
    }
}

let _sseSessionManager = null;

export function getSingleton() {
    if (!_sseSessionManager) {
        _sseSessionManager = new SseSessionManager();
    }
    return _sseSessionManager;
}