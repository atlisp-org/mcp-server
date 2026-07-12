import edge from 'edge-js';
import path from 'path';
import { fileURLToPath } from 'url';
import { log, error as logError } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.dirname(path.dirname(__filename));

let _rotHelper = null;

function getRotHelper() {
  if (_rotHelper) return _rotHelper;
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
