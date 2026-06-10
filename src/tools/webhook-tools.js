export const tools = [
  {
    name: 'webhook_register',
    description: '注册 webhook。当指定事件发生时，向目标 URL 发送 HTTP POST 请求',
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
    description: '列出所有已注册的 webhook',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'webhook_remove',
    description: '移除已注册的 webhook',
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
    description: '获取 webhook 的执行日志',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Webhook ID' }
      },
      required: ['id']
    }
  }
];
