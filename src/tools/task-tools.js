export const tools = [
{
        name: 'task_submit',
        description: '提交长任务：把一个耗时工具调用放到后台执行，立即返回 taskId。适合批量处理、全图扫描、导出、知识库检索等可能超过 30 秒的操作。执行仍走完整校验/限速/Undo/审计。用 task_status 轮询、task_result 取结果、task_cancel 取消。例：{"tool":"batch_delete","args":{"handles":["A1"]}}。禁止提交 task_* 工具（防递归）。',
        inputSchema: {
            type: 'object',
            properties: {
                tool: { type: 'string', description: '要异步执行的真实工具名，如 batch_delete、stream_entities、lint_project' },
                args: { type: 'object', description: '传给该工具的参数对象，默认 {}', additionalProperties: true },
                timeoutMs: { type: 'integer', minimum: 0, maximum: 600000, description: '任务超时毫秒数（0=不限制，默认 0；上限 10 分钟）' }
            },
            required: ['tool']
        }
    },
{
        name: 'task_status',
        description: '查询任务状态（queued/running/succeeded/failed/cancelled）与进度。返回 taskId、tool、progress、error、cancelRequested，不含大结果。不会等待。',
        inputSchema: {
            type: 'object',
            properties: {
                taskId: { type: 'string', description: 'task_submit 返回的任务 ID（task_ 开头）' }
            },
            required: ['taskId']
        }
    },
{
        name: 'task_result',
        description: '取任务结果。任务完成时返回与同步调用一致的工具结果；未完成时返回状态（可用 waitMs 长轮询，最长 30 秒）。失败/取消返回 isError。',
        inputSchema: {
            type: 'object',
            properties: {
                taskId: { type: 'string', description: '任务 ID，task_submit 返回的 task_ 开头标识' },
                waitMs: { type: 'integer', minimum: 0, maximum: 30000, description: '最长等待毫秒数，默认 0（立即返回），上限 30000' }
            },
            required: ['taskId']
        }
    },
{
        name: 'task_list',
        description: '当用户问「还有哪些任务在跑/刚才的批量操作到哪了」时调用。按创建时间倒序返回，可按状态过滤；完成任务保留 24 小时，最多 200 条。',
        inputSchema: {
            type: 'object',
            properties: {
                status: { type: 'string', enum: ['queued', 'running', 'succeeded', 'failed', 'cancelled'], description: '只列出该状态的任务（可选）' },
                limit: { type: 'integer', minimum: 1, maximum: 200, description: '最多返回条数，默认 50' }
            }
        }
    },
{
        name: 'task_cancel',
        description: '取消任务。排队中的任务立即取消；运行中的任务记录取消请求，在当前 CAD 命令结束后停止（CAD 命令本身无法强制中断）。',
        inputSchema: {
            type: 'object',
            properties: {
                taskId: { type: 'string', description: '任务 ID，task_submit 返回的 task_ 开头标识' }
            },
            required: ['taskId']
        }
    },
];
