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

export function getCustomHandlers() {
    return customHandlers;
}

export function getCustomToolNames() {
    return customTools.map(t => t.name);
}

export function callCustomTool(name, args) {
    const handler = customHandlers.get(name);
    if (!handler) {
        return null;
    }
    return handler(args || {});
}
