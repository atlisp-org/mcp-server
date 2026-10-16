export const tools = [
  {
    name: 'webhook_register',
    description: '注册 Webhook：当 CAD 事件发生时向指定 URL 发送 POST 通知。当用户说"设置回调/配置通知/事件推送"时调用。支持事件见 events 参数。返回 webhook ID。',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Webhook 目标 URL。如 https://example.com/webhook/cad' },
        events: {
          type: 'array',
          items: { type: 'string' },
          description: '要监听的事件列表。可选值: tool_executed, package_installed, cad_connected, cad_disconnected, error_occurred。如 ["tool_executed", "error_occurred"]'
        },
        name: { type: 'string', description: 'Webhook 名称（可选），便于识别' },
        secret: { type: 'string', description: '签名密钥（可选），通过 X-Webhook-Secret 请求头发送' }
      },
      required: ['url', 'events']
    }
  },
  {
    name: 'webhook_list',
    description: '列出所有已注册的 Webhook。当用户说"有哪些 Webhook/查看回调"时调用。返回 webhook ID、名称、URL、事件列表。',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'webhook_remove',
    description: '删除已注册的 Webhook。当用户说"删除回调/取消 Webhook"时调用。通过 webhook_list 获取 ID。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '要删除的 Webhook ID，可通过 webhook_list 获取' }
      },
      required: ['id']
    }
  },
  {
    name: 'webhook_log',
    description: '查看指定 Webhook 的执行历史日志。当用户想知道 Webhook 是否触发成功、查看触发详情时调用。返回触发时间、状态、请求/响应内容。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Webhook ID。可通过 webhook_list 获取' }
      },
      required: ['id']
    }
  }
];
