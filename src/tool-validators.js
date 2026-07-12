import { toolsByName } from './tools/index.js';
import { MCPError, ERROR_CODES } from './errors.js';

function validationError(msg) {
    return new MCPError(ERROR_CODES.INVALID_ARGS, msg);
}

function validateProps(args, props, required, path = '') {
  for (const [key, prop] of Object.entries(props)) {
    const fullKey = path ? `${path}.${key}` : key;
    const isOptional = !required.includes(key);
    const val = args[key];

    if (val === undefined || val === null) {
      if (isOptional) continue;
      throw validationError(`Missing required argument: ${fullKey}`);
    }

    if (prop.type === 'object' && prop.properties && typeof val === 'object' && !Array.isArray(val)) {
      const subRequired = prop.required || [];
      validateProps(val, prop.properties, subRequired, fullKey);
    }

    if (prop.type === 'array' && prop.items?.type === 'object' && prop.items.properties && Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        const itemRequired = prop.items.required || [];
        validateProps(val[i], prop.items.properties, itemRequired, `${fullKey}[${i}]`);
      }
    }

    const actualType = typeof val;
    const expectedType = prop.type || 'string';

    if (expectedType === 'string' && actualType !== 'string' && actualType !== 'number') {
      throw validationError(`Invalid type for argument ${fullKey}: expected string, got ${actualType}`);
    }
    if ((expectedType === 'object' || expectedType === 'array') && (actualType !== 'object' || val === null)) {
      throw validationError(`Invalid type for argument ${fullKey}: expected ${expectedType}, got ${actualType}`);
    }
    if (expectedType === 'array' && !Array.isArray(val)) {
      throw validationError(`Invalid type for argument ${fullKey}: expected array, got ${actualType}`);
    }
    if (expectedType === 'object' && Array.isArray(val)) {
      throw validationError(`Invalid type for argument ${fullKey}: expected object, got array`);
    }
    if ((expectedType === 'number' || expectedType === 'integer') && actualType !== 'number') {
      if (expectedType === 'integer' && !Number.isInteger(val)) {
        throw validationError(`Invalid type for argument ${fullKey}: expected integer, got ${actualType}`);
      }
      if (expectedType === 'number') {
        throw validationError(`Invalid type for argument ${fullKey}: expected number, got ${actualType}`);
      }
    }
    if (expectedType === 'boolean' && actualType !== 'boolean') {
      throw validationError(`Invalid type for argument ${fullKey}: expected boolean, got ${actualType}`);
    }
    if (prop.enum && !prop.enum.includes(val)) {
      throw validationError(`Invalid value for argument ${fullKey}: must be one of ${prop.enum.join(', ')}`);
    }
    if (expectedType === 'string' && typeof prop.maxLength === 'number' && String(val).length > prop.maxLength) {
      throw validationError(`Argument ${fullKey} exceeds max length of ${prop.maxLength}`);
    }
    if ((expectedType === 'number' || expectedType === 'integer') && prop.minimum != null && val < prop.minimum) {
      throw validationError(`Argument ${fullKey} must be >= ${prop.minimum}`);
    }
    if ((expectedType === 'number' || expectedType === 'integer') && prop.maximum != null && val > prop.maximum) {
      throw validationError(`Argument ${fullKey} must be <= ${prop.maximum}`);
    }
  }
}

export function validateToolArgs(name, args) {
  const toolDef = toolsByName.get(name);
  if (!toolDef) {
    throw validationError(`Unknown tool: ${name}`);
  }
  const schema = toolDef.inputSchema;
  if (!schema || !schema.properties) return true;

  const props = schema.properties || {};
  const required = schema.required || [];

  for (const req of required) {
    if (!(req in (args || {}))) {
      throw validationError(`Missing required argument: ${req}`);
    }
  }

  validateProps(args || {}, props, required);
  return true;
}
