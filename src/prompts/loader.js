import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { renderPrompt } from './renderer.js';
import { log, error as logError } from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFS_DIR = path.join(__dirname, 'definitions');
const PROMPTS_DIR = path.join(__dirname, '..', '..', 'prompts');

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

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) return entry.data;
  cache.delete(key);
  return null;
}

function setCache(key, data) {
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
      } catch (e) {}
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
      } catch (e) {}
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

const HANDLERS_DIR = path.join(__dirname, 'handlers');
const handlerCache = new Map();

async function loadHandler(handlerFile) {
  if (handlerCache.has(handlerFile)) return handlerCache.get(handlerFile);
  try {
    const mod = await import(path.join(HANDLERS_DIR, handlerFile + '.js'));
    const fn = mod.default || mod.handler;
    if (typeof fn !== 'function') throw new Error(`Handler ${handlerFile} does not export a function`);
    handlerCache.set(handlerFile, fn);
    return fn;
  } catch (e) {
    throw new Error(`Failed to load prompt handler: ${handlerFile} - ${e.message}`);
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
      const merged = { ...extPrompt, action: args.action || 'default' };
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
