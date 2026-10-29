import edge from 'edge-js';
import path from 'path';
import { fileURLToPath } from 'url';
import { log, error as logError } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.dirname(path.dirname(__filename));

let _rotHelper = null;
// 加载失败后不再重试：edge-js 原生模块/CLR 初始化失败时，每次 edge.func() 都是
// 一次真实的原生调用，重复尝试既刷日志，也让主进程反复暴露在原生崩溃风险下
// （日志里曾出现同一进程 65 次 "edge.initializeClrFunc is not a function"）。
let _rotHelperFailed = false;

function getRotHelper() {
  if (_rotHelper) return _rotHelper;
  if (_rotHelperFailed) return null;
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
