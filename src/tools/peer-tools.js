export const tools = [
  {
    name: 'peer_list',
    description: '列出所有已发现的 MCP peer 服务器。当用户说"查看其他服务器/有哪些 MCP"时调用。返回每个 peer 的主机名、地址、版本、健康状态。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'peer_scan',
    description: '手动触发局域网扫描，发现运行中的 MCP 服务器。当用户说"扫描局域网/发现 MCP 服务器"时调用。返回新发现的 peer 列表。',
    inputSchema: {
      type: 'object',
      properties: {
        port: { type: 'number', description: '扫描端口（默认 8110）' },
        timeout: { type: 'number', description: '单主机超时毫秒（默认 500）' },
        maxHosts: { type: 'number', description: '每个子网最大主机数（默认 254）' }
      }
    }
  },
  {
    name: 'peer_connect',
    description: '手动添加一个 peer 服务器。当用户说"连接到某个 MCP/添加服务器"时调用。返回连接状态。',
    inputSchema: {
      type: 'object',
      properties: {
        host: { type: 'string', description: '目标主机 IP 或域名' },
        port: { type: 'number', description: '目标端口（默认 8110）' },
        apikey: { type: 'string', description: 'API Key（如果目标服务器需要认证）' }
      },
      required: ['host']
    }
  },
  {
    name: 'peer_disconnect',
    description: '断开并移除指定 peer 服务器。当用户说"断开服务器/移除 peer"时调用。',
    inputSchema: {
      type: 'object',
      properties: {
        peerId: { type: 'string', description: '要断开的 peer ID。可通过 peer_list 获取' }
      },
      required: ['peerId']
    }
  },
  {
    name: 'peer_forward',
    description: '将 LISP 代码转发到远程 peer 执行。当用户说"在另一台电脑上执行/远程执行"时调用。返回远程执行结果。',
    inputSchema: {
      type: 'object',
      properties: {
        peerId: { type: 'string', description: '目标 peer ID。可通过 peer_list 获取' },
        code: { type: 'string', description: '要执行的 AutoLISP 代码' },
        encoding: { type: 'string', description: '编码: utf-8/gbk/gb2312（默认 utf-8）' }
      },
      required: ['peerId', 'code']
    }
  },
  {
    name: 'peer_cad_info',
    description: '获取远程 peer 的 CAD 连接信息。当用户说"查看远程 CAD 状态"时调用。',
    inputSchema: {
      type: 'object',
      properties: {
        peerId: { type: 'string', description: '目标 peer ID' }
      },
      required: ['peerId']
    }
  },
  {
    name: 'peer_cad_pool',
    description: '获取远程 peer 的 CAD 连接池信息。当用户说"查看远程连接池"时调用。',
    inputSchema: {
      type: 'object',
      properties: {
        peerId: { type: 'string', description: '目标 peer ID' }
      },
      required: ['peerId']
    }
  },
  {
    name: 'peer_stats',
    description: '获取 peer 管理统计信息。当用户说"peer 统计/服务器状态"时调用。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'peer_summary',
    description: '扫描局域网并汇总所有 CAD 文档信息。当用户说"查看所有 CAD 文档/汇总图纸"时调用。自动扫描、获取每个 CAD 的当前文档名、路径、图层等信息。',
    inputSchema: {
      type: 'object',
      properties: {
        port: { type: 'number', description: '扫描端口（默认 8110）' },
        timeout: { type: 'number', description: '单主机超时毫秒（默认 1000）' }
      }
    }
  },
  {
    name: 'peer_broadcast',
    description: '向所有已连接的 peer 广播执行相同的 LISP 代码。当用户说"在所有 CAD 上执行/批量执行"时调用。返回每个 peer 的执行结果。',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '要执行的 AutoLISP 代码' },
        encoding: { type: 'string', description: '编码: utf-8/gbk/gb2312（默认 utf-8）' },
        healthyOnly: { type: 'boolean', description: '仅向健康的 peer 发送（默认 true）' }
      },
      required: ['code']
    }
  }
];
