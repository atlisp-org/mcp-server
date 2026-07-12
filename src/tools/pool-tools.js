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
        key: { type: 'string', description: '实例标识键名（如 autocad, zwcad, mycad；不传时由 pid 自动派生）' },
        platform: { type: 'string', description: 'CAD 平台: AutoCAD, ZWCAD, GStarCAD, BricsCAD（可选，自动检测）' },
        pid: { type: 'number', description: '目标进程 PID（可选，通过 ROT 查找后连接，可与 pid 自动派生 key）' },
        label: { type: 'string', description: '实例显示标签（可选）' },
        makeActive: { type: 'boolean', description: '连接后设为活动实例（默认 true）' }
      }
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
  {
    name: 'session_pin_instance',
    description: '将当前会话绑定到指定 CAD 实例。后续所有工具调用自动路由到该实例，无需每次传入 instance 参数',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'CAD 实例 key，如 "autocad"、"zwcad"。可通过 cad_pool_list 查看可用实例' }
      },
      required: ['key']
    }
  },
  {
    name: 'session_unpin_instance',
    description: '取消当前会话的实例绑定。恢复为使用连接池的活动实例（cad_pool_switch 指定的）',
    inputSchema: { type: 'object', properties: {} }
  }
];
