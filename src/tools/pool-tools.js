export const tools = [
  {
    name: 'cad_pool_discover',
    description: '发现所有 CAD 实例（AutoCAD/ZWCAD/GStarCAD/BricsCAD）并加入连接池',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'cad_pool_switch',
    description: '切换活动 CAD 实例',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '实例键名（如 default, autocad, zwcad）' }
      },
      required: ['key']
    }
  },
  {
    name: 'cad_pool_health',
    description: '检查所有 CAD 实例的健康状态（ping 检测）',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'cad_pool_stats',
    description: '获取连接池统计信息（实例数量/队列大小/运行时间等）',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'cad_pool_connect',
    description: '连接到指定 CAD 平台并加入连接池',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '实例标识键名（如 autocad, zwcad, mycad）' },
        platform: { type: 'string', description: 'CAD 平台: AutoCAD, ZWCAD, GStarCAD, BricsCAD（可选，自动检测）' },
        label: { type: 'string', description: '实例显示标签（可选）' },
        makeActive: { type: 'boolean', description: '连接后设为活动实例（默认 true）' }
      },
      required: ['key']
    }
  },
  {
    name: 'cad_pool_disconnect',
    description: '断开并移除连接池中的指定 CAD 实例',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '要断开的实例键名' }
      },
      required: ['key']
    }
  },
  {
    name: 'cad_pool_list',
    description: '列出连接池中所有 CAD 实例及其状态',
    inputSchema: { type: 'object', properties: {} }
  },
];
