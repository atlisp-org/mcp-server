import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderPrompt } from './renderer.js';
import {  error as logError } from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* 源码运行（src/prompts/loader.js）与 esbuild 打包运行（dist/atlisp-mcp.js）的目录
   层级不同：打包后 __dirname 直接就是 dist/，`__dirname/definitions` 会指向不存在的
   目录，导致 npm 包/容器里 prompts/list 永远为空。用 __dirname 的目录名判断走哪条路径。 */
const isBundled = path.basename(__dirname) !== 'prompts';
const DEFS_DIR = isBundled
  ? (fs.existsSync(path.join(__dirname, 'prompts', 'definitions'))
    ? path.join(__dirname, 'prompts', 'definitions')
    : path.join(__dirname, 'definitions'))
  : path.join(__dirname, 'definitions');
const PROMPTS_DIR = isBundled
  ? path.join(__dirname, '..', 'prompts')
  : path.join(__dirname, '..', '..', 'prompts');

const CACHE_TTL = 60000;
const cache = new Map();
const MAX_PROMPT_FILE_SIZE = 1024 * 1024;

function safeReadJson(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_PROMPT_FILE_SIZE) {
      logError(`Prompt file too large (${(stat.size / 1024).toFixed(0)}KB): ${filePath}`);
      return null;
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    logError(`Error loading prompt file ${filePath}: ${e.message}`);
    return null;
  }
}

function _getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) return entry.data;
  cache.delete(key);
  return null;
}

function _setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

let builtinDefs = null;

function loadBuiltinDefs() {
  if (builtinDefs) return builtinDefs;
  builtinDefs = {};
  try {
    if (!fs.existsSync(DEFS_DIR)) return builtinDefs;
    const files = fs.readdirSync(DEFS_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const def = safeReadJson(path.join(DEFS_DIR, file));
        if (def && def.name) {
          builtinDefs[def.name] = def;
        }
      } catch (e) { logError(`内置 prompt 加载失败: ${file}: ${e.message}`); }
    }
  } catch (e) {
    logError(`Error reading prompt definitions directory: ${e.message}`);
  }
  return builtinDefs;
}

let externalPrompts = null;
let externalPromptsAt = 0;
const EXTERNAL_PROMPTS_TTL = 30000;

function loadExternalPrompts() {
  const now = Date.now();
  if (externalPrompts && (now - externalPromptsAt) < EXTERNAL_PROMPTS_TTL) {
    return externalPrompts;
  }
  externalPrompts = [];
  try {
    if (!fs.existsSync(PROMPTS_DIR)) {
      fs.mkdirSync(PROMPTS_DIR, { recursive: true });
      return externalPrompts;
    }
    const files = fs.readdirSync(PROMPTS_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const prompt = safeReadJson(path.join(PROMPTS_DIR, file));
        if (prompt && prompt.name) {
          externalPrompts.push(prompt);
        }
      } catch (e) { logError(`外部 prompt 加载失败: ${file}: ${e.message}`); }
    }
  } catch (e) {
    logError(`Error reading external prompts directory: ${e.message}`);
  }
  externalPromptsAt = now;
  return externalPrompts;
}

function findExternalPrompt(name) {
  const ext = loadExternalPrompts();
  return ext.find(p => p.name === name);
}

const handlerCache = new Map();

async function loadHandler(handlerFile) {
  if (handlerCache.has(handlerFile)) return handlerCache.get(handlerFile);
  try {
    // 必须用「字面量目录 + 变量文件名」的模板字符串：esbuild 只有看到这种形式
    // 才会把 ./prompts/handlers/*.js 一起打包。用 path.join(__dirname, ...) 拼路径
    // 时 dist 里没有这些文件，npm 包/容器里 prompts/get 一律报
    // "Failed to load prompt handler"（同 handler-loader.js 的 glob import 约定）。
    const mod = await import(`./handlers/${handlerFile}.js`);
    const fn = mod.default || mod.handler;
    if (typeof fn !== 'function') throw new Error(`Handler ${handlerFile} does not export a function`);
    handlerCache.set(handlerFile, fn);
    return fn;
  } catch (e) {
    throw new Error(`Failed to load prompt handler: ${handlerFile} - ${e.message}`, { cause: e });
  }
}

export async function listPrompts() {
  const defs = loadBuiltinDefs();
  const ext = loadExternalPrompts();
  const extNames = new Set(ext.map(p => p.name));
  const builtin = Object.values(defs).filter(d => !extNames.has(d.name));

  const result = [];
  for (const d of builtin) {
    const args = (d.arguments || []).map(a => {
      const validValues = a.name === 'action' && d.templates ? Object.keys(d.templates) : undefined;
      return { ...a, validValues };
    });
    result.push({ name: d.name, description: d.description, arguments: args });
  }
  for (const p of ext) {
    const args = (p.arguments || []).map(a => {
      const validValues = a.name === 'action' && p.templates ? Object.keys(p.templates) : undefined;
      return { ...a, validValues };
    });
    result.push({ name: p.name, description: p.description, arguments: args });
  }
  return result;
}

export async function getPrompt(name, args = {}) {
  const extPrompt = findExternalPrompt(name);
  if (extPrompt) {
    if (extPrompt.templates) {
      const action = args.action || 'default';
      const template = extPrompt.templates[action] || extPrompt.templates.default;
      if (template) {
        const { renderTemplate } = await import('./renderer.js');
        const code = template.code ? renderTemplate(template.code, args) : null;
        const desc = template.description ? renderTemplate(template.description, args) : (extPrompt.description || '');
        let text = desc;
        if (code) {
          text += `\n\n\`\`\`lisp\n${code}\n\`\`\`\n\n使用 \`eval_lisp_with_result\` 执行获取结果。`;
        }
        return { messages: [{ role: 'user', content: { type: 'text', text } }] };
      }
    }
    return { messages: extPrompt.messages || [] };
  }

  const defs = loadBuiltinDefs();
  const def = defs[name];
  if (!def) throw new Error(`Unknown prompt: ${name}`);

  if (def.handlerFile) {
    const handler = await loadHandler(def.handlerFile);
    return handler(args);
  }

  return renderPrompt(def, args);
}
