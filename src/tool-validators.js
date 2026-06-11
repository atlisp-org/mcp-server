import { toolsByName } from './tools/index.js';

export function validateToolArgs(name, args) {
    const toolDef = toolsByName.get(name);
    if (!toolDef) {
        throw new Error(`Unknown tool: ${name}`);
    }
    const schema = toolDef.inputSchema;
    if (!schema || !schema.properties) return true;

    const props = schema.properties || {};
    const required = schema.required || [];

    for (const [key, prop] of Object.entries(props)) {
        const isOptional = !required.includes(key);
        const val = args[key];
        if (val === undefined || val === null) {
            if (isOptional) continue;
            throw new Error(`Missing required argument: ${key}`);
        }
        const actualType = typeof val;
        const expectedType = prop.type || 'string';

        if (expectedType === 'string' && actualType !== 'string') {
            throw new Error(`Invalid type for argument ${key}: expected string, got ${actualType}`);
        }
        if ((expectedType === 'object' || expectedType === 'array') && (actualType !== 'object' || val === null)) {
            throw new Error(`Invalid type for argument ${key}: expected ${expectedType}, got ${actualType}`);
        }
        if (expectedType === 'array' && !Array.isArray(val)) {
            throw new Error(`Invalid type for argument ${key}: expected array, got ${actualType}`);
        }
        if (expectedType === 'object' && Array.isArray(val)) {
            throw new Error(`Invalid type for argument ${key}: expected object, got array`);
        }
        if ((expectedType === 'number' || expectedType === 'integer') && actualType !== 'number') {
            throw new Error(`Invalid type for argument ${key}: expected number, got ${actualType}`);
        }
        if (expectedType === 'boolean' && actualType !== 'boolean') {
            throw new Error(`Invalid type for argument ${key}: expected boolean, got ${actualType}`);
        }
        if (prop.enum && !prop.enum.includes(val)) {
            throw new Error(`Invalid value for argument ${key}: must be one of ${prop.enum.join(', ')}`);
        }
        if (expectedType === 'string' && typeof prop.maxLength === 'number' && val.length > prop.maxLength) {
            throw new Error(`Argument ${key} exceeds max length of ${prop.maxLength}`);
        }
        if ((expectedType === 'number' || expectedType === 'integer') && prop.minimum != null && val < prop.minimum) {
            throw new Error(`Argument ${key} must be >= ${prop.minimum}`);
        }
        if ((expectedType === 'number' || expectedType === 'integer') && prop.maximum != null && val > prop.maximum) {
            throw new Error(`Argument ${key} must be <= ${prop.maximum}`);
        }
    }
    for (const req of required) {
        if (!(req in (args || {}))) {
            throw new Error(`Missing required argument: ${req}`);
        }
    }
    return true;
}
