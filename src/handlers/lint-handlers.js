import { analyzeLispCode } from '../lint-analyzer.js';
import { formatCode } from '@atlisp/lint/dist/formatter.js';
import { lintProject } from '@atlisp/lint/dist/project.js';
import { RULES } from '@atlisp/lint/dist/rules.js';
import { loadConfig } from '@atlisp/lint/dist/config.js';

function getConfig(input) {
  const base = loadConfig();
  if (input?.checks) Object.assign(base.checks, input.checks);
  if (input?.dangerous_calls) Object.assign(base.dangerous_calls, input.dangerous_calls);
  return base;
}

export async function analyzeLispCodeHandler(args) {
  const { code, config } = args || {};
  if (!code || !code.trim()) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ valid: true, issues: [], summary: '代码为空，无需分析' }) }],
    };
  }
  const result = analyzeLispCode(code, { lintConfig: config });
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

export async function formatLispCodeHandler(args) {
  const { code, tabWidth } = args || {};
  if (!code) {
    return { content: [{ type: 'text', text: '需要 code 参数' }], isError: true };
  }
  try {
    const formatted = formatCode(code, { tabWidth: tabWidth || 2 });
    return { content: [{ type: 'text', text: formatted }] };
  } catch (e) {
    return { content: [{ type: 'text', text: `格式化失败: ${e.message}` }], isError: true };
  }
}

export async function listLintRulesHandler() {
  try {
    const list = RULES.map(r => ({
      rule: r.name,
      severity: r.severity || 'warn',
      description: r.description || '',
      fixable: !!r.fix,
    }));
    return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: `获取规则列表失败: ${e.message}` }], isError: true };
  }
}

export async function lintProjectHandler(args) {
  const { directory, config: configInput } = args || {};
  if (!directory) {
    return { content: [{ type: 'text', text: '需要 directory 参数' }], isError: true };
  }
  try {
    const lintConfig = getConfig(configInput);
    const results = await lintProject(directory, lintConfig);
    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: `项目分析失败: ${e.message}` }], isError: true };
  }
}
