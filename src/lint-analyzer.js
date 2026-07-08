import { readFileSync } from 'fs';
import { URL } from 'url';
import { runChecks } from '@atlisp/lint/dist/runner.js';

const CUSTOM_RULES = [
  { rule: 'command_shell', severity: 'error', re: /\(\s*command\s+"\s*[_.]*\s*shell\s*"/i, msg: '(command "shell" ...) 会启动系统 Shell' },
  { rule: 'vl_registry_write', severity: 'error', re: /\(\s*vl-registry-write[\s\)]/i, msg: 'vl-registry-write 会修改 Windows 注册表' },
  { rule: 'eval_function', severity: 'warn', re: /\beval\s*[(\s]/i, msg: '禁止使用 eval 函数' },
  { rule: 'vl_exit_value', severity: 'warn', re: /\bvl-exit-with-value\b/i, msg: '禁止使用 vl-exit-with-value' },
  { rule: 'vl_exit_error', severity: 'warn', re: /\bvl-exit-with-error\b/i, msg: '禁止使用 vl-exit-with-error' },
  { rule: 'vlax_add_cmd', severity: 'warn', re: /\bvlax-add-cmd\b/i, msg: '禁止注册新命令' },
  { rule: 'vla_delete', severity: 'warn', re: /\bvla-Delete\b/i, msg: '禁止直接删除 vla 对象' },
  { rule: 'vla_save', severity: 'warn', re: /\bvla-Save\b/i, msg: '禁止直接保存文档' },
  { rule: 'directory', severity: 'warn', re: /\bdirectory\s*[(\s]/i, msg: '禁止使用 directory 函数' },
  { rule: 'vla_deletefile', severity: 'warn', re: /\bvla-deletefile\b/i, msg: '禁止删除文件' },
  { rule: 'vla_copyfile', severity: 'warn', re: /\bvla-copyfile\b/i, msg: '禁止复制文件' },
  { rule: 'vla_movefile', severity: 'warn', re: /\bvla-movefile\b/i, msg: '禁止移动文件' },
  { rule: 'vl_file_copy', severity: 'warn', re: /\bvl-file-copy\s*[(\s]/i, msg: '禁止文件复制' },
  { rule: 'vl_file_delete', severity: 'warn', re: /\bvl-file-delete\s*[(\s]/i, msg: '禁止文件删除' },
  { rule: 'vl_file_rename', severity: 'warn', re: /\bvl-file-rename\s*[(\s]/i, msg: '禁止文件重命名' },
  { rule: 'load_function', severity: 'warn', re: /\bload\s*[(\s"]/i, msg: 'load 函数可能加载外部代码' },
  { rule: 'command_dangerous', severity: 'warn', re: /\bcommand\s*["\s]*[_(]?\s*["']?\.?\s*_?(?:quit|exit|close|open|new|recover|audit|purge|wblock|export)/i, msg: '禁止使用危险 CAD 命令' },
  { rule: 'file_io', severity: 'warn', re: /\b(?:read-line|read-char|write-line|write-char)\s*[(\s]/i, msg: '文件 I/O 操作可能影响系统' },
];

let defaultConfig;

const REQUIRED_ERROR_CHECKS = {
  parens: 'error',
  quit_exit: 'error',
  quit: 'error',
  exit: 'error',
  startapp: 'error',
  shadow_builtin: 'error',
  extra_parens: 'error',
  builtin_arg_count: 'error',
};

function getDefaultConfig() {
  if (!defaultConfig) {
    try {
      if (process.env.LINT_CONFIG_PATH) {
        const userConfig = JSON.parse(readFileSync(process.env.LINT_CONFIG_PATH, 'utf-8'));
        defaultConfig = userConfig;
        return defaultConfig;
      }
      const url = new URL('../node_modules/@atlisp/lint/dist/atlisp-lint.default.json', import.meta.url);
      defaultConfig = JSON.parse(readFileSync(url, 'utf-8'));
      Object.assign(defaultConfig.checks, REQUIRED_ERROR_CHECKS);
    } catch {
      defaultConfig = {
        checks: { ...REQUIRED_ERROR_CHECKS, arg_count: 'warn', unused_variable: 'warn', global_naming: 'warn', line_length: 'off', missing_doc: 'off' },
        dangerous_calls: { quit: 'error', exit: 'error', startapp: 'error', vl_registry_write: 'warn' },
        line_length: { max: 100, tab_width: 2 },
        function_complexity: { max_lines: 60, max_nesting: 6 },
      };
    }
  }
  return defaultConfig;
}

export function analyzeLispCode(code, options = {}) {
  if (process.env.NO_LINT === 'true' && !options.force) {
    return { valid: true, errors: [], warnings: [], issues: [], summary: 'lint 已跳过' };
  }

  try {
    const config = options.lintConfig
      ? mergeConfig(getDefaultConfig(), options.lintConfig)
      : getDefaultConfig();
    const lintIssues = runChecks(code, options.file || '<eval>', config);

    for (const rule of CUSTOM_RULES) {
      const match = code.match(rule.re);
      if (match) {
        const line = code.slice(0, match.index).split('\n').length;
        lintIssues.push({
          file: options.file || '<eval>',
          line,
          severity: rule.severity,
          rule: rule.rule,
          message: rule.msg,
        });
      }
    }

    const errors = lintIssues.filter(i => i.severity === 'error');
    const warnings = lintIssues.filter(i => i.severity === 'warn');

    return {
      valid: errors.length === 0,
      errors: errors.map(i => ({ line: i.line, rule: i.rule, message: i.message })),
      warnings: warnings.map(i => ({ line: i.line, rule: i.rule, message: i.message })),
      issues: errors.map(i => ({ line: i.line, rule: i.rule, message: i.message })),
      summary: errors.length > 0
        ? `发现 ${errors.length} 个错误`
        : warnings.length > 0
          ? `代码分析通过，${warnings.length} 个警告`
          : '代码分析通过',
    };
  } catch (e) {
    return {
      valid: false,
      errors: [{ line: 1, rule: 'lint_error', message: `lint 分析异常: ${e.message}` }],
      warnings: [],
      issues: [{ line: 1, rule: 'lint_error', message: `lint 分析异常: ${e.message}` }],
      summary: `分析异常: ${e.message}`,
    };
  }
}

function mergeConfig(base, overrides) {
  const merged = JSON.parse(JSON.stringify(base));
  if (overrides.checks) Object.assign(merged.checks, overrides.checks);
  if (overrides.dangerous_calls) Object.assign(merged.dangerous_calls, overrides.dangerous_calls);
  if (overrides.line_length) Object.assign(merged.line_length, overrides.line_length);
  if (overrides.function_complexity) Object.assign(merged.function_complexity, overrides.function_complexity);
  return merged;
}
