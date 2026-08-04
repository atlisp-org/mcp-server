export const tools = [
{
        name: 'list_packages',
        description: '列出 CAD 中已安装的 @lisp 包及其版本号。用户问"装了哪些包/有哪些功能可用"时调用。前置条件：需先 init_atlisp。如需搜索未安装的包请用 search_packages',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'search_packages',
        description: '在 @lisp 远程仓库搜索可安装的包。当用户说"搜索@lisp包/找能装什么功能"时调用。用户想装新功能时先用此工具搜索，找到包名后调用 install_package 安装。前置条件：需先 init_atlisp',
        inputSchema: {
            type: 'object',
            properties: { query: { type: 'string', description: '搜索关键词，如 "string"(字符串处理)、"block"(块操作)、"dim"(标注)、"layer"(图层)、"plot"(打印)、"text"(文字)' } },
            required: ['query']
        }
    },
{
        name: 'install_package',
        description: '从远程仓库安装 @lisp 包到 CAD。当用户说"安装XX包/装这个功能"时调用。工作流：search_packages 搜索 → install_package 安装 → init_atlisp 加载。前置条件：需先 init_atlisp。安装后需再次 init_atlisp 使新函数可用',
        inputSchema: {
            type: 'object',
                properties: { packageName: { type: 'string', description: '包名称（从 search_packages 结果中获取的 packageName），如 "string"、"block"、"dim"' } },
            required: ['packageName']
        }
    }
];
