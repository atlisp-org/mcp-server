import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _handlerModulesInit = false;
let _handlerNameMapInit = false;
const handlerModules = {};
const moduleCache = new Map();
const resolvedCache = new Map();

const FUNCTION_OVERRIDES = {
  set_entity: 'setEntityProperty',
  set_layer: 'setLayerProperty',
  get_dimension: 'getDimensionValue',
  eval_lisp_with_result: 'evalLisp',
};

function toolNameToFuncName(toolName) {
  if (FUNCTION_OVERRIDES[toolName]) return FUNCTION_OVERRIDES[toolName];
  return toolName.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

async function buildHandlerNameMap() {
  if (_handlerNameMapInit) return;
  _handlerNameMapInit = true;
  await initHandlerModules();
  const modules = Object.keys(handlerModules);
  const mods = await Promise.all(modules.map(name => getHandlerModule(name).then(mod => ({ name, mod }))));
  for (const { name, mod } of mods) {
    if (!mod) continue;
    for (const key of Object.keys(mod)) {
      if (typeof mod[key] === 'function') {
        const entry = { moduleName: name, funcName: key };
        resolvedCache.set(key, entry);
      }
    }
  }
}

async function resolveHandler(toolName) {
  if (resolvedCache.has(toolName)) return resolvedCache.get(toolName);

  await initHandlerModules();
  const funcName = toolNameToFuncName(toolName);

  if (!resolvedCache.has(funcName)) {
    await buildHandlerNameMap();
  }

  const entry = resolvedCache.get(funcName);
  if (entry) {
    resolvedCache.set(toolName, entry);
    return entry;
  }

  resolvedCache.set(toolName, null);
  return null;
}

export async function getHandlerModule(name) {
  if (moduleCache.has(name)) return moduleCache.get(name);
  await initHandlerModules();
  const loader = handlerModules[name];
  if (!loader) return null;
  try {
    const mod = await loader();
    moduleCache.set(name, mod);
    log(`Handler module loaded: ${name}`);
    return mod;
  } catch (e) {
    log(`Handler module load failed: ${name} - ${e.message}`);
    moduleCache.set(name, null);
    return null;
  }
}

export async function initHandlerModules() {
  if (_handlerModulesInit) return;
  _handlerModulesInit = true;
  const handlerDir = path.join(__dirname, 'handlers');
  let names;
  try {
    names = await fs.promises.readdir(handlerDir);
  } catch {
    log('Handler directory not found, using static manifest');
    return;
  }
  for (const f of names) {
    if (f.endsWith('-handlers.js')) {
      const name = f.replace('-handlers.js', '');
      handlerModules[name] = () => import(`./handlers/${name}-handlers.js`);
    }
  }
  watchHandlers();
}

export async function getHandler(toolName) {
  const resolved = await resolveHandler(toolName);
  if (!resolved) return null;
  const mod = await getHandlerModule(resolved.moduleName);
  if (!mod || typeof mod[resolved.funcName] !== 'function') return null;
  return mod[resolved.funcName];
}

// === Hot Reload ===

let _watcherInitialized = false;

export function watchHandlers() {
  if (_watcherInitialized) return;
  _watcherInitialized = true;

  const handlerDir = path.join(__dirname, 'handlers');
  let debounceTimer = null;

  try {
    if (!fs.existsSync(handlerDir)) return;
    fs.watch(handlerDir, (eventType, filename) => {
      if (!filename || !filename.endsWith('-handlers.js')) return;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        const name = filename.replace('-handlers.js', '');
        moduleCache.delete(name);
        resolvedCache.clear();
        _handlerNameMapInit = false;
        _handlerModulesInit = false;

        try {
          await initHandlerModules();
          log(`Handler hot-reloaded: ${filename}`);
        } catch (e) {
          log(`Handler reload failed for ${filename}: ${e.message}`);
        }
      }, 300);
    });
  } catch (e) {
    log(`Handler watch error: ${e.message}`);
  }
}


