export const tools = [
  {
    name: 'skill_search',
    description: '在远程注册表中搜索可安装的 Skill。用户问"有什么Skill/能做什么"时调用。找到想要的 Skill 后用 skill_install 安装使用',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词，如 "debug"、"plot"、"block"、"layout"。匹配 Skill 名称和描述' }
      },
      required: ['query']
    }
  },
  {
    name: 'skill_install',
    description: '从远程注册表下载并安装指定 Skill 到本地。工作流：skill_search 搜索 → skill_install 安装 → 查看已安装 skill_list_installed。安装后即可在对话中激活使用',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill 名称（从 skill_search 结果中获取），如 atlisp-mcp-debug' }
      },
      required: ['name']
    }
  },
  {
    name: 'skill_list_installed',
    description: '列出所有已安装到本地的 Skill 名称、描述和位置。用户问"我装了什么Skill/哪些可用"时调用。方便查看已装 skill 及其功能',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'skill_uninstall',
    description: '卸载已安装的本地 Skill。用户说"删除这个Skill/不需要了"时调用。不影响其他已安装的 Skill',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '要卸载的 Skill 名称（从 skill_list_installed 结果中获取）' }
      },
      required: ['name']
    }
  },
  {
    name: 'skill_list_categories',
    description: '列出远程注册表中所有 Skill 分类标签。用户想浏览有哪些 Skill 类型时先用此工具查看分类，再针对性用 skill_search 搜索',
    inputSchema: { type: 'object', properties: {} }
  }
];
