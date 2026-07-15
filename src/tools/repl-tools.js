export const tools = [
  {
    name: 'lisp_repl',
    description: '交互式Lisp执行会话。自动追踪setq变量。不传sessionId则自动创建新会话。适合逐步调试Lisp代码',
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
    description: '查看REPL会话的历史执行记录',
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
    description: '列出所有活跃的REPL会话',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'lisp_repl_close',
    description: '关闭指定REPL会话并清理CAD中的辅助变量',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '要关闭的 REPL 会话 ID' }
      },
      required: ['sessionId']
    }
  }
];
