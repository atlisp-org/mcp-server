import { log, error as logError } from '../logger.js';
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

export async function installPackage(packageName) {
    const data = await fetchPackages();
    const items = flattenPackages(data);
    const pkg = items.find(p => p.name === packageName);
    if (!pkg) {
        return { content: [{ type: 'text', text: `错误: 包 "${packageName}" 不存在` }], isError: true };
    }
    if (cad.connected) {
        await cad.sendCommand(`(@::load-module '${packageName})\n`);
    }
    return { content: [{ type: 'text', text: `包 "${packageName}" 安装命令已发送！` }] };
}
