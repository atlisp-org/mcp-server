export const tools = [
  {
    name: 'batch_concurrent_tasks',
    description: '并发执行多实例工具 — 将多个工具调用同时路由到不同 CAD 实例并行执行。内部使用 Promise.allSettled，一个失败不影响其他。',
    inputSchema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string', description: '工具名称' },
              args: { type: 'object', description: '工具参数（不含 instance）' },
              instance: { type: 'string', description: '目标实例 key' },
            },
            required: ['tool', 'instance'],
          },
          description: '要并发执行的任务列表',
        },
      },
      required: ['tasks'],
    },
  },
];
