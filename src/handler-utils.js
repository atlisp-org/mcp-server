import { mcpSuccessResponse, createError, ERROR_CODES } from './errors.js';
import { getClientRoots } from './client-roots.js';
import path from 'path';
import fs from 'fs';
import { progressContext } from './mcp-server-state.js';

export function setNotifyProgress(fn) {
  const store = progressContext.getStore();
  if (store) store.notifyProgress = fn;
}

export function getNotifyProgress() {
  const store = progressContext.getStore();
  return store ? store.notifyProgress : null;
}

export function mcpSuccess(text) { return mcpSuccessResponse(text); }

export function mcpError(text) {
  return { content: [{ type: 'text', text: String(text) }], isError: true };
}

export async function ensureCadConnected() {
  const { cad, resolveCadConnection } = await import('./cad.js');
  const conn = resolveCadConnection();
  if (!conn.connected) {
    await conn.connect();
  }
  if (!conn.connected) {
    throw createError(ERROR_CODES.CAD_NOT_CONNECTED);
  }
}

export function withCadConnection(handler) {
  return async function(...args) {
    try {
      const hasInstance = typeof args[args.length - 1] === 'string' && args[args.length - 1].length > 0;
      const instance = hasInstance ? args.pop() : null;
      await ensureCadConnected();
      return await handler(...args, instance);
    } catch (e) {
      if (e.code === ERROR_CODES.CAD_NOT_CONNECTED) {
        return mcpError('CAD 未连接');
      }
      return mcpError(e.message);
    }
  };
}

export function escapeLispString(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function tryNumber(val) {
  if (typeof val === 'number') return val;
  const n = Number(val);
  if (!isNaN(n) && val !== '') return n;
  return val;
}

export function parseLispList(str) {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) return null;
  const content = trimmed.slice(1, -1).trim();
  if (!content) return [];
  const result = [];
  let depth = 0;
  let current = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (escaped) { current += ch; escaped = false; continue; }
    if (ch === '\\') { current += ch; escaped = true; continue; }
    if (ch === '"') { current += ch; inString = !inString; continue; }
    if (inString) { current += ch; continue; }
    if (ch === '(' || ch === '[') { current += ch; depth++; }
    else if (ch === ')' || ch === ']') { current += ch; depth--; }
    else if (ch === ' ' && depth === 0) {
      if (current.trim()) { result.push(current.trim()); current = ''; }
      continue;
    }
    current += ch;
  }
  if (current.trim()) result.push(current.trim());
  return result.map(item => {
    const t = item.trim();
    if (t === 'nil' || t === 'NIL') return null;
    if (t === 't' || t === 'T') return true;
    if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
    return tryNumber(t);
  });
}

export function parseLispRecursive(str) {
  if (!str || typeof str !== 'string') return null;
  str = str.trim();
  if (!str) return null;
  let pos = 0;
  function skipWs() { while (pos < str.length && /\s/.test(str[pos])) pos++; }
  function parseValue() {
    skipWs();
    if (pos >= str.length) return null;
    const ch = str[pos];
    if (ch === '(') return parseList();
    if (ch === '"') return parseString();
    if (ch === '\'') { pos++; return parseValue(); }
    return parseAtom();
  }
  function parseString() {
    pos++;
    let r = '';
    while (pos < str.length && str[pos] !== '"') {
      if (str[pos] === '\\' && pos + 1 < str.length) {
        pos++;
        if (str[pos] === '"') r += '"';
        else if (str[pos] === 'n') r += '\n';
        else if (str[pos] === 't') r += '\t';
        else if (str[pos] === '\\') r += '\\';
        else r += str[pos];
      } else { r += str[pos]; }
      pos++;
    }
    pos++;
    return r;
  }
  function parseAtom() {
    const start = pos;
    while (pos < str.length && !/\s/.test(str[pos]) && str[pos] !== ')' && str[pos] !== '(') pos++;
    const atom = str.slice(start, pos);
    if (atom === 'nil' || atom === 'NIL') return null;
    if (atom === 't' || atom === 'T') return true;
    return tryNumber(atom);
  }
  function parseList() {
    pos++;
    const items = [];
    while (pos < str.length) {
      skipWs();
      if (pos >= str.length) break;
      if (str[pos] === ')') { pos++; return items; }
      const left = parseValue();
      if (left === undefined) break;
      skipWs();
      if (str[pos] === '.' && (pos + 1 >= str.length || /\s/.test(str[pos + 1]) || str[pos + 1] === ')')) {
        pos++; skipWs();
        if (pos < str.length && str[pos] !== ')') {
          const right = parseValue(); skipWs(); pos++;
          return [left, right];
        } else { pos++; return [left]; }
      } else { items.push(left); }
    }
    return items;
  }
  return parseValue();
}

export function lispPairsToObject(pairs) {
  if (!Array.isArray(pairs)) return pairs;
  const obj = {};
  for (let i = 0; i < pairs.length - 1; i += 2) {
    const key = pairs[i];
    const val = pairs[i + 1];
    if (typeof key === 'string' || typeof key === 'number') {
      obj[String(key)] = Array.isArray(val) ? lispPairsToObject(val) : val;
    }
  }
  return obj;
}

export function stripQuotes(str) {
  if (!str) return '';
  const s = String(str).trim();
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}

export function validateFilePath(filePath, options = {}) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('文件路径不能为空');
  }
  const normalized = path.normalize(filePath);
  if (normalized.includes('..')) {
    throw new Error('文件路径不允许包含 ..');
  }
  const roots = getClientRoots().map(r => r.uri).filter(Boolean);
  const allowedDirs = [].concat(options.allowedDirs || [], roots);
  if (allowedDirs.length > 0) {
    const resolved = path.resolve(normalized);
    const allowed = Array.isArray(allowedDirs) ? allowedDirs : [allowedDirs];
    const isAllowed = allowed.some(dir => {
      const resolvedDir = path.resolve(dir);
      return resolved.startsWith(resolvedDir + path.sep) || resolved === resolvedDir;
    });
    if (!isAllowed) {
      throw new Error(`文件路径不在允许的目录中: ${resolved}`);
    }
  }
  if (options.mustExist && !fs.existsSync(normalized)) {
    throw new Error(`文件不存在: ${normalized}`);
  }
  return normalized;
}

export function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
