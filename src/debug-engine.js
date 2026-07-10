import { randomUUID } from 'crypto';
import { cad } from './cad.js';
import { log } from './logger.js';
import { parseLispRecursive } from './handler-utils.js';

async function ensureCad() {
  if (!cad.connected) {
    log('Debug engine: CAD not connected, attempting auto-connect...');
    await cad.connect();
  }
  if (!cad.connected) {
    throw new Error('CAD 未连接');
  }
}

const sessions = new Map();
const MAX_SESSIONS = 10;
const MAX_CHUNKS = 500;

const HELPER_DEFUNS = `
(defun @::dbg/exec-chunk (chunk-code var-names)
  (setq @::dbg/result (eval (read chunk-code)))
  (if var-names
    (setq @::dbg/snapshot
      (mapcar
        (function (lambda (v)
          (list (vl-prin1-to-string v)
                (if (boundp v) (vl-prin1-to-string (eval v)) nil))))
        var-names))
    (setq @::dbg/snapshot nil))
  (list @::dbg/result @::dbg/snapshot))
`;

const CLEANUP_CODE = `
(if (not (vl-catch-all-error-p (vl-catch-all-apply (function (lambda ()
  (mapcar (function (lambda (s) (set s nil)))
    (quote (@::dbg/result @::dbg/snapshot @::dbg/state @::dbg/chunks @::dbg/idx @::dbg/encoding))))))))
  (princ "ok"))
`;

export class DebugSession {
  constructor(sessionId, code, chunks, encoding) {
    this.sessionId = sessionId;
    this.code = code;
    this.chunks = chunks;
    this.totalChunks = chunks.length;
    this.currentIndex = 0;
    this.encoding = encoding || null;
    this.state = 'ready';
    this.lastCheckpoint = null;
    this.finalResult = null;
    this.createdAt = Date.now();
    this.error = null;
  }
}

export async function createSession(code, chunks, encoding) {
  if (sessions.size >= MAX_SESSIONS) {
    let oldest = null;
    for (const [id, s] of sessions) {
      if (!oldest || s.createdAt < oldest.createdAt) oldest = { id, s };
    }
    if (oldest) {
      sessions.delete(oldest.id);
      log(`Debug session ${oldest.id} evicted (max sessions)`);
    }
  }
  if (!chunks || chunks.length === 0) {
    throw new Error('Chunks array is empty');
  }
  if (chunks.length > MAX_CHUNKS) {
    throw new Error(`Too many chunks: ${chunks.length} (max ${MAX_CHUNKS})`);
  }
  for (const chunk of chunks) {
    if (typeof chunk.id !== 'number' || typeof chunk.code !== 'string') {
      throw new Error('Each chunk must have id (number) and code (string)');
    }
  }
  const sessionId = randomUUID();
  const session = new DebugSession(sessionId, code, chunks, encoding);
  sessions.set(sessionId, session);
  return sessionId;
}

export function getSession(id) {
  return sessions.get(id) || null;
}

export async function closeSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  try {
    if (cad.connected) {
      await cad.sendCommand(CLEANUP_CODE + '\n');
    }
  } catch (e) {
    log(`Debug cleanup warning: ${e.message}`);
  }
  sessions.delete(sessionId);
  return true;
}

export function listSessions() {
  const result = [];
  for (const [id, session] of sessions) {
    result.push({
      sessionId: id,
      state: session.state,
      currentIndex: session.currentIndex,
      totalChunks: session.totalChunks,
      createdAt: session.createdAt,
    });
  }
  return result;
}

