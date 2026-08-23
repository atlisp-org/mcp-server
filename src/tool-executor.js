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

function resolveConn(instance) {
  if (instance) return pool.getConnection(instance) || resolveCadConnection();
  return cad;
}

async function writeAuditSuccess(name, args, options) {
  writeAuditEntry({
    timestamp: new Date().toISOString(),
    tool: name, args: args || {},
    sessionId: options.sessionId || '',
    result: 'success',
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
            await writeAuditError(name, args, options, e);
            if (e instanceof MCPError && e.code === ERROR_CODES.INVALID_ARGS) {
                return mcpErrorResponse(e);
            }
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
 * 工具调用入口：包一层 OTel span（未启用 tracing 时零开销透传）
 */
export function handleToolCall(name, args, options = {}) {
  return withSpan(`tool.${name}`, {
    'tool.name': name,
    'session.id': options.sessionId || '',
    'tool.readOnly': READ_ONLY_TOOLS.has(name),
  }, () => runToolCall(name, args, options));
}
