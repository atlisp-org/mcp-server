import { TOOL_HANDLERS } from './mcp-tools.js';
import { validateToolArgs } from './tool-validators.js';
import { notifyResourceChanges } from './tool-dispatch.js';
import { READ_ONLY_TOOLS } from './tools/index.js';
import { checkToolRateLimit } from './rate-limiter.js';
import { progressContext } from './mcp-server-state.js';
import { setNotifyProgress, getNotifyProgress } from './handler-utils.js';
import { error as logError } from './logger.js';
import { cad } from './cad.js';
import { writeAuditEntry } from './audit-log.js';
import { callCustomTool } from './tool-registry.js';

export async function handleToolCall(name, args, options = {}) {
    const handler = TOOL_HANDLERS[name];
    if (!handler) {
        const customResult = callCustomTool(name, args);
        if (customResult !== null) return customResult;
        return { content: [{ type: 'text', text: `未知工具: ${name}` }], isError: true };
    }

    const isReadOnly = READ_ONLY_TOOLS.has(name);
    const notifyProgress = options.notifyProgress || null;

    // Tool-level rate limit: read tools get higher limit, write tools get lower
    const rateCheck = checkToolRateLimit(name, isReadOnly, options.sessionId);
    if (!rateCheck.allowed) {
        return { content: [{ type: 'text', text: `工具调用频率超限 (${isReadOnly ? '读' : '写'}操作)，请 ${rateCheck.retryAfter} 秒后重试` }], isError: true };
    }

    return progressContext.run({ notifyProgress }, async () => {
        setNotifyProgress(notifyProgress);
        let undoBegun = false;

        try {
            validateToolArgs(name, args || {});

            if (!isReadOnly && cad.connected) {
                try {
                    await cad.sendCommand('(command "_.UNDO" "_BEGIN")');
                    undoBegun = true;
                } catch (e) { logError(`UNDO_BEGIN failed: ${e.message}`); }
            }

            const np = getNotifyProgress();
            if (np) np(1, 1, `正在执行 ${name}...`);

            const result = await handler(args || {});

            if (np) np(1, 1, `${name} 执行完成`);

            writeAuditEntry({
                timestamp: new Date().toISOString(),
                tool: name, args: args || {},
                sessionId: options.sessionId || '',
                result: result?.isError ? 'error' : 'success',
            });
            notifyResourceChanges(name);
            return result;
        } catch (e) {
            logError(`Tool call error [${name}]: ${e.message}`, { tool: name, args });
            writeAuditEntry({
                timestamp: new Date().toISOString(),
                tool: name, args: args || {},
                sessionId: options.sessionId || '',
                result: 'error', error: e.message,
            });
            return { content: [{ type: 'text', text: `工具执行错误: ${e.message}` }], isError: true };
        } finally {
            if (undoBegun) {
                try { await cad.sendCommand('(command "_.UNDO" "_END")'); } catch (_) {}
            }
        }
    });
}
