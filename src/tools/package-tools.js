export const tools = [
{
        name: 'list_packages',
        description: '列出已安装的 @lisp 包',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'search_packages',
        description: '搜索 @lisp 包',
        inputSchema: {
            type: 'object',
            properties: { query: { type: 'string', description: '搜索关键词' } },
            required: ['query']
        }
    },
{
        name: 'install_package',
        description: '安装 @lisp 包到 CAD',
        inputSchema: {
            type: 'object',
            properties: { packageName: { type: 'string', description: '包名称' } },
            required: ['packageName']
        }
    }
];
