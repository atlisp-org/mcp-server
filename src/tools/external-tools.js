export const tools = [
{
    name: 'external_db_query',
    description: '查询外部数据源（CSV/JSON 文件）。当用户说"查一下XX数据/从外部数据查询"时调用。数据文件存放于 ~/.atlisp/data/ 目录。source 是文件名（不带扩展名）。filters 支持键值对过滤。对比 list_data_sources 先查看可用数据源。返回查询结果数组。',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: '数据源名称（不带扩展名）。如 "city_data"、"material_list"。可通过 list_data_sources 查看' },
        query: { type: 'string', description: '查询语句（预留，暂未实现）' },
        filters: { type: 'object', description: '过滤条件，如 { "city": "北京", "type": "A" }' }
      },
      required: []
    }
  },
{
    name: 'import_external_data',
    description: '根据外部数据在 CAD 中创建点实体。当用户说"导入数据/根据表格创建点"时调用。数据源为 ~/.atlisp/data/ 下的 JSON/CSV 文件。mapping 字段映射 x/y/z/label 列名。对比 external_db_query 仅查询不回写，本工具会在 CAD 中绘图。',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: '数据源名称（不带扩展名）。如 "coordinate_data"、"points"' },
        targetLayer: { type: 'string', description: '目标图层名（默认 ImportedData）。如 "测量点"、">标注点"' },
        mapping: { type: 'object', description: '字段映射: { x: "经度", y: "纬度", z: "高程", label: "名称" }' }
      },
      required: ['source']
    }
  },
{
    name: 'export_to_external',
    description: '将 CAD 实体数据导出为 CSV 或 JSON 文件。当用户说"导出为表格/导出数据"时调用。filter 可选按图层过滤。输出到 ~/.atlisp/data/ 目录。返回导出文件路径。',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', description: '导出格式: csv 或 json（默认 json）。如 "csv"' },
        outputFile: { type: 'string', description: '输出文件路径（可选，默认自动生成）' },
        filter: { type: 'object', description: '过滤条件: { layer: "轴线" }。不传则导出全部实体' }
      },
      required: []
    }
  },
{
    name: 'list_data_sources',
    description: '列出 ~/.atlisp/data/ 目录下可用的外部数据源文件。当用户说"有哪些数据/查看数据源"时调用。返回文件名列表，供 external_db_query 和 import_external_data 使用。',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  }
];
