import { log, error as logError } from './logger.js';
import config, { onConfigChange } from './config.js';

export const THREAT_BLOCK = 'block';
export const THREAT_WARN = 'warn';
export const THREAT_ALLOW = 'allow';

export const SECURITY_LEVELS = ['strict', 'standard', 'relaxed'];

const CVT = {
  strict: THREAT_BLOCK,
  standard: THREAT_WARN,
  relaxed: THREAT_ALLOW,
};

function getLevel() {
  const level = config?.securityLevel || 'relaxed';
  return CVT[level] || THREAT_BLOCK;
}

export const SECURITY_RULES = [
  { re: /\bstartapp\s*[(\s]/i, baseSeverity: THREAT_BLOCK, msg: '禁止使用 startapp 函数' },
  { re: /\bvl-bt\b/i, baseSeverity: THREAT_BLOCK, msg: '禁止使用 vl-bt 函数' },
  { re: /\bvlax-import-type-library\b/i, baseSeverity: THREAT_BLOCK, msg: '禁止导入类型库' },
  { re: /\bdos_command_string\s*[(\s]/i, baseSeverity: THREAT_BLOCK, msg: '禁止使用 dos_command_string' },
  { re: /\beval\s*[(\s]/i, baseSeverity: THREAT_BLOCK, msg: '禁止使用 eval 函数' },
  { re: /\bcommand\s*["\s]*[_(]?\s*["']?\.?\s*_?(?:shell|quit|exit|close|open|new|recover|audit|purge|wblock|export)/i, baseSeverity: THREAT_BLOCK, msg: '禁止使用危险 CAD 命令' },
  { re: /\bload\s*[(\s"]/i, baseSeverity: THREAT_BLOCK, msg: 'load 函数可能加载外部代码' },
  { re: /\b(?:read-line|read-char|write-line|write-char)\s*[(\s]/i, baseSeverity: THREAT_BLOCK, msg: '文件 I/O 操作可能影响系统' },
  { re: /\bvl-file-copy\s*[(\s]/i, baseSeverity: THREAT_BLOCK, msg: '禁止文件复制' },
  { re: /\bvl-file-delete\s*[(\s]/i, baseSeverity: THREAT_BLOCK, msg: '禁止文件删除' },
  { re: /\bvl-file-rename\s*[(\s]/i, baseSeverity: THREAT_BLOCK, msg: '禁止文件重命名' },
  { re: /\bvl-registry-write[\s)]/i, baseSeverity: THREAT_BLOCK, msg: 'vl-registry-write 会修改注册表' },
  { re: /\bvl-exit-with-value\b/i, baseSeverity: THREAT_BLOCK, msg: '禁止使用 vl-exit-with-value' },
  { re: /\bvl-exit-with-error\b/i, baseSeverity: THREAT_BLOCK, msg: '禁止使用 vl-exit-with-error' },
  { re: /\bvlax-add-cmd\b/i, baseSeverity: THREAT_BLOCK, msg: '禁止注册新命令' },
  { re: /\bvla-Delete\b/i, baseSeverity: THREAT_BLOCK, msg: '禁止直接删除 vla 对象' },
  { re: /\bvla-Save\s*[(\s]/i, baseSeverity: THREAT_BLOCK, msg: '禁止直接保存文档' },
  { re: /\bdirectory\s*[(\s]/i, baseSeverity: THREAT_ALLOW, msg: '使用 directory 函数' },
  { re: /\bvla-deletefile\b/i, baseSeverity: THREAT_BLOCK, msg: '禁止删除文件' },
  { re: /\bvla-copyfile\b/i, baseSeverity: THREAT_BLOCK, msg: '禁止复制文件' },
  { re: /\bvla-movefile\b/i, baseSeverity: THREAT_BLOCK, msg: '禁止移动文件' },
];

let _cachedLevel = null;

export function refreshConfig() {
  _cachedLevel = null;
}

try {
  onConfigChange(() => { _cachedLevel = null; });
} catch (e) { logError('[lisp-security]', e?.message || e); }

function resolveSeverity(_rule) {
  if (_cachedLevel) return _cachedLevel;
  _cachedLevel = getLevel();
  return _cachedLevel;
}

export function validateLispCodeWorker(code) {
  const clean = stripStringsAndComments(code);
  const effectiveSeverity = resolveSeverity();

  for (const rule of SECURITY_RULES) {
    const re = rule.re;
    if (re.test(clean)) {
      if (effectiveSeverity === THREAT_BLOCK) {
        return { valid: false, error: rule.msg };
      }
      if (effectiveSeverity === THREAT_WARN) {
        log('WARN: ' + rule.msg);
      }
    }
  }
  return { valid: true };
}

export function getEffectiveSeverity() {
  return resolveSeverity();
}

export function stripStringsAndComments(code) {
  const withoutStrings = code.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, '');
  return withoutStrings.replace(/;.*$/gm, '');
}

export function checkParens(code) {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (inString) {
      if (ch === '\\' && i + 1 < code.length) {
        i++;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === ';') {
      while (i < code.length && code[i] !== '\n') i++;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth < 0) return { valid: false, error: '多余右括号 )', pos: i };
  }
  if (depth > 0) return { valid: false, error: `缺少 ${depth} 个右括号 )`, pos: code.length - 1 };
  if (depth < 0) return { valid: false, error: `多余 ${-depth} 个左括号 (` };
  return { valid: true };
}

export const RULES = SECURITY_RULES;

// sessionId 由客户端提供，且这里只在有规则命中时才查询；用 LRU 上限兜住，
// 否则长驻进程会被任意多的会话 ID 撑大（原来纯查询也会新建一个 Set）。
const sessionAllowlist = new Map();
const _maxAllowlistSessions = () => Math.max(1, config.sandboxAllowlistMax || 500);

function _touch(sessionId) {
  const list = sessionAllowlist.get(sessionId);
  if (list) {
    sessionAllowlist.delete(sessionId);
    sessionAllowlist.set(sessionId, list);
  }
  return list;
}

export function getSessionAllowlist(sessionId) {
  const existing = _touch(sessionId);
  if (existing) return existing;
  if (sessionAllowlist.size >= _maxAllowlistSessions()) {
    const oldest = sessionAllowlist.keys().next().value;
    if (oldest !== undefined) sessionAllowlist.delete(oldest);
  }
  const list = new Set();
  sessionAllowlist.set(sessionId, list);
  return list;
}

export function addToAllowlist(sessionId, ruleIndex) {
  const list = getSessionAllowlist(sessionId);
  list.add(ruleIndex);
}

export function removeFromAllowlist(sessionId, ruleIndex) {
  const list = _touch(sessionId);
  if (list) list.delete(ruleIndex);
}

export function clearSessionAllowlist(sessionId) {
  sessionAllowlist.delete(sessionId);
}

export function validateLispCode(code, sessionId = null) {
  const withoutComments = stripStringsAndComments(code);
  const effectiveSeverity = getEffectiveSeverity();

  const results = [];
  let blocked = false;

  for (let i = 0; i < RULES.length; i++) {
    const rule = RULES[i];
    if (rule.re.test(withoutComments)) {
      const isAllowed = !!sessionId && !!_touch(sessionId)?.has(i);

      const severity = effectiveSeverity === THREAT_ALLOW ? THREAT_ALLOW
        : isAllowed ? THREAT_ALLOW
        : effectiveSeverity;

      results.push({
        ruleIndex: i,
        severity,
        message: rule.msg,
        blocked: severity === THREAT_BLOCK,
        warned: severity === THREAT_WARN,
        allowed: severity === THREAT_ALLOW,
      });
      if (severity === THREAT_BLOCK) {
        blocked = true;
      }
    }
  }

  return {
    valid: !blocked,
    blocked,
    results,
    summary: blocked ? `安全限制: ${results.filter(r => r.blocked).map(r => r.message).join('; ')}` : '通过',
  };
}
