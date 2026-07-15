export const tools = [
  {
    name: 'batch_transaction',
    description: '事务性批量操作：将多个工具调用包装在一个撤销组中。任一失败自动回滚全部。适合需要原子性的操作',
    inputSchema: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          description: '操作列表，每项包含 tool（工具名）和 args（参数对象）',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string', description: '要调用的工具名称' },
              args: { type: 'object', description: '工具参数' },
            },
            required: ['tool'],
          },
        },
      },
      required: ['operations'],
    },
  },
];
