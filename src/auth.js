// Role-Based Access Control
const ROLES = {
  admin: { priority: 100, can: ['*'] },
  operator: { priority: 50, can: ['read', 'write', 'export', 'import', 'batch'] },
  viewer: { priority: 10, can: ['read', 'list'] },
};

// Tool permission mapping: tool name pattern -> required permission
const TOOL_PERMISSIONS = {
  // Read-only tools
  'get_*': 'read',
  'list_*': 'read',
  'search_*': 'read',
  'measure_*': 'read',
  'stream_*': 'read',
  'watch_list': 'read',


  // Write tools
  'create_*': 'write',
  'set_*': 'write',
  'delete_*': 'write',
  'add_*': 'write',
  'insert_*': 'write',
  'explode_*': 'write',
  'attach_*': 'write',
  'detach_*': 'write',
  'reload_*': 'write',
  'bind_*': 'write',
  'clip_*': 'write',
  'path_*': 'write',
  'batch_*': 'batch',
  // Export/Import
  'export_*': 'export',
  'import_*': 'import',
  // Admin
  'config_*': 'admin',

  'webhook_*': 'admin',
  'watch_remove': 'admin',
};

export function getRolePriority(role) {
  return ROLES[role]?.priority || 0;
}

export function getToolPermission(toolName) {
  // Exact match first
  for (const [pattern, perm] of Object.entries(TOOL_PERMISSIONS)) {
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      if (toolName.startsWith(prefix)) return perm;
    } else if (pattern === toolName) {
      return perm;
    }
  }
  return 'read'; // Default: read-only
}

export function canAccess(role, toolName) {
  const roleDef = ROLES[role];
  if (!roleDef) return false;
  if (roleDef.can.includes('*')) return true;
  const required = getToolPermission(toolName);
  return roleDef.can.includes(required);
}

export function getRole(name) {
  return ROLES[name] || ROLES.viewer;
}

export function getApiKeyRole(apiKey, config) {
  // Check config.apiKeys for matching key
  if (config.apiKeys && Array.isArray(config.apiKeys)) {
    const found = config.apiKeys.find(k => k.key === apiKey);
    if (found) return found.role || 'operator';
  }
  // Default based on whether API key auth is enabled
  if (config.apiKey && apiKey === config.apiKey) return 'admin';
  if (!config.apiKey) return 'admin'; // No auth = full access
  return 'viewer';
}

export { ROLES };
