export const tools = [
  {
    name: 'audit_log_query',
    description: '查询审计日志历史记录。支持按工具名、时间范围、结果状态、用户和会话 ID 筛选，支持分页',
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: '按工具名筛选（如 eval_lisp）' },
        fromDate: { type: 'string', description: '起始时间（ISO 格式，如 2025-01-01T00:00:00Z）' },
        toDate: { type: 'string', description: '结束时间（ISO 格式）' },
        result: { type: 'string', description: '按结果状态筛选（success/error）' },
        user: { type: 'string', description: '按用户筛选' },
        sessionId: { type: 'string', description: '按会话 ID 筛选' },
        offset: { type: 'number', description: '分页偏移量（默认 0）' },
        limit: { type: 'number', description: '每页条数（默认 100）' }
      }
    }
  },
  {
    name: 'audit_log_stats',
    description: '获取审计日志统计信息，包括总条目数、各工具调用次数、错误数和日志文件大小',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];
