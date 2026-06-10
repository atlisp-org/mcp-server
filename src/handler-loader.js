import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _handlerModulesInit = false;
const handlerModules = {};

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
}

// Naming mismatches: tool_name → actual function export name
// Convention is camelCase (snake_case → camelCase), override when different
const FUNCTION_OVERRIDES = {
  set_entity: 'setEntityProperty',
  set_layer: 'setLayerProperty',
  get_dimension: 'getDimensionValue',
  eval_lisp_with_result: 'evalLisp',
  bring_to_front_entity: 'bringToFront',
  send_to_back_entity: 'sendToBack',
  bring_above_entity: 'bringAbove',
  send_below_entity: 'sendBelow',
};

function toolNameToFuncName(toolName) {
  if (FUNCTION_OVERRIDES[toolName]) return FUNCTION_OVERRIDES[toolName];
  return toolName.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

const moduleCache = new Map();
const resolvedCache = new Map();

async function resolveHandler(toolName) {
  if (resolvedCache.has(toolName)) return resolvedCache.get(toolName);

  await initHandlerModules();
  const funcName = toolNameToFuncName(toolName);

  for (const moduleName of Object.keys(handlerModules)) {
    const mod = await getHandlerModule(moduleName);
    if (mod && typeof mod[funcName] === 'function') {
      const entry = { moduleName, funcName };
      resolvedCache.set(toolName, entry);
      return entry;
    }
  }

  resolvedCache.set(toolName, null);
  return null;
}

export async function getHandlerModule(name) {
  if (moduleCache.has(name)) return moduleCache.get(name);
  await initHandlerModules();
  const loader = handlerModules[name];
  if (!loader) return null;
  const mod = await loader();
  moduleCache.set(name, mod);
  log(`Handler module loaded: ${name}`);
  return mod;
}

export async function getHandler(toolName) {
  const resolved = await resolveHandler(toolName);
  if (!resolved) return null;
  const mod = await getHandlerModule(resolved.moduleName);
  if (!mod || typeof mod[resolved.funcName] !== 'function') return null;
  return mod[resolved.funcName];
}
