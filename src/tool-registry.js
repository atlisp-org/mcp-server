import { tools } from './tools/index.js';

const customTools = [];
const customHandlers = new Map();

export function registerTool(toolDef, handler) {
    if (!toolDef || !toolDef.name) {
        throw new Error('Tool definition must have a name');
    }
    if (customHandlers.has(toolDef.name)) {
        throw new Error(`Tool "${toolDef.name}" is already registered`);
    }
    customTools.push(toolDef);
    customHandlers.set(toolDef.name, handler);
    tools.push(toolDef);
    return true;
}

export function callCustomTool(name, args) {
    const handler = customHandlers.get(name);
    if (!handler) {
        return null;
    }
    return handler(args || {});
}

/**
 * 注销插件动态注册的工具（热重载/卸载时使用）。
 * 只处理通过 registerTool 注册的自定义工具，内置工具不受影响。
 * @param {string} name
 * @returns {boolean} 是否找到并移除
 */
export function unregisterTool(name) {
    const handlerRemoved = customHandlers.delete(name);
    const idx = customTools.findIndex(t => t && t.name === name);
    if (idx !== -1) customTools.splice(idx, 1);
    let toolRemoved = false;
    for (let i = tools.length - 1; i >= 0; i--) {
        if (tools[i] && tools[i].name === name) {
            tools.splice(i, 1);
            toolRemoved = true;
        }
    }
    return handlerRemoved || idx !== -1 || toolRemoved;
}
