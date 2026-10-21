import iconv from 'iconv-lite';
import { cad } from '../cad.js';
import { log } from '../logger.js';
import config from '../config.js';
import { withCadConnection, mcpSuccess, mcpError, escapeLispString } from '../handler-utils.js';
import { analyzeLispCode } from '../lint-analyzer.js';
import { SERVER_VERSION, BUILD_META } from '../constants.js';
import {
    ensureAtlispReady, installAtlispCore, initAtlispLibrary, getAtlispStatus,
} from '../atlisp-bootstrap.js';
import { jsonStructured } from './structured-output.js';

/**
 * 显式连接工具也走自动安装，但受配置开关控制。
 * 失败只作为提示返回，不影响“已连接”这一事实。
 */
async function bootstrapAtlisp(reason) {
    if (!config.autoInstallAtlisp) {
        return { ok: true, skipped: true, message: '自动安装 @lisp 已关闭' };
    }
    try {
        return await ensureAtlispReady({ reason, force: true });
    } catch (e) {
        log(`[atlisp] ${reason} 自动安装异常: ${e.message}`);
        return { ok: false, message: e.message };
    }
}

function atlispSuffix(status) {
    if (status && status.skipped) return '；自动安装 @lisp 已关闭';
    if (status && status.ok) return '；@lisp 环境已就绪';
    return `；@lisp 自动安装未完成：${status?.message || '未知错误'}`;
}

export async function openCad(platform = null) {
    log(`open_cad called${platform ? ` (target: ${platform})` : ''}`);
    try {
        const connected = await cad.connect(platform);
        if (!connected) {
            return mcpError('未能打开或连接 CAD，请确保 CAD 已安装');
        }
        const platformName = cad.getPlatform();
        const version = cad.getVersion();
        await cad.bringToFront();
        const atlisp = await bootstrapAtlisp('open_cad');
        return mcpSuccess(`已打开 ${platformName} ${version} 并切换到前台` +
            atlispSuffix(atlisp));
    } catch (e) {
        log('open_cad error: ' + e.message);
        return mcpError(`打开 CAD 失败: ${e.message}`);
    }
}

export async function connectCad(platform = null) {
    log(`connect_cad called${platform ? ` (target: ${platform})` : ''}, cad.connected before: ${cad.connected}`);
    try {
        log('calling cad.connect()...');
        const connected = await cad.connect(platform);
        log('cad.connect() returned: ' + connected + ', cad.connected: ' + cad.connected);
        if (connected) {
            const atlisp = await bootstrapAtlisp('connect_cad');
            return mcpSuccess(`已连接到 ${cad.getPlatform()} ${cad.getVersion()}` +
                atlispSuffix(atlisp));
        }
        return mcpError('未能连接或启动 CAD，请确保 CAD 已安装');
    } catch (e) {
        log('connect_cad error: ' + e.message);
        return mcpError(`连接 CAD 失败: ${e.message}`);
    }
}

export const evalLisp = withCadConnection(async (code, withResult = false, encoding = null) => {
    const trimmed = (code || '').trim();
    if (!trimmed) return mcpSuccess('命令为空，未发送');

    const analysis = analyzeLispCode(trimmed);
    if (!analysis.valid) {
        const detail = analysis.errors.map(e => `  L${e.line}: [${e.rule}] ${e.message}`).join('\n');
        return mcpError(`代码存在安全问题:\n${detail}`);
    }

    if (withResult) {
        const useRaw = encoding ? true : false;
        const resp = await cad.sendCommandWithResult(trimmed, encoding, useRaw);
        if (resp !== null) {
            if (useRaw && resp.rawBase64) {
                const buf = Buffer.from(resp.rawBase64, 'base64');
                const decoded = iconv.decode(buf, encoding);
                return mcpSuccess(decoded);
            }
            return mcpSuccess(resp);
        }
        return mcpError('执行失败或无返回值');
    }
    await cad.sendCommand(trimmed + '\n');
    return mcpSuccess('已发送命令');
});

export const getCadInfo = withCadConnection(async () => {
    let info = await cad.getInfo();
    try {
        const { default: peerManager } = await import('../peer-manager.js');
        const peers = peerManager.getPeers().filter(p => p.healthy);
        if (peers.length) {
            const peerLines = peers.map(p => `  ${p.hostname} (${p.url}) [健康]`);
            info = `${info}\n远程 Peer:\n${peerLines.join('\n')}`;
        }
    } catch { /* peer 状态为附加信息，失败时忽略 */ }
    return mcpSuccess(info);
}, { skipAtlisp: true });

