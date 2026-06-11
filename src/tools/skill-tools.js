export const tools = [
  {
    name: 'skill_search',
    description: '在远程注册表中搜索可安装的 skill',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' }
      },
      required: ['query']
    }
  },
  {
    name: 'skill_install',
    description: '从远程注册表下载并安装 skill 到本地',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill 名称' }
      },
      required: ['name']
    }
  },
  {
    name: 'skill_list_installed',
    description: '列出所有已安装的本地 skill',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'skill_uninstall',
    description: '卸载已安装的 skill',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill 名称' }
      },
      required: ['name']
    }
  },
  {
    name: 'skill_list_categories',
    description: '列出远程注册表中的所有分类标签',
    inputSchema: { type: 'object', properties: {} }
  }
];
