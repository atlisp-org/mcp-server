import { randomUUID } from 'crypto';

const SESSION_TIMEOUT = 30 * 60 * 1000;

export class SessionTransport {
  constructor(sessionId) {
    this.sessionId = sessionId || randomUUID();
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;
    this._pendingRequests = new Map();
    this._started = false;
    this._closed = false;
    this._cleanupTimer = null;
  }

  async start() {
    if (this._started) {
      throw new Error('Transport already started');
    }
    this._started = true;
  }

  async send(message) {
    if (this._closed) return;
    const id = message?.id;
    if (id != null && this._pendingRequests.has(id)) {
      const { resolve, timeout } = this._pendingRequests.get(id);
      clearTimeout(timeout);
      this._pendingRequests.delete(id);
      resolve(message);
    }
  }

  async close() {
    if (this._closed) return;
    this._closed = true;
    for (const { reject, timeout } of this._pendingRequests.values()) {
      clearTimeout(timeout);
      reject(new Error('Transport closed'));
    }
    this._pendingRequests.clear();
    this._clearCleanupTimer();
    this.onclose?.();
  }

  async handleRequest(message, timeoutMs = 60000) {
    if (this._closed) {
      throw new Error('Transport closed');
    }

    if (!message || !message.method) {
      throw new Error('Invalid message');
    }

    if (!message.id) {
      this.onmessage?.(message);
      return null;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this._pendingRequests.has(message.id)) {
          this._pendingRequests.delete(message.id);
          reject(new Error('Request timeout'));
        }
      }, timeoutMs);

      this._pendingRequests.set(message.id, { resolve, reject, timeout });
      this.onmessage?.(message);
    });
  }

  resetCleanupTimer() {
    this._clearCleanupTimer();
    this._cleanupTimer = setTimeout(() => {
      this.close();
    }, SESSION_TIMEOUT);
  }

  _clearCleanupTimer() {
    if (this._cleanupTimer) {
      clearTimeout(this._cleanupTimer);
      this._cleanupTimer = null;
    }
  }
}

export default SessionTransport;
