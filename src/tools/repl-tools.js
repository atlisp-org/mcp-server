export const tools = [
  {
    name: 'lisp_repl',
    description: '交互式 Lisp 执行会话。当用户需要逐步调试/执行多段 Lisp 代码时调用。自动追踪 setq 变量。不传 sessionId 则自动创建新会话。适合逐步调试 Lisp 代码。对比 eval_lisp 和 eval_lisp_with_result 是一次性执行，本工具保持会话状态。返回执行结果。',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'REPL 会话 ID（可选，不传则自动创建新会话）。已有会话则继续执行' },
        code: { type: 'string', description: '要执行的 Lisp 代码。如 (setq a 10) (+ a 5)' }
      },
      required: ['code']
    }
  },
  {
    name: 'lisp_repl_history',
    description: '查看 REPL 会话的历史执行记录。当用户想知道之前执行过哪些代码和结果时调用。返回该会话的完整执行历史和变量追踪。',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'REPL 会话 ID。可通过 lisp_repl_list 获取活跃会话列表' }
      },
      required: ['sessionId']
    }
  },
  {
    name: 'lisp_repl_list',
    description: '列出所有活跃的 REPL 会话。当用户说"有哪些 REPL 会话/正在调试什么"时调用。返回会话 ID 列表。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'lisp_repl_close',
    description: '关闭指定 REPL 会话并清理 CAD 中的辅助变量。当用户说"结束会话/关闭调试"时调用。关闭后不可再使用该 sessionId。',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '要关闭的 REPL 会话 ID。可通过 lisp_repl_list 获取' }
      },
      required: ['sessionId']
    }
  }
];
