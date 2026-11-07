import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _handlerModulesPromise = null;
let _handlerNameMapPromise = null;
const handlerModules = {};
const moduleCache = new Map();
const resolvedCache = new Map();

/* 静态 handler 清单（文件名去掉 -handlers.js）。
 *
 * 为什么需要它：打包后的 dist/atlisp-mcp.js 用 esbuild 的 glob import 把
 * ./handlers/*-handlers.js 内联进来了，但 initHandlerModules() 仍靠
 * fs.readdir(dist/handlers) 来拿文件名。目录不存在时它只打一句
 * 「using static manifest」就 return——handlerModules 是空的，之后**所有**
 * 工具都会返回 `Handler not found: <tool>`（2026-10-24 记忆里的
 * `connect_cad` 就是这个现象，只是最先暴露在连接步骤）。
 *
 * 清单必须与 src/handlers/*-handlers.js 保持一致；tests/unit/handler-loader
 * 会做一致性检查，新增 handler 时忘了改这里会直接测试失败。 */
export const HANDLER_MODULE_NAMES = [
  '3d', 'analysis', 'batch', 'batch-transaction', 'block', 'cad',
  'constraint', 'debug', 'dim-hatch', 'draw', 'dwg-kb', 'edit', 'entity',
  'external', 'file', 'frame', 'function', 'layer', 'library', 'lint', 'meta', 'pattern',
  'package', 'parametric', 'pdf-annotation', 'peer', 'plugin', 'prompt',
  'purge', 'query-print', 'resource', 'sheetset', 'skill', 'spatial',
  'standards', 'style', 'task', 'text', 'ucs-layout', 'viewport', 'xdata', 'xref',
];

/* 把 readdir 的结果和静态清单合并：目录缺文件时静态清单兜底，目录里新增的
   文件也不丢。返回 `*-handlers.js` 文件名列表（去重）。 */
export function handlerFileNames(readNames = []) {
  const files = new Set(
    (Array.isArray(readNames) ? readNames : []).filter((f) => f.endsWith('-handlers.js')),
  );

  for (const name of HANDLER_MODULE_NAMES) files.add(`${name}-handlers.js`);
  return [...files];
}

const FUNCTION_OVERRIDES = {
  set_entity: 'setEntityProperty',
  set_layer: 'setLayerProperty',
  get_dimension: 'getDimensionValue',
  eval_lisp_with_result: 'evalLisp',
};

export function toolNameToFuncName(toolName) {
  if (FUNCTION_OVERRIDES[toolName]) return FUNCTION_OVERRIDES[toolName];
  return toolName.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/* 名字表只建一次，且**并发安全**。
 *
 * 旧实现用布尔标志 `_handlerNameMapInit`：第一个调用者把它置 true 后就去
 * `await initHandlerModules()`，此时第二个调用者（另一个工具的 lazy handler）
 * 直接 return，拿到一个**空的** handlerModules，于是该工具被判成不存在并
 * 永久缓存 null。内存里 1.12.20/ffabc74 的「connect_cad Handler not found，
 * 同机其他工具正常/随后整组失效」就是这个竞态：MCP 启动后第一波并发调用
 * （get_cad_info + connect_cad + get_system_status）必然踩中。
 *
 * 改成共享 Promise：所有并发调用者等同一份初始化完成，没人能提前返回。 */
function buildHandlerNameMap() {
  if (!_handlerNameMapPromise) {
    _handlerNameMapPromise = (async () => {
      await initHandlerModules();
      const modules = Object.keys(handlerModules);
      const mods = await Promise.all(
        modules.map((name) => getHandlerModule(name).then((mod) => ({ name, mod }))),
      );

      for (const { name, mod } of mods) {
        if (!mod) continue;
        for (const key of Object.keys(mod)) {
          if (typeof mod[key] === 'function') {
            resolvedCache.set(key, { moduleName: name, funcName: key });
          }
        }
      }
    })();
  }
  return _handlerNameMapPromise;
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
  /* 不缓存 null：模块加载失败（磁盘/import 抖动）是暂时的，缓存下来会让
     这个工具在进程余下的生命周期里永久报 Handler not found。 */
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
    /* 不缓存失败：一次 import 抖动不该让这个模块永久不可用。 */
    log(`Handler module load failed: ${name} - ${e.message}`);
    return null;
  }
}

/* 初始化只跑一次，但**所有并发调用者必须等到同一份结果**。
   旧实现是 `if (_handlerModulesInit) return; _handlerModulesInit = true;`
   ——第二个调用者在 readdir 还没回来时就返回，handlerModules 还是空的。
   这是「Handler not found」最常见的真实原因，见 buildHandlerNameMap 注释。 */
export function initHandlerModules() {
  if (!_handlerModulesPromise) {
    _handlerModulesPromise = (async () => {
      const handlerDir = path.join(__dirname, 'handlers');
      let names = [];
      try {
        names = await fs.promises.readdir(handlerDir);
      } catch {
        /* 目录不在（单文件部署 / 精简安装）时不能直接 return：bundle 里的
           glob import 仍能解析这些路径，静态清单就是兜底的名字来源。 */
        log('Handler directory not found, using static manifest');
      }
      for (const f of handlerFileNames(names)) {
        const name = f.replace('-handlers.js', '');
        handlerModules[name] = () => import(`./handlers/${name}-handlers.js`);
      }
      watchHandlers();
    })();
  }
  return _handlerModulesPromise;
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
        _handlerNameMapPromise = null;
        _handlerModulesPromise = null;

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


