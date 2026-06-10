import { log, error as logError } from './logger.js';

export const THREAT_BLOCK = 'block';
export const THREAT_WARN = 'warn';
export const THREAT_ALLOW = 'allow';

export const SECURITY_RULES = [
  { re: /\beval\s*[(\s]/i, severity: THREAT_BLOCK, msg: '禁止使用 eval 函数' },
  { re: /\bstartapp\s*[(\s]/i, severity: THREAT_BLOCK, msg: '禁止使用 startapp 函数' },
  { re: /\bvl-bt\b/i, severity: THREAT_BLOCK, msg: '禁止使用 vl-bt 函数' },
  { re: /\bvl-exit-with-value\b/i, severity: THREAT_BLOCK, msg: '禁止使用 vl-exit-with-value' },
  { re: /\bvl-exit-with-error\b/i, severity: THREAT_BLOCK, msg: '禁止使用 vl-exit-with-error' },
  { re: /\bvlax-import-type-library\b/i, severity: THREAT_BLOCK, msg: '禁止导入类型库' },
  { re: /\bvlax-add-cmd\b/i, severity: THREAT_BLOCK, msg: '禁止注册新命令' },
  { re: /\bvla-Delete\b/i, severity: THREAT_BLOCK, msg: '禁止直接删除 vla 对象' },
  { re: /\bvla-Save\b/i, severity: THREAT_BLOCK, msg: '禁止直接保存文档' },
  { re: /\bdirectory\s*[(\s]/i, severity: THREAT_BLOCK, msg: '禁止使用 directory 函数' },
  { re: /\bvla-deletefile\b/i, severity: THREAT_BLOCK, msg: '禁止删除文件' },
  { re: /\bvla-copyfile\b/i, severity: THREAT_BLOCK, msg: '禁止复制文件' },
  { re: /\bvla-movefile\b/i, severity: THREAT_BLOCK, msg: '禁止移动文件' },
  { re: /\bvl-file-copy\s*[(\s]/i, severity: THREAT_BLOCK, msg: '禁止文件复制' },
  { re: /\bvl-file-delete\s*[(\s]/i, severity: THREAT_BLOCK, msg: '禁止文件删除' },
  { re: /\bvl-file-rename\s*[(\s]/i, severity: THREAT_BLOCK, msg: '禁止文件重命名' },
  { re: /\bdos_command_string\s*[(\s]/i, severity: THREAT_BLOCK, msg: '禁止使用 dos_command_string' },
  { re: /\bload\s*[(\s"]/i, severity: THREAT_WARN, msg: 'load 函数可能加载外部代码' },
  { re: /\bcommand\s*["\s]*[_(]?\s*["']?\.?\s*_?(?:quit|exit|close|open|new|recover|audit|purge|wblock|export)/i, severity: THREAT_BLOCK, msg: '禁止使用危险 CAD 命令' },
  { re: /\b(?:read-line|read-char|write-line|write-char)\s*[(\s]/i, severity: THREAT_WARN, msg: '文件 I/O 操作可能影响系统' },
  { re: /\bvla-add\b/i, severity: THREAT_ALLOW, msg: 'vla-add 创建新对象' },
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
