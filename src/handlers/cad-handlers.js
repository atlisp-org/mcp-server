import { cad } from '../cad.js';
import { log } from '../logger.js';
import { escapeLispString } from '../handler-utils.js';

export async function connectCad(platform = null) {
    log(`connect_cad called${platform ? ` (target: ${platform})` : ''}, cad.connected before: ${cad.connected}`);
    try {
        log('calling cad.connect()...');
        const connected = await cad.connect(platform);
        log('cad.connect() returned: ' + connected + ', cad.connected: ' + cad.connected);
        if (connected) {
            const messages = [`已连接到 ${cad.getPlatform()} ${cad.getVersion()}`];
            initAtlisp().catch(e => log(`connect_cad: initAtlisp failed: ${e.message}`));
            return { content: [{ type: 'text', text: messages.join('；') }] };
        }
        return { content: [{ type: 'text', text: '未能连接或启动 CAD，请确保 CAD 已安装' }], isError: true };
    } catch (e) {
        log('connect_cad error: ' + e.message);
        return { content: [{ type: 'text', text: `连接 CAD 失败: ${e.message}` }], isError: true };
    }
}

export async function evalLisp(code, withResult = false, encoding = null) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) {
        return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    }
    const trimmed = (code || '').trim();
    if (!trimmed) return { content: [{ type: 'text', text: '命令为空，未发送' }] };
    try {
        if (withResult) {
            const result = await cad.sendCommandWithResult(trimmed, encoding);
            if (result !== null) {
                return { content: [{ type: 'text', text: result }] };
            }
            return { content: [{ type: 'text', text: '执行失败或无返回值' }], isError: true };
        } else {
            await cad.sendCommand(trimmed + '\n');
            return { content: [{ type: 'text', text: `已发送命令` }] };
        }
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

export async function getCadInfo() {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: 'CAD 未连接' }] };
    const info = await cad.getInfo();
    return { content: [{ type: 'text', text: info }] };
}

export async function atCommand(command) {
    if (!cad.connected) return { content: [{ type: 'text', text: '请先连接 CAD' }], isError: true };
    const trimmed = (command || '').trim();
    if (!trimmed) return { content: [{ type: 'text', text: '命令为空，未发送' }] };
    await cad.sendCommand(trimmed + '\n');
    return { content: [{ type: 'text', text: '已发送命令' }] };
}

export async function newDocument() {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    const result = await cad.newDoc();
    if (result) {
        return { content: [{ type: 'text', text: '已在 CAD 中新建空白文档' }] };
    }
    return { content: [{ type: 'text', text: '新建文档失败' }], isError: true };
}

export async function bringToFront() {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    const result = await cad.bringToFront();
    if (result) {
        return { content: [{ type: 'text', text: '已将 CAD 窗口切换到前台' }] };
    }
    return { content: [{ type: 'text', text: '切换前台失败' }], isError: true };
}

export async function installAtlisp() {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    const installCode = '(progn(vl-load-com)(setq s strcat h "http" o(vlax-create-object (s"win"h".win"h"request.5.1"))v vlax-invoke e eval r read)(v o\'open "get" (s h"://atlisp.""cn/@"):vlax-true)(v o\'send)(v o\'WaitforResponse 1000)(e(r(vlax-get-property o\'ResponseText))))';
    await cad.sendCommand(installCode + '\n');
    return { content: [{ type: 'text', text: '已发送 @lisp 安装代码到 CAD' }] };
}

export async function listFunctionsInCad() {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const result = await cad.sendCommandWithResult('(atoms-family 0)', null);
        if (result) return { content: [{ type: 'text', text: result }] };
        return { content: [{ type: 'text', text: 'CAD 函数列表为空' }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}

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

export async function initAtlisp() {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    const code = `(if (null @::load-module)
	   (progn
	     (vl-load-com)
	     (setq s strcat h"http"o(vlax-create-object (s"win"h".win"h"request.5.1"))
		   v vlax-invoke e eval r read)(v o'open "get" (s h"://""atlisp.""cn/cloud"):vlax-true)
		   (v o'send)
		   (v o'WaitforResponse 1000)
		   (e(r(vlax-get o'ResponseText)))))`;
    try {
        await cad.sendCommand(code + '\n');
        return { content: [{ type: 'text', text: '已发送 @lisp 函数库加载代码到 CAD' }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}
export async function getSystemVariable(name) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        const result = await cad.sendCommandWithResult(`(vl-princ-to-string (getvar "${escapeLispString(name)}"))`);
        return { content: [{ type: 'text', text: result || 'nil' }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}
export async function setSystemVariable(name, value) {
    if (!cad.connected) { await cad.connect(); }
    if (!cad.connected) return { content: [{ type: 'text', text: '未连接 CAD' }], isError: true };
    try {
        await cad.sendCommand(`(setvar "${escapeLispString(name)}" ${value})\n`);
        return { content: [{ type: 'text', text: `已设置 ${name} = ${value}` }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `错误: ${e.message}` }], isError: true };
    }
}
