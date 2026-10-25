export const tools = [
  {
    name: 'sandbox_validate',
    description: '检查 Lisp 代码是否违反安全规则。当用户执行不确定的 Lisp 代码前建议先调用此工具。扫描危险函数并按 block/warn/allow 分级返回结果。对比 analyze_lisp_code 侧重代码质量，本工具侧重安全性。返回检查结果和分级信息。',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '要验证的 Lisp 代码。如 (command "shell" "dir") 会被标记为危险' },
        sessionId: { type: 'string', description: '会话 ID（可选），用于检查该会话的 allowlist 白名单' }
      },
      required: ['code']
    }
  },
  {
    name: 'sandbox_allowlist_add',
    description: '将规则索引加入会话白名单，放行该规则的检查。当 sandbox_validate 报告某个规则误报时，可调用此工具放行。结合 sandbox_validate 的返回结果中的 ruleIndex 使用。',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '会话 ID（不传则用当前 MCP 会话）' },
        ruleIndex: { type: 'number', description: '规则索引号（从 0 开始）。由 sandbox_validate 返回结果中的 ruleIndex 字段提供' }
      },
      required: ['sessionId', 'ruleIndex']
    }
  },
  {
    name: 'sandbox_allowlist_clear',
    description: '清空当前会话的所有白名单规则，恢复完整安全检查。当用户说"恢复安全检查/重置白名单"时调用。清除后所有规则重新生效。',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '会话 ID（不传则用当前 MCP 会话）' }
      },
      required: ['sessionId']
    }
  }
];
