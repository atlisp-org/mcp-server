export const tools = [
  {
    name: 'webhook_register',
    description: '注册Webhook：当CAD事件发生(工具执行/包安装/连接/断开/错误)时向指定URL发POST通知',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Webhook 目标 URL' },
        events: {
          type: 'array',
          items: { type: 'string' },
          description: '要监听的事件列表。可选值: tool_executed, package_installed, cad_connected, cad_disconnected, error_occurred'
        },
        name: { type: 'string', description: 'Webhook 名称（可选）' },
        secret: { type: 'string', description: '签名密钥，将通过 X-Webhook-Secret 请求头发送（可选）' }
      },
      required: ['url', 'events']
    }
  },
  {
    name: 'webhook_list',
    description: '列出所有已注册的Webhook',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'webhook_remove',
    description: '删除已注册的Webhook',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Webhook ID' }
      },
      required: ['id']
    }
  },
  {
    name: 'webhook_log',
    description: '查看指定Webhook的执行历史日志',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Webhook ID' }
      },
      required: ['id']
    }
  }
];
