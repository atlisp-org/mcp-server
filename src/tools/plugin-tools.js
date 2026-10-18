// 插件管理（本地工具，不转发到 peer）
export const tools = [
  {
    name: 'plugin_list',
    description: '列出当前已加载的 MCP 插件：名称、文件名、实现的钩子、注册的工具。用于确认插件是否加载成功、热重载后是否生效。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    outputSchema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: '已加载插件数量' },
        plugins: {
          type: 'array',
          description: '插件清单',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '插件名（default.name）' },
              file: { type: 'string', description: '插件文件名' },
              hooks: {
                type: 'array',
                items: { type: 'string' },
                description: '实现的生命周期钩子',
              },
              tools: {
                type: 'array',
                items: { type: 'string' },
                description: '该插件注册的工具名',
              },
            },
            required: ['name', 'file', 'hooks', 'tools'],
          },
        },
      },
      required: ['count', 'plugins'],
    },
  },
  {
    name: 'plugin_reload',
    description: '重新扫描并加载 ~/.atlisp/mcp-plugins 下的插件。会先注销旧插件注册的工具再重新执行 onInit；修改插件文件后若热重载未生效可调用。返回重新加载的插件数量。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    outputSchema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: '重新加载后的插件数量' },
        plugins: {
          type: 'array',
          items: { type: 'string' },
          description: '重新加载的插件名',
        },
      },
      required: ['count', 'plugins'],
    },
  },
];
