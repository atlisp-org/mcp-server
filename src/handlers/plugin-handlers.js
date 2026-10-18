// 插件管理工具处理器：查看已加载插件、手动重载。
import { getPlugins, getPluginTools, reloadPlugins } from '../plugin-loader.js';
import { mcpError } from '../handler-utils.js';

const KNOWN_HOOKS = [
    'onInit', 'onUnload', 'onToolCall', 'onToolExecuted',
    'onCadConnected', 'onCadDisconnected', 'onDocumentChanged', 'onError',
];

function summarize(plugin) {
    return {
        name: plugin.name || plugin._file || 'unknown',
        file: plugin._file || '',
        hooks: KNOWN_HOOKS.filter(h => typeof plugin[h] === 'function'),
        tools: getPluginTools(plugin),
    };
}

function result(data) {
    return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
    };
}

export async function pluginList() {
    const plugins = getPlugins().map(summarize);
    return result({ count: plugins.length, plugins });
}

export async function pluginReload() {
    try {
        const count = await reloadPlugins();
        return result({ count, plugins: getPlugins().map(p => p.name || p._file || 'unknown') });
    } catch (e) {
        return mcpError(`插件重载失败: ${e.message}`);
    }
}
