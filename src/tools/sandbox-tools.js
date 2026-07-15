export const tools = [
  {
    name: 'sandbox_validate',
    description: '检查Lisp代码是否违反安全规则。扫描危险函数并按block/warn/allow分级返回结果',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '要验证的 Lisp 代码' },
        sessionId: { type: 'string', description: '会话 ID（可选，用于检查 allowlist）' }
      },
      required: ['code']
    }
  },
  {
    name: 'sandbox_allowlist_add',
    description: '将规则索引加入会话白名单，放行该规则的检查',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '会话 ID' },
        ruleIndex: { type: 'number', description: '规则索引号（从 0 开始）' }
      },
      required: ['sessionId', 'ruleIndex']
    }
  },
  {
    name: 'sandbox_allowlist_clear',
    description: '清空当前会话的所有白名单规则，恢复完整安全检查',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '会话 ID' }
      },
      required: ['sessionId']
    }
  }
];
