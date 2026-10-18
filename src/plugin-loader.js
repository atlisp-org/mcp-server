import fs from 'fs';
import path from 'path';
import os from 'os';
import { log, error as logError } from './logger.js';
// 注意：不要在模块顶层 import tool-registry —— 它会拉起 tools/index（含全部工具 schema），
// 而 plugin-loader 被 cad.js 引用，顶层引入会拖慢 CAD 模块加载与测试。
// 工具回收只在热重载/卸载时按需动态 import。

const PLUGIN_DIR = path.join(os.homedir(), '.atlisp', 'mcp-plugins');

let loadedPlugins = [];
const watchCallbacks = [];
let watcher = null;
/** 正在重载的文件，避免 fs.watch 对同一次保存连发 rename/change 时重复 import */
const reloadingFiles = new Set();
/** 每个插件通过 context.registerTool 注册的工具名，卸载时用于回收 */
const pluginTools = new WeakMap();

export function getPluginDir() {
    return PLUGIN_DIR;
}

export function onPluginChange(callback) {
    watchCallbacks.push(callback);
}

function notifyChange(type, name) {
    for (const cb of watchCallbacks) {
        try { cb(type, name); } catch (e) { logError(`Plugin change callback error: ${e.message}`); }
    }
}

// ESM 没有 require.cache；热重载靠 import 的 `?t=` 查询串绕过模块缓存。
// （旧实现用 require.cache，在纯 ESM 运行时会抛 ReferenceError，导致所有插件加载失败。）

export async function loadSinglePlugin(file) {
    const pluginPath = path.join(PLUGIN_DIR, file);
    try {
        const plugin = await import(`${pluginPath}?t=${Date.now()}`);
        if (plugin.default && typeof plugin.default.setup === 'function') {
            plugin.default._file = file;
            return plugin.default;
        }
        logError(`Plugin ${file} has no default.setup() export`);
        return null;
    } catch (e) {
        logError(`Failed to load plugin ${file}: ${e.message}`);
        return null;
    }
}

export async function loadPlugins() {
    // 重新扫描前先卸载旧实例，回收它们动态注册的工具
    for (const plugin of loadedPlugins) await callOnUnload(plugin);
    loadedPlugins = [];
    try {
        if (!fs.existsSync(PLUGIN_DIR)) {
            fs.mkdirSync(PLUGIN_DIR, { recursive: true });
            return [];
        }
        const files = fs.readdirSync(PLUGIN_DIR).filter(f => f.endsWith('.js') && !f.startsWith('_'));
        for (const file of files) {
            const plugin = await loadSinglePlugin(file);
            if (plugin) loadedPlugins.push(plugin);
        }
    } catch (e) {
        logError(`Plugin directory error: ${e.message}`);
    }
    return loadedPlugins;
}

export function getPlugins() {
    return loadedPlugins;
}

/** 最近一次 initPlugins(context) 的上下文：热重载的新插件也需要它才能完成 onInit 注册 */
let lastInitContext = null;

function callOnInit(plugin) {
    if (!lastInitContext || typeof plugin.onInit !== 'function') return;
    // 为每个插件包一层 registerTool，记录它注册了哪些工具，
    // 这样热重载/卸载时能精确回收，不会误删别的插件或内置工具。
    const base = lastInitContext;
    const context = typeof base.registerTool === 'function'
        ? {
            ...base,
            registerTool: (toolDef, handler) => {
                const ok = base.registerTool(toolDef, handler);
                if (ok !== false && toolDef?.name) {
                    const names = pluginTools.get(plugin) || new Set();
                    names.add(toolDef.name);
                    pluginTools.set(plugin, names);
                }
                return ok;
            },
        }
        : base;
    try {
        plugin.onInit(context);
    } catch (e) {
        logError(`Plugin init error [${plugin.name}]: ${e.message}`);
    }
}

