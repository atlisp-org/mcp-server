/**
 * @lisp 核心/函数库自动安装与加载。
 *
 * 设计目标：连接 CAD 后不需要用户手动调用 install_atlisp / init_atlisp，
 * 让 @lisp 函数库和应用功能开箱可用。
 *
 * 顺序：
 *   1. 探测 @::init-once / @::load-module（核心是否已安装）
 *   2. 未安装 → 检查未保存图纸 → 执行 https://atlisp.cn/@ 安装脚本
 *   3. 执行 https://atlisp.cn/cloud 加载函数库（init_atlisp）
 *   4. 轮询 BASE:INIT 就绪
 *
 * 关键约束：
 *   - 安装脚本遇到未保存图纸会弹窗并 exit，因此自动安装前必须拦截；
 *   - 所有命令都通过 cad.sendCommandWithResult 走命令队列，避免与读命令并发；
 *   - 结果按「CAD 实例 + 连接代数」缓存，避免每次工具调用都探测/重装。
 */

import { cad } from './cad.js';
import { log, error as logError } from './logger.js';
import config from './config.js';

const TOKEN_READY = 'ATLISP-READY';
const TOKEN_CORE = 'ATLISP-CORE';
const TOKEN_NONE = 'ATLISP-NONE';
const TOKEN_UNSAVED = 'ATLISP-UNSAVED';
const TOKEN_SAVED = 'ATLISP-SAVED';

// 与旧版 install_atlisp 工具发送的代码保持一致（通过 HTTP 拉取安装脚本并 eval）。
export const ATLISP_INSTALL_CODE =
    '(progn(vl-load-com)(setq s strcat h "http" o(vlax-create-object (s"win"h".win"h"request.5.1"))v vlax-invoke e eval r read)(v o\'open "get" (s h"://atlisp.""cn/@"):vlax-true)(v o\'send)(v o\'WaitforResponse 1000)(e(r(vlax-get-property o\'ResponseText))))';

// 无条件拉取 cloud 引导代码。
// 旧版 init_atlisp 外面套了 (if (null @::load-module) ...)，核心已安装但函数库未加载时
// 该条件为假，反而不会执行；自动引导必须能补加载，所以这里去掉守卫。
export const ATLISP_INIT_CODE = `(progn
	     (vl-load-com)
	     (setq s strcat h"http"o(vlax-create-object (s"win"h".win"h"request.5.1"))
		   v vlax-invoke e eval r read)(v o'open "get" (s h"://""atlisp.""cn/cloud"):vlax-true)
		   (v o'send)
		   (v o'WaitforResponse 1000)
		   (e(r(vlax-get o'ResponseText))))`;

// atoms-family 返回字符串，必须用字符串比对（不能拿 'symbol 去 member）。
// 核心标志用 @::INIT-ONCE / @::LOAD-MODULE：前者由内核定义，
// 后者可能由 cloud 引导定义，二者任一存在都说明内核已加载。
export const ATLISP_PROBE_CODE = '(progn ' +
    '(cond ' +
    '((and (or (member "@::INIT-ONCE" (atoms-family 1)) ' +
    '(member "@::LOAD-MODULE" (atoms-family 1))) ' +
    '(member "BASE:INIT" (atoms-family 1))) (princ "' + TOKEN_READY + '")) ' +
    '((or (member "@::INIT-ONCE" (atoms-family 1)) ' +
    '(member "@::LOAD-MODULE" (atoms-family 1))) (princ "' + TOKEN_CORE + '")) ' +
    '((princ "' + TOKEN_NONE + '"))) ' +
    '(princ))';

