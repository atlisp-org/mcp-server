export const tools = [
  {
    name: 'debug_start',
    description: '启动交互式 Lisp 调试会话。当用户需要逐块调试/断点调试 AutoLISP 代码时调用。将代码分块执行，支持断点和变量追踪。对比 debug_step 继续执行，debug_get_state 查看状态。返回 sessionId。',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '原始 AutoLISP 代码。如要调试的完整 defun 或脚本' },
        chunks: {
          type: 'array',
          description: '由扩展端拆分好的代码块列表。每块对应一行或一个表达式',
          items: {
            type: 'object',
            properties: {
              id: { type: 'integer', description: '块序号（1-based）。如 1, 2, 3' },
              line: { type: 'integer', description: '源文件行号。如 10, 15' },
              code: { type: 'string', description: '该块的 AutoLISP 代码。如 (setq x 10)' },
              vars: { type: 'array', items: { type: 'string' }, description: '该块需捕获的变量名列表。如 ["x", "y"]' },
              isBreakpoint: { type: 'boolean', description: '该行是否有断点。true 表示执行到这里暂停' },
              isDefunStart: { type: 'boolean', description: '是否为 defun 定义开头。true 表示函数定义开始' },
            },
            required: ['id', 'line', 'code', 'vars', 'isBreakpoint'],
          },
        },
        encoding: { type: 'string', description: '编码（默认 auto）。如 "gbk"、"utf-8"。有中文时建议 gbk' },
      },
      required: ['code', 'chunks'],
    },
  },
  {
    name: 'debug_step',
    description: '单步执行或继续到下一断点。当用户说"下一步/继续执行/跳到下一个断点"时调用。step=执行一个块后暂停，continue=执行到下一断点或代码结束。',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '调试会话 ID（由 debug_start 返回）' },
        action: { type: 'string', enum: ['step', 'continue'], description: 'step=执行一个块后暂停，continue=执行到下一断点或代码结束。如 "step"' },
      },
      required: ['sessionId', 'action'],
    },
  },
  {
    name: 'debug_evaluate',
    description: '在调试会话中即时求值任意 Lisp 表达式。当用户想查看当前变量值或测试表达式时调用。不推进执行位置。返回表达式求值结果。',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '调试会话 ID（由 debug_start 返回）' },
        expression: { type: 'string', description: '任意 AutoLISP 表达式。如 (getvar "clayer") 、 (+ x 5)' },
      },
      required: ['sessionId', 'expression'],
    },
  },
  {
    name: 'debug_get_state',
    description: '查询当前调试会话的状态。当用户说"执行到哪了/当前变量值"时调用。返回当前块位置、已定义的变量及值、调用栈。',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '调试会话 ID（由 debug_start 返回）' }
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'debug_stop',
    description: '停止调试会话，清理 CAD 中的辅助变量和函数。当用户说"结束调试/退出调试"时调用。停止后不可再使用该 sessionId。',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '要停止的调试会话 ID（由 debug_start 返回）' }
      },
      required: ['sessionId'],
    },
  },
];
