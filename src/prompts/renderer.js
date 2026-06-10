import { escapeLispString } from '../handler-utils.js';

const PARAM_RE = /\{\{\{([\w.\[\]]+)\}\}\}|\{\{([\w.\[\]]+)\}\}/g;

function resolvePath(obj, path) {
  const parts = path.split(/[.\[\]]/g).filter(Boolean);
  let val = obj;
  for (const p of parts) {
    if (val == null) return undefined;
    val = val[p];
  }
  return val;
}

export function renderTemplate(template, args) {
  return template.replace(PARAM_RE, (match, rawExpr, expr) => {
    const path = rawExpr || expr;
    const val = resolvePath(args, path);
    if (val == null) return '';
    const strVal = String(val);
    if (rawExpr) return strVal;
    return escapeLispString(strVal);
  });
}

export function renderPrompt(promptDef, args = {}) {
  const { name, description, arguments: argDefs = [], templates, handler } = promptDef;

  const renderedArgs = { ...args };
  for (const arg of argDefs) {
    if (arg.default !== undefined && renderedArgs[arg.name] === undefined) {
      renderedArgs[arg.name] = arg.default;
    }
  }

  if (handler) {
    return handler(renderedArgs);
  }

  const action = renderedArgs.action || 'default';
  const template = templates?.[action] || templates?.default;

  if (!template) {
    throw new Error(`Unknown action: ${action} for prompt: ${name}`);
  }

  const code = template.code ? renderTemplate(template.code, renderedArgs) : null;
  const desc = template.description ? renderTemplate(template.description, renderedArgs) : description;

  let text = desc;
  if (code) {
    text += `\n\n\`\`\`lisp\n${code}\n\`\`\`\n\n使用 \`eval_lisp_with_result\` 执行获取结果。`;
  }

  return {
    messages: [{
      role: 'user',
      content: { type: 'text', text }
    }]
  };
}
