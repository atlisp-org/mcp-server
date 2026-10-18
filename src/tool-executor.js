import { TOOL_HANDLERS } from './mcp-tools.js';
import { validateToolArgs } from './tool-validators.js';
import { notifyResourceChanges } from './tool-dispatch.js';
import { READ_ONLY_TOOLS, DESTRUCTIVE_TOOLS } from './tools/index.js';
import { checkToolRateLimit } from './rate-limiter.js';
import { progressContext, mcpContext } from './mcp-server-state.js';
import { setNotifyProgress, getNotifyProgress } from './handler-utils.js';
import { error as logError } from './logger.js';
import { cad, resolveCadConnection } from './cad.js';
import { pool } from './cad-pool.js';
import { writeAuditEntry } from './audit-log.js';
import { mcpErrorResponse, ERROR_CODES, MCPError } from './errors.js';
import { callCustomTool } from './tool-registry.js';
import { withSpan } from './tracing.js';
import { isForwardableTool, forwardToolCall as peerForwardToolCall, getAutoForwardPeer } from './peer-forward.js';
import { callPluginHook } from './plugin-loader.js';

function resolveConn(instance) {
  if (instance) return pool.getConnection(instance) || resolveCadConnection();
  return cad;
}

/**
 * 规范化工具调用结果中的结构化输出（MCP 2025-06-18 structuredContent）：
 * - handler 返回合法对象时原样透传到 CallToolResult；
 * - 结构化对象非法（非对象/数组）时丢弃，避免破坏协议 schema；
 * - 只有 structuredContent 而无 content 时，回填一个 JSON 文本块（向后兼容）。
 * @param {any} result
 * @returns {any}
 */
function normalizeStructuredResult(result) {
  if (!result || typeof result !== 'object' || !('structuredContent' in result)) return result;
  const sc = result.structuredContent;
  if (sc === null || typeof sc !== 'object' || Array.isArray(sc)) {
    const rest = { ...result };
    delete rest.structuredContent;
    return rest;
  }
  if (!Array.isArray(result.content) || result.content.length === 0) {
    return { ...result, content: [{ type: 'text', text: JSON.stringify(sc, null, 2) }] };
  }
  return result;
}

async function writeAuditSuccess(name, args, options, target) {
  writeAuditEntry({
    timestamp: new Date().toISOString(),
    tool: name, args: args || {},
    sessionId: options.sessionId || '',
    result: 'success',
    target: target || '',
  });
}

async function writeAuditError(name, args, options, error) {
  writeAuditEntry({
    timestamp: new Date().toISOString(),
    tool: name, args: args || {},
    sessionId: options.sessionId || '',
    result: 'error', error: error.message,
  });
}

async function beginUndo(instance) {
  const conn = resolveConn(instance);
  if (conn?.connected) {
    try {
      await conn.sendCommand('(command "_.UNDO" "_BEGIN")');
      return true;
    } catch (e) { logError(`UNDO_BEGIN failed: ${e.message}`); }
  }
  return false;
}

async function endUndo(instance) {
  const conn = resolveConn(instance);
  try { await conn.sendCommand('(command "_.UNDO" "_END")'); } catch (e) { logError('[tool-executor]', e?.message || e); }
}

async function runToolCall(name, args, options) {
    const handler = TOOL_HANDLERS[name];
    if (!handler) {
        const customResult = callCustomTool(name, args);
        if (customResult !== null) return customResult;
        return mcpErrorResponse(new MCPError(ERROR_CODES.HANDLER_NOT_FOUND, `未知工具: ${name}`));
    }

    const isReadOnly = READ_ONLY_TOOLS.has(name);
    const notifyProgress = options.notifyProgress || null;

    const rateCheck = checkToolRateLimit(name, isReadOnly, options.sessionId);
    if (!rateCheck.allowed) {
        return mcpErrorResponse(new MCPError(ERROR_CODES.RATE_LIMITED, `工具调用频率超限，请 ${rateCheck.retryAfter} 秒后重试`));
    }

    return progressContext.run({ notifyProgress }, async () => {
        setNotifyProgress(notifyProgress);
        const instance = args?.instance || null;
        let undoBegun = false;

        try {
            validateToolArgs(name, args || {});
            if (instance) {
                const ctx = mcpContext.getStore();
                ctx._toolInstance = instance;
            }

            if (!isReadOnly && DESTRUCTIVE_TOOLS.has(name)) {
                undoBegun = await beginUndo(instance);
            }

            const np = getNotifyProgress();
            if (np) np(1, 1, `正在执行 ${name}...`);

            const result = await handler(args || {});

            if (np) np(1, 1, `${name} 执行完成`);

            await writeAuditSuccess(name, args, options);
            notifyResourceChanges(name);
            return result;
        } catch (e) {
            logError(`Tool call error [${name}]: ${e.message}`, { tool: name, args });

            // CAD 未连接且配置了远程转发：自动将工具调用转发到远程 peer
            if (e instanceof MCPError && e.code === ERROR_CODES.CAD_NOT_CONNECTED && isForwardableTool(name)) {
                const remote = await getAutoForwardPeer();
                if (remote) {
                    try {
                        const result = await peerForwardToolCall(remote.id, name, args || {}, { apikey: remote.apikey });
                        await writeAuditSuccess(name, args, options, `peer:${remote.id}`);
                        return result;
                    } catch (fe) {
                        logError(`远程转发失败 [${name}]: ${fe.message} (peer: ${remote.url})`);
                    }
                }
            }

            await writeAuditError(name, args, options, e);
            if (e instanceof MCPError) return mcpErrorResponse(e);
            if (e.message?.startsWith('Missing required') || e.message?.startsWith('Invalid type')) {
                return mcpErrorResponse(new MCPError(ERROR_CODES.INVALID_ARGS, e.message));
            }
            return mcpErrorResponse(e);
        } finally {
            const ctx = mcpContext.getStore();
            if (ctx) ctx._toolInstance = null;
            if (undoBegun) await endUndo(instance);
        }
    });
}

/**
 * 工具调用入口：包一层 OTel span（未启用 tracing 时零开销透传），
 * 并统一规范化 structuredContent（透传/回填 content）。
 *
 * 同时在真实调用边界分发插件钩子（docs/plugins.md）：
 *   onToolCall(name, args) → onToolExecuted({ name, args, result, duration, success })
 *   失败时额外触发 onError({ message, source, code })。
 */
export function handleToolCall(name, args, options = {}) {
  return withSpan(`tool.${name}`, {
    'tool.name': name,
    'session.id': options.sessionId || '',
    'tool.readOnly': READ_ONLY_TOOLS.has(name),
  }, async () => {
    const startedAt = Date.now();
    const safeArgs = args || {};
    callPluginHook('onToolCall', name, safeArgs);
    try {
      const result = normalizeStructuredResult(await runToolCall(name, args, options));
      const success = !result?.isError;
      callPluginHook('onToolExecuted', {
        name, args: safeArgs, result, duration: Date.now() - startedAt, success,
      });
      if (!success) {
        const message = result?.content?.[0]?.text || `工具 ${name} 执行失败`;
        callPluginHook('onError', { message, source: `tool:${name}`, code: 'TOOL_ERROR' });
      }
      return result;
    } catch (e) {
      callPluginHook('onToolExecuted', {
        name, args: safeArgs, duration: Date.now() - startedAt, success: false, error: e.message,
      });
      callPluginHook('onError', { message: e.message, source: `tool:${name}`, code: e.code || 'UNKNOWN' });
      throw e;
    }
  });
}
