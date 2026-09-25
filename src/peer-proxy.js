// @ts-check
import peerManager from './peer-manager.js';
import config from './config.js';

const DEFAULT_TIMEOUT = 30000;

/**
 * PeerProxy: 转发 MCP 命令到远程 peer
 */
class PeerProxy {
  /**
   * 转发 MCP 请求到指定 peer
   * @param {string} peerId - Peer ID 或 URL
   * @param {object} request - MCP JSON-RPC 请求
   * @param {object} [options] - 选项
   * @param {number} [options.timeout] - 超时时间
   * @param {string} [options.apikey] - API Key
   */
  async forward(peerId, request, options = {}) {
    const peer = this._resolvePeer(peerId);
    if (!peer) {
      throw new Error(`Peer not found: ${peerId}`);
    }

    if (!peer.healthy) {
      throw new Error(`Peer unhealthy: ${peer.hostname} (${peer.url})`);
    }

    const url = `${peer.url}/mcp`;
    const timeout = options.timeout || DEFAULT_TIMEOUT;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      };

      const apikey = options.apikey || peer.apikey || config.apiKey;
      if (apikey) {
        headers['Authorization'] = `Bearer ${apikey}`;
      }

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const contentType = res.headers.get('content-type') || '';
      const text = await res.text();

      if (contentType.includes('text/event-stream')) {
        return this._parseSSE(text);
      }

      return JSON.parse(text);
    } catch (e) {
      if (e.name === 'AbortError') {
        throw new Error(`Peer request timeout: ${peer.url}`, { cause: e });
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 转发工具调用到远程 peer
   * @param {string} peerId - Peer ID
   * @param {string} toolName - 工具名称
   * @param {object} args - 工具参数
   */
  async forwardToolCall(peerId, toolName, args) {
    const request = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args,
      },
    };

    const result = await this.forward(peerId, request);

    if (result.error) {
      throw new Error(result.error.message || 'Tool call failed');
    }

    return result.result;
  }

  /**
   * 转发 eval_lisp 到远程 peer
   * @param {string} peerId - Peer ID
   * @param {string} code - LISP 代码
   * @param {object} [options] - 选项
   */
  async forwardEvalLisp(peerId, code, options = {}) {
    return this.forwardToolCall(peerId, 'eval_lisp_with_result', {
      code,
      encoding: options.encoding,
    });
  }

  /**
   * 获取远程 peer 的 CAD 连接池信息
   * @param {string} peerId - Peer ID
   */
  async getPeerCadPool(peerId) {
    return this.forwardToolCall(peerId, 'cad_pool_stats', {});
  }

  /**
   * 获取远程 peer 的 CAD 信息
   * @param {string} peerId - Peer ID
   */
  async getPeerCadInfo(peerId) {
    return this.forwardToolCall(peerId, 'get_cad_info', {});
  }

  /**
   * 解析 peer（支持 ID 或 URL）
   */
  _resolvePeer(peerId) {
    if (peerId.startsWith('http://') || peerId.startsWith('https://')) {
      const url = new URL(peerId);
      return peerManager.getPeerByUrl(`${url.protocol}//${url.host}`) ||
        { id: peerId, host: url.hostname, port: parseInt(url.port) || 8110, url: peerId, healthy: true, hostname: url.hostname };
    }

    return peerManager.getPeer(peerId);
  }

  /**
   * 解析 SSE 响应
   */
  _parseSSE(text) {
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data:')) {
        try {
          return JSON.parse(trimmed.slice(5).trim());
        } catch {
          // 跳过无法解析的 data 行
        }
      }
    }
    throw new Error('Failed to parse SSE response');
  }

  /**
   * 批量转发到多个 peer
   * @param {string[]} peerIds - Peer ID 列表
   * @param {object} request - MCP 请求
   */
  async broadcast(peerIds, request) {
    const results = await Promise.allSettled(
      peerIds.map(id => this.forward(id, request))
    );

    return results.map((r, i) => ({
      peerId: peerIds[i],
      success: r.status === 'fulfilled',
      result: r.status === 'fulfilled' ? r.value : null,
      error: r.status === 'rejected' ? r.reason.message : null,
    }));
  }
}

const peerProxy = new PeerProxy();
export default peerProxy;
