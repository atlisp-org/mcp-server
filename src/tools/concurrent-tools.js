export const tools = [
  {
    name: 'batch_concurrent_tasks',
    description: '跨多个 CAD 实例并发执行不同工具。当用户需要在多个 CAD 上同时执行不同操作时调用。各任务独立运行（一个失败不影响其他）。需指定每个任务的 tool/args/instance。对比 batch_transaction 是顺序执行且可回滚，本工具并行执行但不可回滚。返回每个任务的结果。',
    inputSchema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string', description: '工具名称。如 "draw_line"、"get_entity"' },
              args: { type: 'object', description: '工具参数（不含 instance）。如 { p1: "0,0", p2: "100,0" }' },
              instance: { type: 'string', description: '目标实例 key。如 "autocad"、"zwcad"。可通过 cad_pool_list 获取' },
            },
            required: ['tool', 'instance'],
          },
          description: '要并发执行的任务列表。每个任务需指定 tool、args（可选）、instance',
        },
      },
      required: ['tasks'],
    },
  },
];
