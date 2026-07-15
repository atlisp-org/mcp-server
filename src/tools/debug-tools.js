export const tools = [
  {
    name: 'debug_start',
    description: '启动交互式Lisp调试会话。将代码分块，支持断点和变量追踪',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '原始 AutoLISP 代码' },
        chunks: {
          type: 'array',
          description: '由扩展端拆分好的代码块列表',
          items: {
            type: 'object',
            properties: {
              id: { type: 'integer', description: '块序号 (1-based)' },
              line: { type: 'integer', description: '源文件行号' },
              code: { type: 'string', description: '块的 AutoLISP 代码' },
              vars: { type: 'array', items: { type: 'string' }, description: '该块需捕获的变量名' },
              isBreakpoint: { type: 'boolean', description: '该行有断点' },
              isDefunStart: { type: 'boolean', description: '是 defun 定义开头' },
            },
            required: ['id', 'line', 'code', 'vars', 'isBreakpoint'],
          },
        },
        encoding: { type: 'string', description: '编码（默认 auto）' },
      },
      required: ['code', 'chunks'],
    },
  },
  {
    name: 'debug_step',
    description: '单步执行(step)或继续到下一断点(continue)',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '调试会话 ID' },
        action: { type: 'string', enum: ['step', 'continue'], description: 'step=执行一个块, continue=到下一断点/结束' },
      },
      required: ['sessionId', 'action'],
    },
  },
  {
    name: 'debug_evaluate',
    description: '在调试会话中即时求值任意Lisp表达式',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '调试会话 ID' },
        expression: { type: 'string', description: '任意 AutoLISP 表达式' },
      },
      required: ['sessionId', 'expression'],
    },
  },
  {
    name: 'debug_get_state',
    description: '查询当前调试会话的状态（当前块、变量值等）',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '调试会话 ID' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'debug_stop',
    description: '停止调试会话，清理CAD中的辅助变量和函数',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '调试会话 ID' },
      },
      required: ['sessionId'],
    },
  },
];
