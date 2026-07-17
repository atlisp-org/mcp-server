export const tools = [
  {
    name: 'cad_pool_discover',
    description: '通过 Windows ROT（运行对象表）自动发现所有运行中的 CAD 实例并加入连接池。当用户说"发现 CAD/找 CAD"时调用。自动检测 AutoCAD/ZWCAD/GStarCAD/BricsCAD。返回发现的实例列表。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'cad_pool_switch',
    description: '切换连接池的活动 CAD 实例。当用户说"切换到 XX CAD/改用另一个 CAD"时调用。后续无 instance 参数的工具调用将自动路由到此实例。通过 cad_pool_list 查看可用实例。',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '实例键名（如 "default"、"autocad"、"zwcad"）。可通过 cad_pool_list 获取' }
      },
      required: ['key']
    }
  },
  {
    name: 'cad_pool_health',
    description: '对所有已连接的 CAD 实例执行 ping 健康检查。当用户说"检查 CAD 连接/看看 CAD 是否正常"时调用。返回每个实例的连接状态、响应时间、版本信息。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'cad_pool_stats',
    description: '获取连接池统计信息。当用户说"查看连接池/连接情况"时调用。返回实例数、队列大小、运行时间、各实例请求计数等。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'cad_pool_connect',
    description: '手动连接指定 CAD 实例到连接池。当 cad_pool_discover 未自动发现，或需要指定特定进程时调用。支持指定 key（标识名）、platform（平台）、pid（进程 ID）。返回连接成功状态和实例信息。',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '实例标识键名（如 "autocad"、"zwcad"、"mycad"）。不传时由 pid 自动派生' },
        platform: { type: 'string', description: 'CAD 平台: AutoCAD, ZWCAD, GStarCAD, BricsCAD（可选，自动检测）' },
        pid: { type: 'number', description: '目标进程 PID（可选）。通过 Windows 任务管理器或 ROT 查找后连接' },
        label: { type: 'string', description: '实例显示标签（可选）。如 "我的 AutoCAD 2025"' },
        makeActive: { type: 'boolean', description: '连接后设为活动实例（默认 true）。设为 false 则仅连接不切换' }
      }
    }
  },
  {
    name: 'cad_pool_disconnect',
    description: '从连接池中断开并移除指定 CAD 实例。当用户说"断开 CAD/移除连接"时调用。断开后该实例不再可用。通过 cad_pool_list 获取要断开的实例键名。',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '要断开的实例键名。如 "autocad"、"zwcad"。可通过 cad_pool_list 获取' }
      },
      required: ['key']
    }
  },
  {
    name: 'cad_pool_list',
    description: '列出连接池中所有 CAD 实例的 key、平台、版本、连接状态和活跃标记。当用户说"连接了哪些 CAD/查看实例"时调用。返回实例摘要列表。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'session_pin_instance',
    description: '将当前会话绑定到指定 CAD 实例。后续所有工具调用自动路由到该实例，无需每次传入 instance 参数。当用户说"这轮对话都用某个 CAD"时调用。对比 session_unpin_instance 取消绑定。',
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
    description: '取消当前会话的实例绑定。恢复为使用连接池的活动实例（由 cad_pool_switch 指定）。当用户说"取消绑定/恢复默认"时调用。',
    inputSchema: { type: 'object', properties: {} }
  }
];
