import { createHash } from 'node:crypto';
import config from './config.js';
import { log } from './logger.js';

/**
 * 破坏性操作确认（MCP elicitation）。
 *
 * 兼容性红线：默认 off，且客户端未声明 elicitation 能力时直接放行（等价于旧行为）。
 * 只有显式开启 ELICITATION_MODE=destructive|all 才可能弹确认。
 */

const CACHE_TTL_MS = 5 * 60 * 1000;
const confirmCache = new Map(); // key -> expiresAt

function mode() {
  const raw = String(config?.elicitationMode || process.env.ELICITATION_MODE || 'off').toLowerCase();
  return ['off', 'destructive', 'all'].includes(raw) ? raw : 'off';
}

function enabled() {
  return mode() !== 'off';
}

function clientSupports(server) {
  try {
    return Boolean(server?.getClientCapabilities?.()?.elicitation);
  } catch {
    return false;
  }
}

function cacheKey(sessionId, toolName, args) {
  const hash = createHash('sha256')
    .update(`${sessionId}|${toolName}|${JSON.stringify(args || {})}`)
    .digest('hex');
  return `elicit:${hash}`;
}

function readCache(key) {
  const expiresAt = confirmCache.get(key);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    confirmCache.delete(key);
    return false;
  }
  return true;
}

function writeCache(key) {
  confirmCache.set(key, Date.now() + CACHE_TTL_MS);
  if (confirmCache.size > 500) {
    const now = Date.now();
    for (const [k, exp] of confirmCache) {
      if (now > exp) confirmCache.delete(k);
    }
  }
}

function summarize(toolName, args) {
  const keys = Object.keys(args || {});
  const preview = keys.slice(0, 6).map((k) => {
    const v = args[k];
    if (typeof v === 'string') return `${k}="${v.length > 40 ? `${v.slice(0, 40)}…` : v}"`;
    if (Array.isArray(v)) return `${k}=[${v.length} 项]`;
    return `${k}=${String(v)}`;
  }).join(', ');
  const more = keys.length > 6 ? ' …' : '';
  return preview ? `参数：${preview}${more}` : '无参数';
}

/**
 * 请求用户确认。
 * @returns {Promise<{action: 'skip'|'accepted'|'declined'|'unavailable', reason?: string}>}
 */
export async function confirmDestructive(server, {
  toolName,
  args = {},
  isDestructive = false,
  sessionId = '',
  timeoutMs = 60000,
} = {}) {
  const currentMode = mode();
  if (currentMode === 'off') return { action: 'skip', reason: 'elicitation disabled' };
  if (currentMode === 'destructive' && !isDestructive) return { action: 'skip', reason: 'not destructive' };
  if (!clientSupports(server)) return { action: 'unavailable', reason: 'client has no elicitation capability' };

  const key = cacheKey(sessionId, toolName, args);
  if (readCache(key)) return { action: 'accepted', reason: 'cached confirmation' };

  const message = [
    `即将执行破坏性操作：${toolName}`,
    summarize(toolName, args),
    '该操作可能无法撤销，是否继续？',
  ].join('\n');

  try {
    const result = await server.elicitInput({
      message,
      requestedSchema: {
        type: 'object',
        properties: {
          confirm: {
            type: 'boolean',
            title: '确认执行',
            description: '勾选后继续执行该破坏性操作',
            default: false,
          },
        },
        required: ['confirm'],
      },
    }, { timeout: timeoutMs });

    if (result?.action === 'accept' && result?.content?.confirm === true) {
      writeCache(key);
      log(`[elicitation] ${toolName} 已由用户确认`);
      return { action: 'accepted' };
    }
    log(`[elicitation] ${toolName} 被用户拒绝 (${result?.action || 'unknown'})`);
    return { action: 'declined', reason: result?.action || 'declined' };
  } catch (e) {
    // 客户端声称支持但请求失败（旧实现/超时/连接断开）：按兼容红线放行。
    log(`[elicitation] 请求确认失败，降级放行: ${e.message}`);
    return { action: 'unavailable', reason: e.message };
  }
}

/** 测试用：清空确认缓存。 */
export function clearElicitationCache() {
  confirmCache.clear();
}

export function elicitationEnabled() {
  return enabled();
}

export function elicitationMode() {
  return mode();
}
