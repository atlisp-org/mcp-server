import { cad } from '../cad.js';
import { log } from '../logger.js';
import { withCadConnection, mcpSuccess, mcpError, escapeLispString } from '../handler-utils.js';
import { analyzeLispCode } from '../lint-analyzer.js';

export async function connectCad(platform = null) {
    log(`connect_cad called${platform ? ` (target: ${platform})` : ''}, cad.connected before: ${cad.connected}`);
    try {
        log('calling cad.connect()...');
        const connected = await cad.connect(platform);
        log('cad.connect() returned: ' + connected + ', cad.connected: ' + cad.connected);
        if (connected) {
            const messages = [`已连接到 ${cad.getPlatform()} ${cad.getVersion()}`];
            initAtlisp().catch(e => log(`connect_cad: initAtlisp failed: ${e.message}`));
            return mcpSuccess(messages.join('；'));
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
        const result = await cad.sendCommandWithResult(trimmed, encoding);
        if (result !== null) {
            return mcpSuccess(result);
        }
        return mcpError('执行失败或无返回值');
    }
    await cad.sendCommand(trimmed + '\n');
    return mcpSuccess('已发送命令');
});

export const getCadInfo = withCadConnection(async () => {
    const info = await cad.getInfo();
    return mcpSuccess(info);
});

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
    const result = await cad.newDoc();
    if (result) {
        return mcpSuccess('已在 CAD 中新建空白文档');
    }
    return mcpError('新建文档失败');
});

export const bringToFront = withCadConnection(async () => {
    const result = await cad.bringToFront();
    if (result) {
        return mcpSuccess('已将 CAD 窗口切换到前台');
    }
    return mcpError('切换前台失败');
});

export const installAtlisp = withCadConnection(async () => {
    const installCode = '(progn(vl-load-com)(setq s strcat h "http" o(vlax-create-object (s"win"h".win"h"request.5.1"))v vlax-invoke e eval r read)(v o\'open "get" (s h"://atlisp.""cn/@"):vlax-true)(v o\'send)(v o\'WaitforResponse 1000)(e(r(vlax-get-property o\'ResponseText))))';
    await cad.sendCommand(installCode + '\n');
    return mcpSuccess('已发送 @lisp 安装代码到 CAD');
});

export const listFunctionsInCad = withCadConnection(async () => {
    const result = await cad.sendCommandWithResult('(atoms-family 0)', null);
    if (result) return mcpSuccess(result);
    return mcpError('CAD 函数列表为空');
});

export async function getSystemStatus() {
  const status = {
    mcp: { version: process.env.npm_package_version || 'unknown' },
    worker: { alive: false },
    cad: { connected: false, platform: null, version: null, busy: false, hasDoc: false },
    lisp: { available: false, testResult: null, error: null },
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
  }

  return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
}

export const initAtlisp = withCadConnection(async () => {
    const code = `(if (null @::load-module)
	   (progn
	     (vl-load-com)
	     (setq s strcat h"http"o(vlax-create-object (s"win"h".win"h"request.5.1"))
		   v vlax-invoke e eval r read)(v o'open "get" (s h"://""atlisp.""cn/cloud"):vlax-true)
		   (v o'send)
		   (v o'WaitforResponse 1000)
		   (e(r(vlax-get o'ResponseText)))))`;
    await cad.sendCommand(code + '\n');
    return mcpSuccess('已发送 @lisp 函数库加载代码到 CAD');
});

export const getSystemVariable = withCadConnection(async (name) => {
    const result = await cad.sendCommandWithResult(`(vl-princ-to-string (getvar "${escapeLispString(name)}"))`);
    return mcpSuccess(result || 'nil');
});

export const setSystemVariable = withCadConnection(async (name, value) => {
    await cad.sendCommand(`(setvar "${escapeLispString(name)}" ${value})\n`);
    return mcpSuccess(`已设置 ${name} = ${value}`);
});
