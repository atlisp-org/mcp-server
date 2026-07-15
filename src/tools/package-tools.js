export const tools = [
{
        name: 'list_packages',
        description: '列出 CAD 中已安装的 @lisp 包及其版本。用户问"装了哪些包/有哪些功能"时调用。需先 init_atlisp',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'search_packages',
        description: '在 @lisp 远程仓库搜索可用包。用户想装新功能时先用此工具搜索',
        inputSchema: {
            type: 'object',
            properties: { query: { type: 'string', description: '搜索关键词，如 "string"、"block"、"dimension"' } },
            required: ['query']
        }
    },
{
        name: 'install_package',
        description: '从远程仓库安装 @lisp 包到 CAD。需先 search_packages 找到包名，再调用此工具安装。安装后需 init_atlisp 加载',
        inputSchema: {
            type: 'object',
                properties: { packageName: { type: 'string', description: '包名称（从 search_packages 结果中获取）' } },
            required: ['packageName']
        }
    }
];
