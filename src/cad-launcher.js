import { execFile, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { CAD_REGISTRY_PATHS, AUTO_LAUNCH_PLATFORMS } from './constants.js';
import { log, error as logError } from './logger.js';

let _registryCache = null;

function getRegistryKey(root, subKey, valueName) {
  try {
    const fullPath = subKey ? `${root}\\${subKey}` : root;
    const result = execSync(
      `reg query "${fullPath}" /v "${valueName}" 2>nul`,
      { encoding: 'utf-8', timeout: 3000 }
    );
    const match = result.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

function listRegistrySubKeys(root) {
  try {
    const result = execSync(
      `reg query "${root}" 2>nul`,
      { encoding: 'utf-8', timeout: 3000 }
    );
    return result.split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('HKEY') || l.startsWith(root))
      .map(l => l.replace(/^.*\\([^\\]+)$/, '$1'))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function detectInstalledPlatforms() {
  if (process.platform !== 'win32') return [];
  if (_registryCache) return _registryCache;

  const found = [];

  for (const platform of AUTO_LAUNCH_PLATFORMS) {
    const cfg = CAD_REGISTRY_PATHS[platform];
    if (!cfg) continue;

    try {
      const subKeys = listRegistrySubKeys(`HKLM\\${cfg.root}`);
      const matching = subKeys.filter(k => cfg.keyPattern.test(k));

      for (const verKey of matching) {
        const basePath = `HKLM\\${cfg.root}\\${verKey}`;
        let exeDir = null;

        if (platform === 'AutoCAD') {
          const releaseKeys = listRegistrySubKeys(basePath);
          for (const rk of releaseKeys) {
            if (/^ACAD-\d+:\d+$/.test(rk)) {
              exeDir = getRegistryKey(basePath, rk, 'Location');
              if (exeDir) break;
            }
          }
        } else {
          exeDir = getRegistryKey(basePath, null, 'Path')
            || getRegistryKey(basePath, null, 'InstallPath')
            || getRegistryKey(basePath, null, 'InstallDir');
        }

        if (exeDir) {
          const exePath = path.join(exeDir, cfg.exe);
          if (fs.existsSync(exePath)) {
            found.push({ platform, exePath, version: verKey });
          }
        }
      }
    } catch (e) {
      logError(`检测 ${platform} 安装路径失败: ${e.message}`);
    }
  }

  _registryCache = found;
  return found;
}

export function clearDetectCache() {
  _registryCache = null;
}

export async function launchCadProcess(platform, exePath) {
  return new Promise((resolve, reject) => {
    log(`启动 CAD: ${platform} (${exePath})`);
    const child = execFile(exePath, [], {
      detached: true,
      windowsHide: false,
    }, (err) => {
      if (err && err.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
        reject(new Error(`启动 ${platform} 失败: ${err.message}`));
        return;
      }
    });

    child.on('spawn', () => {
      log(`${platform} 进程已启动 (PID: ${child.pid})`);
    });

    child.on('error', (err) => {
      reject(new Error(`启动 ${platform} 失败: ${err.message}`));
    });

    child.unref();
    resolve({ pid: child.pid, platform });
  });
}

export async function ensureCadInstance({
  preferredPlatforms = AUTO_LAUNCH_PLATFORMS,
  timeout: _timeout = 30000,
} = {}) {
  const installed = detectInstalledPlatforms();
  if (installed.length === 0) {
    logError('未检测到已安装的 CAD 平台');
    return false;
  }

  const prioritized = preferredPlatforms
    .map(p => installed.find(i => i.platform === p))
    .filter(Boolean);

  for (const candidate of prioritized) {
    log(`尝试启动 ${candidate.platform} (${candidate.exePath})`);
    try {
      await launchCadProcess(candidate.platform, candidate.exePath);
      log(`${candidate.platform} 已启动，等待就绪...`);
      return true;
    } catch (e) {
      logError(`启动 ${candidate.platform} 失败: ${e.message}，尝试下一个平台`);
    }
  }

  logError('所有 CAD 平台启动失败');
  return false;
}
