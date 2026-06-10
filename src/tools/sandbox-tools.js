export const tools = [
  {
    name: 'sandbox_validate',
    description: '验证 Lisp 代码是否符合沙箱安全规则。分析代码中的危险函数调用并按威胁等级分类',
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
    description: '将指定规则索引添加到会话 allowlist，允许该规则在白名单下通过',
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
    description: '清除指定会话的所有 allowlist 规则，恢复默认安全限制',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '会话 ID' }
      },
      required: ['sessionId']
    }
  }
];
