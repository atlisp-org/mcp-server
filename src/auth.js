import { timingSafeEqual } from 'crypto';

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

// 常量时间字符串比较，避免 API Key 校验被时序侧信道探测
export function safeKeyEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  try {
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

/**
 * 统一的鉴权解析：返回角色字符串，未通过返回 null。
 * - 未配置任何 key（apiKey 为空且 apiKeys 为空）→ 'admin'（向后兼容的本地开放模式）
 * - key 匹配 apiKey → 'admin'
 * - key 匹配 apiKeys 中的某项 → 该项的 role（默认 operator）
 * - 其余 → null
 */
export function resolveApiKeyRole(apiKey, cfg = {}) {
  if (apiKey) {
    if (cfg.apiKey && safeKeyEqual(apiKey, cfg.apiKey)) return 'admin';
    if (Array.isArray(cfg.apiKeys)) {
      for (const k of cfg.apiKeys) {
        if (k && safeKeyEqual(apiKey, k.key)) return k.role || 'operator';
      }
    }
  }
  if (!cfg.apiKey && (!cfg.apiKeys || cfg.apiKeys.length === 0)) return 'admin';
  return null;
}

export function isAuthConfigured(cfg = {}) {
  return Boolean(cfg.apiKey) || (Array.isArray(cfg.apiKeys) && cfg.apiKeys.length > 0);
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
  const role = resolveApiKeyRole(apiKey, config);
  if (role) return role;
  // 鉴权未配置 → 'admin'（本地开放），由 resolveApiKeyRole 已覆盖；
  // 配置了但 key 不匹配 → 'viewer'（保持历史返回值语义）
  if (!isAuthConfigured(config)) return 'admin';
  return 'viewer';
}

export { ROLES };
