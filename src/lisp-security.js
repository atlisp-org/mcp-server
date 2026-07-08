import { log, error as logError } from './logger.js';

export const THREAT_BLOCK = 'block';
export const THREAT_WARN = 'warn';
export const THREAT_ALLOW = 'allow';

export const SECURITY_RULES = [
  { re: /\bstartapp\s*[(\s]/i, severity: THREAT_BLOCK, msg: '禁止使用 startapp 函数' },
  { re: /\bvl-bt\b/i, severity: THREAT_BLOCK, msg: '禁止使用 vl-bt 函数' },
  { re: /\bvlax-import-type-library\b/i, severity: THREAT_BLOCK, msg: '禁止导入类型库' },
  { re: /\bdos_command_string\s*[(\s]/i, severity: THREAT_BLOCK, msg: '禁止使用 dos_command_string' },
];

export function stripStringsAndComments(code) {
  const withoutStrings = code.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, '');
  return withoutStrings.replace(/;.*$/gm, '');
}

export function validateLispCodeWorker(code) {
  const clean = stripStringsAndComments(code);
  for (const { re, severity, msg } of SECURITY_RULES) {
    if (re.test(clean)) {
      if (severity === THREAT_BLOCK) {
        return { valid: false, error: msg };
      }
      if (severity === THREAT_WARN) {
        log('WARN: ' + msg);
      }
    }
  }
  return { valid: true };
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
