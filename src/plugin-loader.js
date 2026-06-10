import fs from 'fs';
import path from 'path';
import os from 'os';
import { log, error as logError } from './logger.js';

const PLUGIN_DIR = path.join(os.homedir(), '.atlisp', 'mcp-plugins');

let loadedPlugins = [];
let watchCallbacks = [];
let watcher = null;

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

function clearModuleCache(pluginPath) {
    const resolved = require?.resolve?.(pluginPath);
    if (resolved && delete require.cache[resolved]) {
        delete require.cache[resolved];
    }
    // Also clear from import cache
    const key = Object.keys(import.meta).find(k => import.meta[k] === pluginPath);
    if (key) delete import.meta[key];
}

export async function loadSinglePlugin(file) {
    const pluginPath = path.join(PLUGIN_DIR, file);
    clearModuleCache(pluginPath);
    try {
        const plugin = await import(`${pluginPath}?t=${Date.now()}`);
        if (plugin.default && typeof plugin.default.setup === 'function') {
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

export function initPlugins(context) {
    for (const plugin of loadedPlugins) {
        try {
            if (typeof plugin.onInit === 'function') plugin.onInit(context);
        } catch (e) {
            logError(`Plugin init error [${plugin.name}]: ${e.message}`);
        }
    }
}

export function callPluginHook(hook, ...args) {
    const results = [];
    for (const plugin of loadedPlugins) {
        if (typeof plugin[hook] === 'function') {
            try {
                const r = plugin[hook](...args);
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

            const existingIndex = loadedPlugins.findIndex(p => p.name === filename.replace('.js', '') || p._file === filename);

            if (eventType === 'rename') {
                // Check if file was deleted or added
                const filePath = path.join(PLUGIN_DIR, filename);
                if (!fs.existsSync(filePath)) {
                    // Deleted
                    if (existingIndex !== -1) {
                        loadedPlugins.splice(existingIndex, 1);
                        log(`Plugin removed: ${filename}`);
                        notifyChange('remove', filename);
                    }
                } else {
                    // Added or updated
                    const plugin = await loadSinglePlugin(filename);
                    if (plugin) {
                        plugin._file = filename;
                        if (existingIndex !== -1) {
                            loadedPlugins[existingIndex] = plugin;
                            log(`Plugin reloaded: ${plugin.name || filename}`);
                        } else {
                            loadedPlugins.push(plugin);
                            log(`Plugin loaded: ${plugin.name || filename}`);
                        }
                        notifyChange('add', filename);
                    }
                }
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
