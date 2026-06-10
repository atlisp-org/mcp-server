export const tools = [
{
    name: 'external_db_query',
    description: '查询外部数据源 (CSV/JSON)',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: '数据源名称 (不带扩展名)' },
        query: { type: 'string', description: '查询语句 (预留)' },
        filters: { type: 'object', description: '过滤条件，如 { "city": "北京" }' }
      },
      required: []
    }
  },
{
    name: 'import_external_data',
    description: '从外部数据源导入实体到 CAD 图形',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: '数据源名称 (不带扩展名)' },
        targetLayer: { type: 'string', description: '目标图层名 (默认 ImportedData)' },
        mapping: { type: 'object', description: '字段映射: { x, y, z, label }' }
      },
      required: ['source']
    }
  },
{
    name: 'export_to_external',
    description: '将 CAD 实体导出到外部文件 (CSV/JSON)',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', description: '导出格式: csv 或 json (默认 json)' },
        outputFile: { type: 'string', description: '输出文件路径 (可选)' },
        filter: { type: 'object', description: '过滤条件: { layer: "图层名" }' }
      },
      required: []
    }
  },
{
    name: 'list_data_sources',
    description: '列出 ~/.atlisp/data/ 下可用的外部数据源',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  }
];
