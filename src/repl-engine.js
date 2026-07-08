import { randomUUID } from 'crypto';
import { cad } from './cad.js';
import { log, error as logError } from './logger.js';
import { analyzeLispCode } from './lint-analyzer.js';

const sessions = new Map();
const MAX_SESSIONS = 50;
const SESSION_TTL = 30 * 60 * 1000;
const CLEANUP_INTERVAL = 5 * 60 * 1000;

let cleanupTimer = null;

function ensureCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.createdAt > SESSION_TTL) {
        sessions.delete(id);
        log(`REPL session ${id} expired (TTL)`);
      }
    }
  }, CLEANUP_INTERVAL);
  cleanupTimer.unref();
}

const SETQ_RE = /\(setq\s+([a-z][a-z0-9:*\-]+)\s+/gi;

export class ReplSession {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.history = [];
    this.variables = new Map();
    this.context = {};
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
  }

  parseSetq(code, result) {
    let match;
    SETQ_RE.lastIndex = 0;
    while ((match = SETQ_RE.exec(code)) !== null) {
      const varname = match[1];
      this.variables.set(varname, result);
    }
  }

  async execute(code) {
    const analysis = analyzeLispCode(code);
    if (!analysis.valid) {
      throw new Error(`代码存在安全问题:\n${analysis.errors.map(e => `  L${e.line}: [${e.rule}] ${e.message}`).join('\n')}`);
    }
    const rawResult = await cad.sendCommandWithResult(code);
    const entry = {
      code,
      result: rawResult,
      timestamp: Date.now()
    };
    this.history.push(entry);
    this.lastActivity = Date.now();
    this.parseSetq(code, rawResult);
    return rawResult;
  }
}

export function createSession() {
  if (sessions.size >= MAX_SESSIONS) {
    let oldest = null;
    for (const [id, s] of sessions) {
      if (!oldest || s.lastActivity < oldest.lastActivity) oldest = { id, s };
    }
    if (oldest) {
      sessions.delete(oldest.id);
      log(`REPL session ${oldest.id} evicted (max sessions reached)`);
    }
  }
  ensureCleanup();
  const sessionId = randomUUID();
  const session = new ReplSession(sessionId);
  sessions.set(sessionId, session);
  return sessionId;
}

export function getSession(id) {
  return sessions.get(id) || null;
}

export async function executeInSession(sessionId, code) {
  let session = sessions.get(sessionId);
  if (!session) {
    sessionId = createSession();
    session = sessions.get(sessionId);
  }
  const result = await session.execute(code);
  return { sessionId, result, history: session.history };
}

export function getHistory(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  return session.history;
}

export function listSessions() {
  const result = [];
  for (const [id, session] of sessions) {
    result.push({
      sessionId: id,
      historyCount: session.history.length,
      variables: Object.fromEntries(session.variables),
      createdAt: session.createdAt
    });
  }
  return result;
}

export function closeSession(id) {
  const session = sessions.get(id);
  if (!session) return false;
  sessions.delete(id);
  return true;
}