// 与 https://atlisp.cn/@ 安装脚本的 nosaved 判断保持一致：
// 忽略 AutoCAD 新建的 Drawing1.dwg / Drawing2.dwg 等模板图纸（它们本来就未保存）。
export const ATLISP_UNSAVED_PROBE_CODE = '(progn ' +
    '(vl-load-com) ' +
    '(setq @mcp-unsaved 0) ' +
    '(setq @mcp-docs (vl-catch-all-apply \'(lambda () ' +
    '(vla-get-Documents (vlax-get-acad-object))))) ' +
    '(if (vl-catch-all-error-p @mcp-docs) ' +
    '(princ "ATLISP-UNKNOWN") ' +
    '(progn ' +
    '(vlax-for @mcp-doc @mcp-docs ' +
    '(if (and (not (wcmatch (vla-get-name @mcp-doc) "Drawing#.dwg")) ' +
    '(eq (vl-catch-all-apply \'vla-get-Saved (list @mcp-doc)) :vlax-false)) ' +
    '(setq @mcp-unsaved 1))) ' +
    '(princ (if @mcp-unsaved "' + TOKEN_UNSAVED + '" "' + TOKEN_SAVED + '")))) ' +
    '(setq @mcp-unsaved nil @mcp-docs nil @mcp-doc nil) ' +
    '(princ))';

