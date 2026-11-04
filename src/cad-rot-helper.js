import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { log, error as logError } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.dirname(path.dirname(__filename));

const require = createRequire(import.meta.url);

/* edge-js 只能延迟加载：它只有 Windows（以及 macOS）的原生模块，linux 上
   `require('edge-js')` 直接 throw。本文件被 cad-pool.js → mcp-tools.js 静态引入，
   一旦在模块顶层 import，整个服务器在 Linux 容器里启动即崩溃（Docker e2e 就卡在
   `initialize` 上不返回）。CAD 只可能跑在 Windows，所以非 Windows 平台静默降级为
   「无实例可发现」即可。 */
let _edge = null;
let _edgeLoadFailed = false;

function loadEdge() {
  if (_edge) return _edge;
  if (_edgeLoadFailed) return null;
  try {
    _edge = require('edge-js');
    return _edge;
  } catch (e) {
    _edgeLoadFailed = true;
    log(`edge-js 不可用（${process.platform} ${process.arch}），跳过 CAD 实例发现: ${e.message}`);
    return null;
  }
}

let _rotHelper = null;
// 加载失败后不再重试：edge-js 原生模块/CLR 初始化失败时，每次 edge.func() 都是
// 一次真实的原生调用，重复尝试既刷日志，也让主进程反复暴露在原生崩溃风险下
// （日志里曾出现同一进程 65 次 "edge.initializeClrFunc is not a function"）。
let _rotHelperFailed = false;

function getRotHelper() {
  if (_rotHelper) return _rotHelper;
  if (_rotHelperFailed) return null;
  // ROT（Running Object Table）是 Windows COM 概念，其他平台没有必要尝试
  if (process.platform !== 'win32') {
    _rotHelperFailed = true;
    return null;
  }
  const edge = loadEdge();
  if (!edge) {
    _rotHelperFailed = true;
    return null;
  }
  const dllPath = path.join(projectRoot, 'dist', 'cad-rothelper.dll');
  try {
    _rotHelper = edge.func({
      assemblyFile: dllPath,
      typeName: 'CadRotHelper.RotEnumerator',
      methodName: 'EnumerateAll'
    });
    return _rotHelper;
  } catch (e) {
    logError(`ROT 帮助器加载失败: ${e.message}`);
    _rotHelperFailed = true;
    return null;
  }
}

export async function discoverCadInstances() {
  const helper = getRotHelper();
  if (!helper) {
    log('ROT 帮助器不可用，跳过 CAD 实例发现');
    return [];
  }

  return new Promise((resolve) => {
    helper(null, (err, result) => {
      if (err) {
        logError(`ROT 枚举失败: ${err.message}`);
        resolve([]);
        return;
      }
      if (!Array.isArray(result)) {
        resolve([]);
        return;
      }

      const seen = new Set();
      const instances = [];

      for (const entry of result) {
        if (!entry.appName) continue;
        const pidKey = `${entry.appName}-${entry.pid}`;
        if (seen.has(pidKey)) continue;
        seen.add(pidKey);

        const key = `${entry.appName.toLowerCase()}-${entry.pid}`;
        instances.push({
          key,
          platform: entry.appName,
          pid: entry.pid,
          hwnd: entry.hwnd,
          version: entry.version,
          moniker: entry.name,
        });
      }

      log(`ROT 发现: ${instances.length} 个 CAD 实例 (${instances.map(i => `${i.platform}#${i.pid}`).join(', ')})`);
      resolve(instances);
    });
  });
}
