export const tools = [
  {
    name: 'batch_concurrent_tasks',
    description: '跨多个CAD实例并发执行不同工具。各任务独立运行(一个失败不影响其他)。需指定每个任务的tool/args/instance',
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