/** 卸载前清理（可选钩子），并回收该插件注册的工具 */
async function callOnUnload(plugin) {
    if (!plugin) return;
    const names = pluginTools.get(plugin);
    if (names && names.size > 0) {
        try {
            const { unregisterTool } = await import('./tool-registry.js');
            for (const name of names) {
                try {
                    unregisterTool(name);
                } catch (e) {
                    logError(`Plugin tool cleanup error [${plugin.name}/${name}]: ${e.message}`);
                }
            }
        } catch (e) {
            logError(`Plugin tool cleanup error [${plugin.name}]: ${e.message}`);
        }
        pluginTools.delete(plugin);
    }
    if (typeof plugin.onUnload !== 'function') return;
    try {
        plugin.onUnload();
    } catch (e) {
        logError(`Plugin unload error [${plugin.name}]: ${e.message}`);
    }
}

export function initPlugins(context) {
    lastInitContext = context;
    for (const plugin of loadedPlugins) {
        callOnInit(plugin);
    }
}

export function callPluginHook(hook, ...args) {
    const results = [];
    if (loadedPlugins.length === 0) return results;
    for (const plugin of loadedPlugins) {
        if (typeof plugin[hook] === 'function') {
            try {
                const r = plugin[hook](...args);
                // 钩子可以是 async：吞掉 rejection，避免未处理拒绝杀死进程
                if (r && typeof r.then === 'function') {
                    r.catch((e) => logError(`Plugin hook error [${plugin.name}.${hook}]: ${e.message}`));
                }
                results.push({ plugin: plugin.name || 'unknown', result: r });
            } catch (e) {
                logError(`Plugin hook error [${plugin.name}.${hook}]: ${e.message}`);
                results.push({ plugin: plugin.name || 'unknown', error: e.message });
            }
        }
    }
    return results;
}

/**
 * Start watching the plugin directory for changes.
 * Automatically loads new/updated plugins and removes deleted ones.
 */
export function startPluginWatcher() {
    if (watcher) return;
    try {
        if (!fs.existsSync(PLUGIN_DIR)) {
            fs.mkdirSync(PLUGIN_DIR, { recursive: true });
        }
        watcher = fs.watch(PLUGIN_DIR, async (eventType, filename) => {
            if (!filename || !filename.endsWith('.js') || filename.startsWith('_')) return;
            // rename = 新增/删除，change = 原地保存（多数编辑器的默认保存方式）
            if (eventType !== 'rename' && eventType !== 'change') return;
            if (reloadingFiles.has(filename)) return;
            reloadingFiles.add(filename);

            try {
                const filePath = path.join(PLUGIN_DIR, filename);
                const existingIndex = loadedPlugins.findIndex(
                    (p) => p._file === filename || p.name === filename.replace(/\.js$/, '')
                );

                if (!fs.existsSync(filePath)) {
                    if (existingIndex !== -1) {
                        const [removed] = loadedPlugins.splice(existingIndex, 1);
                        await callOnUnload(removed);
                        log(`Plugin removed: ${filename}`);
                        notifyChange('remove', filename);
                    }
                    return;
                }

                const plugin = await loadSinglePlugin(filename);
                if (!plugin) return;
                if (existingIndex !== -1) {
                    await callOnUnload(loadedPlugins[existingIndex]);
                    loadedPlugins[existingIndex] = plugin;
                    // 热重载后重新执行 onInit，否则新实例不会注册工具/恢复事件订阅
                    callOnInit(plugin);
                    log(`Plugin reloaded: ${plugin.name || filename}`);
                    notifyChange('update', filename);
                } else {
                    loadedPlugins.push(plugin);
                    callOnInit(plugin);
                    log(`Plugin loaded: ${plugin.name || filename}`);
                    notifyChange('add', filename);
                }
            } catch (e) {
                logError(`Plugin watcher reload error [${filename}]: ${e.message}`);
            } finally {
                reloadingFiles.delete(filename);
            }
        });
        log(`Plugin watcher started on ${PLUGIN_DIR}`);
    } catch (e) {
        logError(`Plugin watcher error: ${e.message}`);
    }
}

export function stopPluginWatcher() {
    if (watcher) {
        watcher.close();
        watcher = null;
        log('Plugin watcher stopped');
    }
}
