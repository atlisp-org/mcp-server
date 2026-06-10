import { getSingleton } from './sse-session-manager.js';

const sessionManager = getSingleton();
let _notifyFn = null;

export function setNotify(fn) {
    _notifyFn = fn;
}

export function subscribe(uri, sessionId) {
    if (sessionId) {
        return sessionManager.subscribe(sessionId, uri);
    }
    return true;
}

export function unsubscribe(uri, sessionId) {
    if (sessionId) {
        return sessionManager.unsubscribe(sessionId, uri);
    }
    return true;
}

export function list(sessionId) {
    if (sessionId) {
        return sessionManager.getSubscriptions(sessionId);
    }
    return Array.from(sessionManager.getAllSubscribedUris());
}

function matchesSubscription(subscribedUri, targetUri) {
    if (subscribedUri === targetUri) return true;
    if (subscribedUri.endsWith('/') && targetUri.startsWith(subscribedUri)) return true;
    return false;
}

export function isSubscribed(uri, sessionId) {
    if (sessionId) {
        const subs = sessionManager.getSubscriptions(sessionId);
        return subs.some(s => matchesSubscription(s, uri));
    }
    const allUris = sessionManager.getAllSubscribedUris();
    for (const su of allUris) {
        if (matchesSubscription(su, uri)) return true;
    }
    return false;
}

export function notify(uri, data) {
    if (_notifyFn) {
        _notifyFn(uri, data);
    }
}

export function clear() {
    sessionManager.closeAll();
}

export function size() {
    return sessionManager.count();
}

export { sessionManager };
