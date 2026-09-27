// @ts-check
import { toolsByName } from './tools/index.js';
import peerProxy from './peer-proxy.js';
import { error as logError } from './logger.js';

/** 本地管理/计算/编排工具：永不转发到 peer */
const NON_FORWARDABLE = new Set([
  'search_tools', 'list_tools_by_category', 'list_tools_by_industry',
  'list_tools_by_priority', 'get_tool_info', 'list_prompts', 'get_prompt',
  'analyze_lisp_code', 'format_lisp_code', 'lint_project',
  'list_standards', 'load_standards', 'save_standards', 'compare_standards',
  'batch_concurrent_tasks',
]);

const NON_FORWARDABLE_PREFIXES = [
  'peer_', 'skill_', 'webhook_', 'sandbox_', 'audit_', 'debug_',
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
 * 获取当前配置且可用于自动转发的远程 peer（需 config.remotePeer.autoForward 开启）
 * @returns {{id: string, host: string, port: number, url: string}|null}
 */
export async function getAutoForwardPeer() {
  try {
    const { default: config } = await import('./config.js');
    const rp = config.remotePeer;
    if (!rp || !rp.host || !rp.autoForward) return null;
    const { default: peerManager } = await import('./peer-manager.js');
    const peer = peerManager.getRemotePeer();
    if (!peer) {
      logError(`[peer-forward] remotePeer 已配置 (${rp.host}:${rp.port}) 但未注册到 peer manager`);
      return null;
    }
    return peer;
  } catch (e) {
    logError(`[peer-forward] getAutoForwardPeer 失败: ${e.message}`);
    return null;
  }
}