function escapeLispString(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export async function loadHelpers(session) {
  await ensureCad();
  try {
    await cad.sendCommand(HELPER_DEFUNS + '\n');
  } catch (e) {
    throw new Error(`Failed to load debug helpers: ${e.message}`);
  }
}

export async function fastForward(session) {
  await ensureCad();
  session.state = 'running';
  while (session.currentIndex < session.totalChunks) {
    const chunk = session.chunks[session.currentIndex];
    if (chunk.isBreakpoint) break;
    try {
      await cad.sendCommandWithResult(chunk.code, session.encoding);
    } catch (e) {
      session.state = 'error';
      session.error = `Fast-forward error at chunk ${chunk.id}: ${e.message}`;
      throw new Error(session.error);
    }
    session.currentIndex++;
  }
  if (session.currentIndex >= session.totalChunks) {
    session.state = 'done';
    return {
      done: true,
      finalResult: session.finalResult,
    };
  }
  session.state = 'paused';
  return {
    done: false,
    pausedAt: {
      id: session.chunks[session.currentIndex].id,
      line: session.chunks[session.currentIndex].line,
    },
  };
}

export async function executeStep(session) {
  await ensureCad();
  if (session.state !== 'paused' && session.state !== 'ready') {
    throw new Error(`Invalid state: ${session.state} (expected paused or ready)`);
  }
  if (session.currentIndex >= session.totalChunks) {
    session.state = 'done';
    return { done: true, finalResult: session.finalResult };
  }

  const chunk = session.chunks[session.currentIndex];
  const vars = chunk.vars || [];

  session.state = 'running';

  let rawResult;
  try {
    const varCapture = vars.length > 0
      ? `(mapcar (function (lambda (v) (list (vl-prin1-to-string v) (if (boundp v) (vl-prin1-to-string (eval v)) nil)))) (list ${vars.map(v => `'${v}`).join(' ')})`
      : 'nil';

    const lispCode = `(progn
  (setq @::dbg/result (progn ${chunk.code}))
  (list
    (vl-prin1-to-string @::dbg/result)
    ${varCapture}))`;

    rawResult = await cad.sendCommandWithResult(lispCode, session.encoding);
  } catch (e) {
    session.state = 'error';
    session.error = `Step error at chunk ${chunk.id}: ${e.message}`;
    throw new Error(session.error);
  }

  session.currentIndex++;
  session.finalResult = rawResult;

  let parsedResult = rawResult;
  let variables = [];
  try {
    const parsed = parseLispRecursive(rawResult);
    if (Array.isArray(parsed) && parsed.length >= 2) {
      parsedResult = parsed[0] !== null ? String(parsed[0]) : 'nil';
      if (Array.isArray(parsed[1])) {
        variables = parsed[1].map(item => {
          if (Array.isArray(item) && item.length >= 2) {
            return { name: String(item[0] || ''), value: item[1] !== null ? String(item[1]) : 'nil' };
          }
          return null;
        }).filter(Boolean);
      }
    }
  } catch {
    parsedResult = rawResult || 'nil';
  }

  const checkpoint = {
    id: chunk.id,
    line: chunk.line,
    variables,
    result: parsedResult,
  };
  session.lastCheckpoint = checkpoint;

  if (session.currentIndex >= session.totalChunks) {
    session.state = 'done';
    return {
      done: true,
      checkpoint,
      finalResult: parsedResult,
    };
  }

  session.state = 'paused';
  return { done: false, checkpoint };
}

export async function continueExecution(session) {
  await ensureCad();
  if (session.state !== 'paused' && session.state !== 'ready') {
    throw new Error(`Invalid state: ${session.state} (expected paused or ready)`);
  }

  while (session.currentIndex < session.totalChunks) {
    const chunk = session.chunks[session.currentIndex];

    if (chunk.isBreakpoint) {
      return await executeStep(session);
    }

    try {
      await cad.sendCommandWithResult(chunk.code, session.encoding);
    } catch (e) {
      session.state = 'error';
      session.error = `Continue error at chunk ${chunk.id}: ${e.message}`;
      throw new Error(session.error);
    }
    session.currentIndex++;
    session.finalResult = null;
  }

  session.state = 'done';
  return { done: true, finalResult: session.finalResult };
}

export async function evaluateExpression(session, expression) {
  await ensureCad();
  if (session.state !== 'paused') {
    throw new Error(`Invalid state: ${session.state} (expected paused)`);
  }
  try {
    const result = await cad.sendCommandWithResult(`(vl-prin1-to-string ${expression})`, session.encoding);
    return { value: result || 'nil' };
  } catch (e) {
    return { error: `CAD error: ${e.message}` };
  }
}
