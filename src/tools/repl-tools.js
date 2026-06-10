export const tools = [
  {
    name: 'lisp_repl',
    description: '在 REPL 会话中执行 Lisp 代码。自动追踪 setq 变量和历史记录。不传 sessionId 则自动创建新会话',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'REPL 会话 ID（可选，不传则自动创建）' },
        code: { type: 'string', description: '要执行的 Lisp 代码' }
      },
      required: ['code']
    }
  },
  {
    name: 'lisp_repl_history',
    description: '获取 REPL 会话的历史记录',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'REPL 会话 ID' }
      },
      required: ['sessionId']
    }
  },
  {
    name: 'lisp_repl_list',
    description: '列出所有活跃的 REPL 会话',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'lisp_repl_close',
    description: '关闭 REPL 会话并清理',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '要关闭的 REPL 会话 ID' }
      },
      required: ['sessionId']
    }
  }
];