const state = {
    ready: false,
    key: '',
    last: null,
    lastFailureAt: 0,
    inFlight: null,
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function timeoutValue(override) {
    const value = Number(override);
    if (Number.isFinite(value) && value > 0) return value;
    const configured = Number(config.atlispBootstrapTimeout);
    return Number.isFinite(configured) && configured > 0 ? configured : 120000;
}

function retryValue() {
    const value = Number(config.atlispBootstrapRetry);
    return Number.isFinite(value) && value > 0 ? value : 60000;
}

function connectionKey() {
    let id;
    let epoch;
    try {
        id = cad.getConnectionId ? cad.getConnectionId() : '';
    } catch {
        id = '';
    }
    try {
        epoch = Number(cad.connectionEpoch) || 0;
    } catch {
        epoch = 0;
    }
    return `${id || 'unknown'}:${epoch}`;
}

function markReady(key, status) {
    state.ready = true;
    state.key = key;
    state.last = status;
    state.lastFailureAt = 0;
}

function markFailure(status) {
    state.ready = false;
    state.key = '';
    state.last = status;
    state.lastFailureAt = Date.now();
}

function invalidate() {
    state.ready = false;
    state.key = '';
    state.last = null;
    state.lastFailureAt = 0;
}

/** 手动让缓存失效（例如外部安装/卸载 @lisp 后）。 */
export function resetAtlispReady() {
    invalidate();
}

let connectHookInstalled = false;
let pendingConnectCheck = null;

/**
 * 连接事件触发点：任何路径连上 CAD 后都要检查 @lisp 是否已安装，未安装则自动安装。
 *
 * 单独依赖 ensureCadConnected 是不够的：
 *   - 不少 handler 直接调用 `cad.connect()`（purge/text/file/query-print 等），不会经过它；
 *   - 连接池切换活动实例、后台重连也不经过它。
 * 因此从 cad.js 的连接事件统一下发，用 setImmediate 延后一拍，让连接后立即发出的
 * 紧急命令（send_esc 等）先入队，安装/加载排在其后。
 *
 * @param {{connection?: object, platform?: string, version?: string, reason?: string}} info
 */
function onConnectionReady(info) {
    if (pendingConnectCheck) return;
    pendingConnectCheck = setImmediate(async () => {
        pendingConnectCheck = null;
        if (!config.autoInstallAtlisp) return;
        if (!cad.connected) return;
        const reason = info?.reason === 'activate' ? 'cad-activate' : 'cad-connected';
        try {
            const result = await ensureAtlispReady({ reason });
            if (result.ok) {
                log(`[atlisp] 连接后检查完成：${result.message}（${result.action}）`);
            } else {
                log(`[atlisp] 连接后自动安装/加载未完成（${result.action}）：${result.message}`);
            }
        } catch (e) {
            log(`[atlisp] 连接后自动安装/加载异常：${e.message}`);
        }
    });
    if (typeof pendingConnectCheck.unref === 'function') pendingConnectCheck.unref();
}

/**
 * 安装连接事件钩子（幂等）。
 *
 * cad.js 不能反向 import 本模块（循环依赖），所以这里用动态 import 取 onCadConnected /
 * resolveCadConnection；被测试 mock 的 cad.js 没有这些导出时会安全跳过。
 */
export async function installAtlispConnectHook() {
    if (connectHookInstalled) return true;
    let cadModule;
    try {
        cadModule = await import('./cad.js');
        // 访问被 mock 的模块上不存在的导出时 Vitest 会抛错，所以判断也要放在 try 内
        if (typeof cadModule.onCadConnected !== 'function') return false;
        if (typeof cadModule.resolveCadConnection !== 'function') return false;
    } catch (e) {
        log(`[atlisp] 无法安装连接钩子：${e.message}`);
        return false;
    }
    connectHookInstalled = true;
    cadModule.onCadConnected((info) => {
        // 只处理当前活动实例：连接池新建的非活动实例会在 setActive 时补发事件
        if (info?.connection) {
            let active;
            try {
                active = cadModule.resolveCadConnection();
            } catch {
                active = null;
            }
            if (active && active !== info.connection) return;
        }
        onConnectionReady(info);
    });
    return true;
}

// 模块被引入即接线（entry / handler-utils 都会静态 import 本模块）
void installAtlispConnectHook();

/**
 * 探测 CAD 内 @lisp 状态。使用唯一 token 返回，避免依赖返回值格式。
 * @param {number} [timeoutMs]
 * @returns {Promise<{ready:boolean, core:boolean, unknown:boolean, error?:string, raw?:string}>}
 */
export async function probeAtlisp(timeoutMs = 8000) {
    if (!cad.connected) {
        return { ready: false, core: false, unknown: true, error: 'CAD 未连接' };
    }
    try {
        const raw = await cad.sendCommandWithResult(ATLISP_PROBE_CODE, null, false, timeoutMs, true);
        const text = String(raw ?? '');
        if (text.includes(TOKEN_READY)) {
            return { ready: true, core: true, unknown: false, raw: text };
        }
        if (text.includes(TOKEN_CORE)) {
            return { ready: false, core: true, unknown: false, raw: text };
        }
        if (text.includes(TOKEN_NONE)) {
            return { ready: false, core: false, unknown: false, raw: text };
        }
        return { ready: false, core: false, unknown: true, raw: text };
    } catch (e) {
        return { ready: false, core: false, unknown: true, error: e.message };
    }
}

/**
 * 检查是否所有打开的图纸都已保存。
 * 安装脚本在存在未保存图纸时会弹窗并 exit，自动安装必须避开该分支。
 * @returns {Promise<{known:boolean, unsaved:boolean, error?:string}>}
 */
async function checkUnsaved() {
    if (!cad.connected) {
        return { known: false, unsaved: false, error: 'CAD 未连接' };
    }
    try {
        const raw = await cad.sendCommandWithResult(ATLISP_UNSAVED_PROBE_CODE, null, false, 10000, true);
        const text = String(raw ?? '');
        if (text.includes(TOKEN_UNSAVED)) return { known: true, unsaved: true };
        if (text.includes(TOKEN_SAVED)) return { known: true, unsaved: false };
        return { known: false, unsaved: false, error: text || '无法解析检查结果' };
    } catch (e) {
        return { known: false, unsaved: false, error: e.message };
    }
}

async function runLisp(code, timeoutMs, label) {
    const started = Date.now();
    const result = await cad.sendCommandWithResult(code, null, false, timeoutMs, true);
    log(`[atlisp] ${label}完成（${Date.now() - started}ms）`);
    return result;
}

async function waitFor(check, timeoutMs) {
    const deadline = Date.now() + Math.max(1000, timeoutMs);
    let lastProbe = null;

    while (Date.now() < deadline) {
        // 安装脚本可能还在 CAD 命令行走（executeLongCode 只等 2 秒），
        // CAD 忙时不要再排队发探测命令，等它空闲后再探。
        let busy;
        try {
            busy = await cad.isBusy();
        } catch {
            busy = false;
        }

        if (!busy) {
            lastProbe = await probeAtlisp(8000);
            if (check(lastProbe)) return lastProbe;
        }
        await sleep(1000);
    }

    return lastProbe || await probeAtlisp(8000);
}

/**
 * 确保 CAD 内 @lisp 核心与函数库可用。
 *
 * @param {{force?:boolean, reason?:string, timeoutMs?:number}} [options]
 * @returns {Promise<{
 *   ok:boolean, connected:boolean, installed:boolean, ready:boolean,
 *   action:string, message:string, reason:string, elapsedMs:number,
 *   cached?:boolean, throttled?:boolean, unsaved?:boolean, error?:string
 * }>}
 */
export async function ensureAtlispReady(options = {}) {
    const started = Date.now();
    const reason = options.reason || 'auto';
    const force = options.force === true;

    if (!cad.connected) {
        return {
            ok: false, connected: false, installed: false, ready: false,
            action: 'skipped', message: 'CAD 未连接', reason,
            elapsedMs: Date.now() - started,
        };
    }

    const key = connectionKey();
    if (!force && state.ready && state.key === key && state.last) {
        return { ...state.last, cached: true, elapsedMs: Date.now() - started };
    }

    if (state.inFlight) {
        return state.inFlight;
    }

    if (!force && state.last && !state.last.ok &&
        Date.now() - state.lastFailureAt < retryValue()) {
        return { ...state.last, cached: true, throttled: true, elapsedMs: Date.now() - started };
    }

    const timeoutMs = timeoutValue(options.timeoutMs);
    const promise = runBootstrap({ key, reason, timeoutMs, started });
    state.inFlight = promise;
    try {
        return await promise;
    } finally {
        state.inFlight = null;
    }
}

async function runBootstrap({ key, reason, timeoutMs, started }) {
    let installed = false;
    let didInstall = false;
    try {
        let probe = await probeAtlisp(8000);
        if (probe.ready) {
            const status = {
                ok: true, connected: true, installed: true, ready: true,
                action: 'ready', message: '@lisp 环境已就绪', reason,
                elapsedMs: Date.now() - started,
            };
            markReady(key, status);
            return status;
        }

        installed = probe.core;
        if (!installed) {
            const unsaved = await checkUnsaved();
            if (!unsaved.known) {
                const status = {
                    ok: false, connected: true, installed: false, ready: false,
                    action: 'blocked',
                    message: '无法检查未保存图纸，已跳过自动安装：' +
                        (unsaved.error || '未知错误') +
                        '。请保存图纸后重试，或手动调用 install_atlisp。',
                    reason, elapsedMs: Date.now() - started,
                };
                markFailure(status);
                return status;
            }
            if (unsaved.unsaved) {
                const status = {
                    ok: false, connected: true, installed: false, ready: false,
                    action: 'blocked', unsaved: true,
                    message: '检测到未保存的图纸，已跳过自动安装。请先保存所有图纸，' +
                        '然后重新连接或调用 install_atlisp。',
                    reason, elapsedMs: Date.now() - started,
                };
                markFailure(status);
                return status;
            }

            log('[atlisp] 未检测到 @lisp 核心，开始自动安装...');
            await runLisp(ATLISP_INSTALL_CODE, timeoutMs, '安装 @lisp 核心');
            probe = await waitFor(p => p.core, Math.min(timeoutMs, 120000));
            if (!probe.core) {
                const status = {
                    ok: false, connected: true, installed: false, ready: false,
                    action: 'failed',
                    message: '@lisp 安装命令已执行，但未检测到 @::init-once / @::load-module。' +
                        '可能是下载失败、被 CAD 安全设置拦截，或安装脚本仍在等待交互。',
                    reason, elapsedMs: Date.now() - started,
                    error: probe.error,
                };
                markFailure(status);
                return status;
            }
            installed = true;
            didInstall = true;

            // 内核的 @::init-once 通常已经通过 @::loadlib 加载了函数库，
            // 如果 BASE:INIT 已就绪就不必再拉一次 cloud。
            if (probe.ready) {
                const status = {
                    ok: true, connected: true, installed: true, ready: true,
                    action: 'installed',
                    message: '已自动安装 @lisp 核心并加载函数库',
                    reason, elapsedMs: Date.now() - started,
                };
                markReady(key, status);
                return status;
            }
        }

        log('[atlisp] 加载 @lisp 函数库...');
        await runLisp(ATLISP_INIT_CODE, timeoutMs, '初始化 @lisp 函数库');
        probe = await waitFor(p => p.ready, Math.min(timeoutMs, 60000));
        if (probe.ready) {
            const status = {
                ok: true, connected: true, installed: true, ready: true,
                action: didInstall ? 'installed' : 'initialized',
                message: didInstall
                    ? '已自动安装 @lisp 核心并加载函数库'
                    : '已加载 @lisp 函数库',
                reason, elapsedMs: Date.now() - started,
            };
            markReady(key, status);
            return status;
        }

        const status = {
            ok: false, connected: true, installed: probe.core, ready: false,
            action: 'failed',
            message: probe.core
                ? '@lisp 核心已安装，但函数库未就绪（未检测到 base:init）。' +
                  '请检查网络或手动调用 init_atlisp。'
                : '@lisp 初始化失败，未检测到 @::init-once / @::load-module / base:init。',
            reason, elapsedMs: Date.now() - started,
            error: probe.error,
        };
        markFailure(status);
        return status;
    } catch (e) {
        logError('[atlisp] 自动安装/加载失败: ' + e.message);
        const status = {
            ok: false, connected: Boolean(cad.connected), installed, ready: false,
            action: 'failed', message: e.message, reason,
            elapsedMs: Date.now() - started, error: e.message,
        };
        markFailure(status);
        return status;
    }
}

/**
 * 显式安装 @lisp 核心（install_atlisp 工具使用）。
 * 与自动流程不同：不加载函数库，保留原有「安装后调用 init_atlisp」语义。
 */
export async function installAtlispCore(options = {}) {
    const started = Date.now();
    if (!cad.connected) {
        return {
            ok: false, connected: false, installed: false, ready: false,
            action: 'skipped', message: 'CAD 未连接', elapsedMs: Date.now() - started,
        };
    }

    const probe = await probeAtlisp(8000);
    if (probe.core) {
        return {
            ok: true, connected: true, installed: true, ready: probe.ready,
            action: 'already',
            message: probe.ready
                ? '@lisp 核心和函数库均已加载，无需重复安装。'
                : '@lisp 核心已安装，无需重复安装。可调用 init_atlisp 加载函数库。',
            elapsedMs: Date.now() - started,
        };
    }

    const unsaved = await checkUnsaved();
    if (!unsaved.known) {
        return {
            ok: false, connected: true, installed: false, ready: false,
            action: 'blocked',
            message: '无法检查未保存图纸，安装已取消：' + (unsaved.error || '未知错误'),
            elapsedMs: Date.now() - started,
        };
    }
    if (unsaved.unsaved) {
        return {
            ok: false, connected: true, installed: false, ready: false,
            action: 'blocked', unsaved: true,
            message: '检测到未保存的图纸，安装已取消。请先保存所有图纸后重试。',
            elapsedMs: Date.now() - started,
        };
    }

    invalidate();
    try {
        await runLisp(ATLISP_INSTALL_CODE, timeoutValue(options.timeoutMs), '安装 @lisp 核心');
    } catch (e) {
        return {
            ok: false, connected: Boolean(cad.connected), installed: false, ready: false,
            action: 'failed', message: '安装命令执行失败：' + e.message,
            elapsedMs: Date.now() - started, error: e.message,
        };
    }

    const after = await waitFor(p => p.core, Math.min(timeoutValue(options.timeoutMs), 120000));
    if (!after.core) {
        return {
            ok: false, connected: Boolean(cad.connected), installed: false, ready: false,
            action: 'failed',
            message: '@lisp 安装命令已执行，但未检测到 @::init-once / @::load-module。' +
                '请查看 CAD 命令行是否有下载/加载错误。',
            elapsedMs: Date.now() - started, error: after.error,
        };
    }

    return {
        ok: true, connected: true, installed: true, ready: after.ready,
        action: 'installed',
        message: '@lisp 核心安装完成。请调用 init_atlisp 加载函数库。',
        elapsedMs: Date.now() - started,
    };
}

/**
 * 显式加载 @lisp 函数库（init_atlisp 工具使用）。
 */
export async function initAtlispLibrary(options = {}) {
    const started = Date.now();
    if (!cad.connected) {
        return {
            ok: false, connected: false, installed: false, ready: false,
            action: 'skipped', message: 'CAD 未连接', elapsedMs: Date.now() - started,
        };
    }

    const probe = await probeAtlisp(8000);
    if (!probe.core) {
        return {
            ok: false, connected: true, installed: false, ready: false,
            action: 'not-installed',
            message: '@lisp 核心尚未安装，请先调用 install_atlisp。',
            elapsedMs: Date.now() - started,
        };
    }
    if (probe.ready) {
        const status = {
            ok: true, connected: true, installed: true, ready: true,
            action: 'already', message: '@lisp 函数库已加载。',
            elapsedMs: Date.now() - started,
        };
        markReady(connectionKey(), status);
        return status;
    }

    try {
        await runLisp(ATLISP_INIT_CODE, timeoutValue(options.timeoutMs), '初始化 @lisp 函数库');
    } catch (e) {
        return {
            ok: false, connected: Boolean(cad.connected), installed: true, ready: false,
            action: 'failed', message: '初始化命令执行失败：' + e.message,
            elapsedMs: Date.now() - started, error: e.message,
        };
    }

    const after = await waitFor(p => p.ready, Math.min(timeoutValue(options.timeoutMs), 60000));
    if (after.ready) {
        const status = {
            ok: true, connected: true, installed: true, ready: true,
            action: 'initialized', message: '已加载 @lisp 函数库。',
            elapsedMs: Date.now() - started,
        };
        markReady(connectionKey(), status);
        return status;
    }

    return {
        ok: false, connected: Boolean(cad.connected), installed: after.core, ready: false,
        action: 'failed',
        message: after.core
            ? '初始化命令已执行，但未检测到 base:init。请检查网络或手动重试。'
            : '初始化失败，@lisp 核心未检测到。',
        elapsedMs: Date.now() - started, error: after.error,
    };
}

/**
 * 获取当前 @lisp 状态（get_system_status 使用）。
 */
export async function getAtlispStatus() {
    if (!cad.connected) {
        return {
            connected: false, installed: false, ready: false, ok: false,
            message: 'CAD 未连接',
        };
    }

    // 安装/加载进行中时不要插队探测（安装命令可能占用 1-2 分钟）
    if (state.inFlight) {
        return {
            connected: true, installed: false, ready: false, ok: false,
            action: 'installing',
            message: '@lisp 自动安装/加载进行中…',
        };
    }

    const probe = await probeAtlisp(8000);
    if (probe.ready) {
        const status = {
            ok: true, connected: true, installed: true, ready: true,
            action: 'ready', message: '@lisp 环境已就绪',
        };
        markReady(connectionKey(), { ...status, elapsedMs: 0 });
        return status;
    }

    const last = state.last;
    return {
        ok: false, connected: true, installed: probe.core, ready: probe.ready,
        action: probe.unknown ? 'unknown' : (probe.core ? 'installed' : 'not-installed'),
        message: last && last.ok === false
            ? last.message
            : (probe.unknown
                ? '无法探测 @lisp 状态：' + (probe.error || '未知返回')
                : (probe.core ? '@lisp 核心已安装，函数库未加载' : '@lisp 未安装')),
        lastAction: last ? last.action : null,
        error: probe.error || (last ? last.error : undefined),
    };
}
