import config from './config.js';

// sessionId -> Map(key -> value)
const contexts = new Map();
// sessionId -> lastActivity timestamp（供 TTL 清扫）
const _lastActivity = new Map();

const MAX_SESSIONS = () => Math.max(1, config.agentContextMaxSessions || 200);
const SESSION_TTL = () => config.agentContextTtl || 30 * 60 * 1000;
const SWEEP_INTERVAL = 5 * 60 * 1000;

let _sweepTimer = null;

function _ensureSweep() {
  if (_sweepTimer) return;
  _sweepTimer = setInterval(() => {
    const now = Date.now();
    const ttl = SESSION_TTL();
    for (const [sid, lastAt] of _lastActivity) {
      if (now - lastAt >= ttl) {
        contexts.delete(sid);
        _lastActivity.delete(sid);
      }
    }
  }, SWEEP_INTERVAL);
  _sweepTimer.unref();
}

function _touch(sessionId) {
  _lastActivity.set(sessionId, Date.now());
  _ensureSweep();
}

function _evictOldest() {
  // 超出上限时驱逐最久未活动的会话
  if (contexts.size < MAX_SESSIONS()) return;
  let oldestSid = null;
  let oldestAt = Infinity;
  for (const [sid, at] of _lastActivity) {
    if (at < oldestAt) {
      oldestAt = at;
      oldestSid = sid;
    }
  }
  if (oldestSid !== null) {
    contexts.delete(oldestSid);
    _lastActivity.delete(oldestSid);
  }
}

export function setContext(sessionId, key, value) {
  if (!contexts.has(sessionId)) {
    _evictOldest();
    contexts.set(sessionId, new Map());
  }
  contexts.get(sessionId).set(key, value);
  _touch(sessionId);
}

export function getContext(sessionId, key) {
  if (!contexts.has(sessionId)) return undefined;
  _touch(sessionId);
  return contexts.get(sessionId).get(key);
}

export function listContext(sessionId) {
  if (!contexts.has(sessionId)) return [];
  _touch(sessionId);
  return Array.from(contexts.get(sessionId).keys());
}

export function deleteContext(sessionId, key) {
  if (!contexts.has(sessionId)) return false;
  const inner = contexts.get(sessionId);
  const result = inner.delete(key);
  // 关键修复：内层 Map 清空后删除外层条目，防止 Map 单调增长
  if (inner.size === 0) {
    contexts.delete(sessionId);
    _lastActivity.delete(sessionId);
  } else {
    _touch(sessionId);
  }
  return result;
}

export function clearContext(sessionId) {
  // 关键修复：直接删除外层条目，而非仅 clear 内层 Map
  contexts.delete(sessionId);
  _lastActivity.delete(sessionId);
}

/** 停止清扫定时器（进程退出时调用） */
export function stopContextSweep() {
  if (_sweepTimer) {
    clearInterval(_sweepTimer);
    _sweepTimer = null;
  }
}
