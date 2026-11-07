import { taskEngine } from '../task-engine.js';
import { handleToolCall } from '../tool-executor.js';
import { getNotifyProgress } from '../handler-utils.js';
import { mcpContext } from '../mcp-server-state.js';
import { toolsByName } from '../tools/index.js';

function asText(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

/**
 * 提交长任务。与同步工具走同一条执行链（参数校验/限速/Undo/审计/插件钩子），
 * 只是把执行放到后台，立即返回 taskId。
 */
export async function taskSubmit(args = {}) {
  const { tool, args: toolArgs = {}, timeoutMs = 0 } = args;
  if (!tool) {
    return asText({ ok: false, error: '需要 tool 参数（要异步执行的真实工具名）' });
  }
  // 插件自定义工具不在 toolsByName 里，交给执行器判定；内置工具提前报错。
  if (!toolsByName.has(tool) && !tool.startsWith('plugin_')) {
    return asText({ ok: false, error: `未知工具: ${tool}`, hint: '先用 search_tools 确认工具名' });
  }

  const view = taskEngine.submit({
    tool,
    args: toolArgs || {},
    sessionId: mcpContext.getStore()?.sessionId || args.sessionId || '',
    timeoutMs,
    notifyProgress: getNotifyProgress(),
  }, (name, callArgs, options) => handleToolCall(name, callArgs, options));

  return asText({
    ok: true,
    ...view,
    hint: `已排队。用 task_status('${view.taskId}') 轮询，或 task_result('${view.taskId}', 30000) 等待结果。`,
  });
}

export async function taskStatus(args = {}) {
  const taskId = args.taskId;
  if (!taskId) return asText({ ok: false, error: '需要 taskId' });
  return asText({ ok: true, ...taskEngine.get(taskId, { withResult: false }) });
}

export async function taskList(args = {}) {
  const result = taskEngine.list({ status: args.status || '', limit: args.limit || 50 });
  return asText({ ok: true, ...result });
}

export async function taskCancel(args = {}) {
  const taskId = args.taskId;
  if (!taskId) return asText({ ok: false, error: '需要 taskId' });
  const view = taskEngine.cancel(taskId);
  return asText({
    ok: true,
    ...view,
    hint: view.status === 'running'
      ? '取消请求已记录：正在执行的 CAD 命令无法中断，会在当前步骤结束后停止。'
      : '任务已取消。',
  });
}

export async function taskResult(args = {}) {
  const taskId = args.taskId;
  if (!taskId) return asText({ ok: false, error: '需要 taskId' });
  const waitMs = args.waitMs ?? 0;
  const task = await taskEngine.wait(taskId, waitMs);
  if (task.status === 'succeeded') {
    return task.result || asText({ ok: true, ...task });
  }
  if (task.status === 'failed' || task.status === 'cancelled') {
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({ ok: false, ...task }, null, 2) }],
    };
  }
  return asText({
    ok: true,
    ...task,
    hint: '任务尚未完成。可继续轮询 task_status，或传 waitMs 长轮询（上限 30000）。',
  });
}
