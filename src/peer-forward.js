// @ts-check
import { toolsByName } from './tools/index.js';
import peerProxy from './peer-proxy.js';
import { log, error as logError } from './logger.js';

/** 本地管理/计算/编排工具：永不转发到 peer */
const NON_FORWARDABLE = new Set([
  'search_tools', 'list_tools_by_category', 'list_tools_by_industry',
  'list_tools_by_priority', 'get_tool_info', 'list_prompts', 'get_prompt',
  'analyze_lisp_code', 'format_lisp_code', 'lint_project',
  'list_standards', 'load_standards', 'save_standards', 'compare_standards',
  'batch_concurrent_tasks',
]);

const NON_FORWARDABLE_PREFIXES = [
  'peer_', 'skill_', 'plugin_', 'webhook_', 'sandbox_', 'audit_', 'debug_',
  'agent_', 'session_', 'watch_', 'lisp_repl',
];

/**
 * 判断工具是否可转发到远程 peer（业务工具允许，本地管理/计算工具拒绝）
 * @param {string} name
 * @returns {boolean}
 */
export function isForwardableTool(name) {
  if (!name || typeof name !== 'string') return false;
  if (!toolsByName.has(name)) return false;
  if (NON_FORWARDABLE.has(name)) return false;
  return !NON_FORWARDABLE_PREFIXES.some(p => name.startsWith(p));
}

/**
 * 转发工具调用到远程 peer，结果包装为 MCP content（保留远端 isError 等字段）
 * @param {string} peerId - Peer ID 或 URL
 * @param {string} tool - 工具名
 * @param {Record<string, any>} [args] - 工具参数
 * @param {{ timeout?: number, apikey?: string }} [options]
 * @returns {Promise<{content: {type: string, text: string}[], isError?: boolean}>}
 */
export async function forwardToolCall(peerId, tool, args = {}, options = {}) {
  const result = await peerProxy.forwardToolCall(peerId, tool, args, options);
  const remote = result && typeof result === 'object' ? result : { content: [{ type: 'text', text: String(result) }] };
  const content = [
    { type: 'text', text: `[远程执行] ${tool} @ ${peerId}` },
    ...(Array.isArray(remote.content) ? remote.content : []),
  ];
  return { ...remote, content };
}

/**
 * 自动选路：决定 CAD_NOT_CONNECTED 时的转发目标。
 *
 * 优先级：
 * 1. config.remotePeer 指定的固定 peer（若当前可用：健康且熔断 closed/half-open）
 * 2. config.remotePeer.host === 'auto'（或固定 peer 不可用）时，
 *    在所有可用 peer 中按时延 EWMA 最低者选路
 * 3. 无可用 peer → 返回 null（打印清晰错误提示）
 *
 * @returns {Promise<{id: string, host: string, port: number, url: string}|null>}
 */
export async function getAutoForwardPeer() {
  try {
    const { default: config } = await import('./config.js');
    const rp = config.remotePeer;
    if (!rp) return null;
    const autoMode = rp.host === 'auto';
    if (!autoMode && !rp.autoForward) return null;

    const { default: peerManager } = await import('./peer-manager.js');

    if (!autoMode) {
      const preferred = peerManager.getRemotePeer();
      if (preferred && peerManager.isPeerRoutable(preferred)) return preferred;
      if (preferred) {
        const state = peerManager.getCircuitState(preferred) || 'unknown';
        logError(`[peer-forward] 配置的 remotePeer (${preferred.url}) 当前不可用（熔断=${state}, 健康=${preferred.healthy}），降级为自动选路`);
      } else {
        logError(`[peer-forward] remotePeer 已配置 (${rp.host}:${rp.port}) 但未注册到 peer manager`);
      }
    }

    const best = peerManager.selectBestPeer();
    if (best) {
      const ewma = typeof best.latencyEwma === 'number' ? `${Math.round(best.latencyEwma)}ms` : '未知';
      log(`[peer-forward] 自动选路: ${best.id} (${best.url}) 时延EWMA=${ewma}`);
      return best;
    }

    logError('[peer-forward] 无可用 peer 自动转发：没有健康且熔断关闭（closed/half-open）的 peer，请检查 peer_list / peer_scan');
    return null;
  } catch (e) {
    logError(`[peer-forward] getAutoForwardPeer 失败: ${e.message}`);
    return null;
  }
}
