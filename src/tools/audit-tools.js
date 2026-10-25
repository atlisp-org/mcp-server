export const tools = [
  {
    name: 'audit_log_query',
    description: '查询审计日志。当用户说"查看操作记录/查一下谁做了什么/审计"时调用。支持按工具名、时间范围、结果状态、用户、会话 ID 筛选，支持分页。返回匹配的日志条目列表。',
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: '按工具名筛选。如 "eval_lisp"、"open_dwg"、不传则查全部' },
        fromDate: { type: 'string', description: '起始时间（ISO 格式）。如 2025-01-01T00:00:00Z' },
        toDate: { type: 'string', description: '结束时间（ISO 格式）。如 2025-12-31T23:59:59Z' },
        result: { type: 'string', description: '按结果状态筛选。如 "success"（成功）/ "error"（失败）/ 不传查全部' },
        user: { type: 'string', description: '按用户筛选。如 "admin"、"user1"' },
        sessionId: { type: 'string', description: '按会话 ID 筛选（可选；不传则统计所有会话）' },
        offset: { type: 'number', description: '分页偏移量（默认 0）。如 0' },
        limit: { type: 'number', description: '每页条数（默认 100）。如 50' }
      }
    }
  },
  {
    name: 'audit_log_stats',
    description: '获取审计日志统计信息。当用户说"统计操作次数/查看使用情况"时调用。返回总条目数、各工具调用次数、错误数、日志文件大小。',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];
