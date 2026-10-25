import {  error as logError } from '../logger.js';
const PACKAGES_LIST_URL = process.env.PACKAGES_LIST_URL || 'http://s3.atlisp.cn/packages-list?fmt=json';
import { cad } from '../cad.js';
import { MOCK_PACKAGES } from '../constants.js';
let cachedPackages = null;
let cachedAt = null;
const CACHE_TTL = 10 * 60 * 1000;

async function fetchPackages() {
    const now = Date.now();
    if (cachedPackages && cachedAt && (now - cachedAt) < CACHE_TTL) {
        return cachedPackages;
    }
    try {
        const response = await fetch(PACKAGES_LIST_URL, {
            headers: { 'User-Agent': 'atlisp-mcp' },
            signal: AbortSignal.timeout(10000),
        });
        if (response.ok) {
            const data = await response.json();
            cachedPackages = data;
            cachedAt = now;
            return data;
        }
    } catch (e) { logError(`Package fetch error: ${e.message}`); }
    return cachedPackages || MOCK_PACKAGES;
}

function flattenPackages(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.packages)) return data.packages;
    return [];
}

export async function listPackages() {
    if (!cad.connected) await cad.connect();
    if (!cad.connected) {
        const data = await fetchPackages();
        const items = flattenPackages(data);
        const text = items.length
            ? items.map(p => `${p.name} v${p.version || ''} - ${p.description || ''}`).join('\n')
            : '无可用包';
        return { content: [{ type: 'text', text }] };
    }
    const result = await cad.sendCommandWithResult('(@::package-list-in-local)');
    if (result && result !== 'nil') return { content: [{ type: 'text', text: result }] };
    const data = await fetchPackages();
    const items = flattenPackages(data);
    const text = items.length
        ? `从注册表获取的 @lisp 包:\n${items.map(p => `${p.name} v${p.version || ''} - ${p.description || ''}`).join('\n')}`
        : MOCK_PACKAGES.map(p => `${p.name} v${p.version} - ${p.description}`).join('\n');
    return { content: [{ type: 'text', text: `已安装的 @lisp 包:\n${text}` }] };
}

export async function searchPackages(query) {
    const data = await fetchPackages();
    if (!data) {
        return { content: [{ type: 'text', text: '无法获取包列表' }], isError: true };
    }
    const items = flattenPackages(data);
    const results = [];
    if (query) {
        const q = query.toLowerCase();
        for (const p of items) {
            const name = (p.name || '').toLowerCase();
            const desc = (p.description || '').toLowerCase();
            if (name.includes(q) || desc.includes(q)) results.push(p);
        }
    } else {
        for (const p of items) results.push(p);
    }
    if (results.length === 0) {
        return { content: [{ type: 'text', text: `未找到包含 "${query}" 的包` }] };
    }
    return { content: [{ type: 'text', text: `搜索结果 (${results.length}):\n${results.map(p => `${p.name} v${p.version || ''} - ${p.description || ''}`).join('\n')}` }] };
}

/* 安装是**异步**的：`@::package-install` 只发起下载/解包，真正可用要等
 * 包出现在 `@::package-list-in-local` 里。旧实现发完命令就回「已发送」，
 * 调用方紧接着调用包函数只有一个结果——`no function definition`
 * （2026-10-25：at-pm 装了但设计团队查不到，只能重新生成图框代码）。
 *
 * 所以这里等到「包已安装」再回，并顺手把包加载进当前文档。等待有上限，
 * 超时如实报错并把下一步写清楚。
 */
const INSTALL_POLL_MS = 2000;

function installWaitMs() {
    return Number(process.env.PACKAGE_INSTALL_WAIT_MS || 60000);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function packageInstalled(packageName) {
    try {
        const raw = await cad.sendCommandWithResult('(vl-prin1-to-string (@::package-list-in-local))');
        const text = String(raw || '');
        const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\(:NAME\\s*\\.\\s*"?${escaped}"?\\)`, 'i').test(text);
    } catch {
        return false;
    }
}

async function waitForInstall(packageName) {
    const deadline = Date.now() + installWaitMs();
    while (Date.now() < deadline) {
        if (await packageInstalled(packageName)) return true;
        await sleep(INSTALL_POLL_MS);
    }
    return false;
}

export async function installPackage(packageName) {
    const name = String(packageName || '').trim();
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
        return { content: [{ type: 'text', text: `错误: 包名不合法 "${name}"` }], isError: true };
    }

    const data = await fetchPackages();
    const items = flattenPackages(data);
    const pkg = items.find(p => p.name === name);
    if (!pkg) {
        return { content: [{ type: 'text', text: `错误: 包 "${name}" 不存在` }], isError: true };
    }
    if (!cad.connected) await cad.connect();
    if (!cad.connected) {
        return { content: [{ type: 'text', text: `错误: CAD 未连接，无法安装 "${name}"` }], isError: true };
    }

    /* 已经装了就直接加载，不重复下载。 */
    if (await packageInstalled(name)) {
        await cad.sendCommand(`(progn (@::load-module 'pkgman) (@::load-pkg "${name}" (quote ())) (princ))\n`);
        return { content: [{ type: 'text', text: `包 "${name}" 已安装，已重新加载。` }] };
    }

    /* 包安装走的是 `@::package-install`（包管理器模块里的高层 API）。
       `@::load-module` 是**内核模块**加载器，对包名只会返回一个 T，什么也不装
       ——旧实现就是把它当成安装用的。 */
    await cad.sendCommand(`(progn (@::load-module 'pkgman) (@::package-install "${name}") (princ))\n`);

    const ok = await waitForInstall(name);
    if (!ok) {
        return {
            content: [{ type: 'text', text: `包 "${name}" 安装超时（${Math.round(installWaitMs() / 1000)} 秒内未完成）。请检查 CAD 网络/包管理器状态后重试。` }],
            isError: true,
        };
    }

    await cad.sendCommand(`(progn (@::load-module 'pkgman) (@::load-pkg "${name}" (quote ())) (princ))\n`);
    return { content: [{ type: 'text', text: `包 "${name}" 已安装并加载。` }] };
}
