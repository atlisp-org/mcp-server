export const tools = [
  {
    name: 'batch_transaction',
    description: '事务性批量操作：将多个工具调用包装在一个撤销组中。当用户说"同时做这几步操作/如果失败就回滚"时调用。任一失败自动回滚全部。适合需要原子性的操作。对比 batch_concurrent_tasks 是并行执行不保原子性，本工具顺序执行且可回滚。返回每个操作的结果或回滚信息。',
    inputSchema: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          description: '操作列表，每项包含 tool（工具名）和 args（参数对象）。按顺序依次执行，任一失败全部回滚',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string', description: '要调用的工具名称。如 "draw_line"、"set_layer"' },
              args: { type: 'object', description: '工具参数。如 { p1: "0,0", p2: "100,0" }' },
            },
            required: ['tool'],
          },
        },
      },
      required: ['operations'],
    },
  },
];