export const atCommand = withCadConnection(async (command) => {
    const trimmed = (command || '').trim();
    if (!trimmed) return mcpSuccess('命令为空，未发送');

    const analysis = analyzeLispCode(trimmed);
    if (!analysis.valid) {
        const detail = analysis.errors.map(e => `  L${e.line}: [${e.rule}] ${e.message}`).join('\n');
        return mcpError(`代码存在安全问题:\n${detail}`);
    }

    await cad.sendCommand(trimmed + '\n');
    return mcpSuccess('已发送命令');
});

export const newDocument = withCadConnection(async () => {
    try {
        const result = await cad.newDoc();
        // 兼容旧返回值（布尔值）和新返回值（对象）
        if (result === true || (result && result.success)) {
            return mcpSuccess('已在 CAD 中新建空白文档');
        }
        const errorMsg = result && result.error ? result.error : '未知错误';
        return mcpError(`新建文档失败: ${errorMsg}`);
    } catch (e) {
        return mcpError(`新建文档异常: ${e.message}`);
    }
}, { skipAtlisp: true });

export const bringToFront = withCadConnection(async () => {
    const result = await cad.bringToFront();
    if (result) {
        return mcpSuccess('已将 CAD 窗口切换到前台');
    }
    return mcpError('切换前台失败');
}, { skipAtlisp: true });

export const sendEsc = withCadConnection(async () => {
    const result = await cad.sendEsc(true);
    if (result) {
        return mcpSuccess('已向 CAD 发送 ESC');
    }
    return mcpError('发送 ESC 失败');
}, { skipAtlisp: true });

export const installAtlisp = withCadConnection(async () => {
    const status = await installAtlispCore();
    return status.ok ? mcpSuccess(status.message) : mcpError(status.message);
});

export const listFunctionsInCad = withCadConnection(async () => {
    const result = await cad.sendCommandWithResult('(atoms-family 0)', null);
    if (result) return mcpSuccess(result);
    return mcpError('CAD 函数列表为空');
}, { skipAtlisp: true });

export async function getSystemStatus() {
  const distMismatch = Boolean(BUILD_META && BUILD_META.version !== SERVER_VERSION);
  const status = {
    mcp: {
      version: SERVER_VERSION,
      build: BUILD_META
        ? { version: BUILD_META.version, commit: BUILD_META.commit, builtAt: BUILD_META.builtAt }
        : null,
      distMismatch,
    },
    worker: { alive: false },
    cad: { connected: false, platform: null, version: null, busy: false, hasDoc: false },
    lisp: { available: false, testResult: null, error: null },
    atlisp: { connected: false, installed: false, ready: false, ok: false },
    packages: null,
  };

  try {
    status.worker.alive = await cad.ping();
  } catch { status.worker.alive = false; }

  status.cad.connected = cad.connected;
  if (cad.connected) {
    status.cad.platform = cad.getPlatform();
    status.cad.version = cad.getVersion();
    try { status.cad.busy = await cad.isBusy(); } catch (e) { log(`cad-handlers: isBusy error: ${e.message}`); }
    try {
      const doc = await cad.hasDoc();
      status.cad.hasDoc = doc.hasDoc;
    } catch (e) { log(`cad-handlers: hasDoc error: ${e.message}`); }
    try {
      const r = await cad.sendCommandWithResult('(+ 1 2)');
      if (r !== null && r !== undefined) {
        status.lisp.available = true;
        status.lisp.testResult = String(r).trim();
      }
    } catch (e) {
      status.lisp.error = e.message;
    }
    try {
      const pkgResult = await cad.sendCommandWithResult('(@::package-list-in-local)');
      if (pkgResult && pkgResult !== 'nil') {
        status.packages = pkgResult;
      }
    } catch (e) { log(`cad-handlers: getSystemStatus package-list error: ${e.message}`); }
    try {
      status.atlisp = await getAtlispStatus();
    } catch (e) {
      status.atlisp = {
        connected: true, installed: false, ready: false, ok: false,
        message: `探测失败: ${e.message}`,
      };
    }
  }

  const text = JSON.stringify(status, null, 2);
  return { content: [{ type: 'text', text }], structuredContent: jsonStructured(text) };
}

export const initAtlisp = withCadConnection(async () => {
    const status = await initAtlispLibrary();
    return status.ok ? mcpSuccess(status.message) : mcpError(status.message);
});

export const getSystemVariable = withCadConnection(async (name) => {
    const result = await cad.sendCommandWithResult(`(vl-princ-to-string (getvar "${escapeLispString(name)}"))`);
    return mcpSuccess(result || 'nil');
}, { skipAtlisp: true });

export const setSystemVariable = withCadConnection(async (name, value) => {
    await cad.sendCommand(`(setvar "${escapeLispString(name)}" ${value})\n`);
    return mcpSuccess(`已设置 ${name} = ${value}`);
}, { skipAtlisp: true });
