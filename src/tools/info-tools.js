export const tools = [
{
        name: 'get_function_usage',
        description: '获取 @lisp 函数用法',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '函数名，如 string:length' },
                package: { type: 'string', description: '包名，如 string（可选，不传则自动搜索）' }
            },
            required: ['name']
        }
    },
{
        name: 'list_symbols',
        description: '列出 @lisp 所有符号，用于检查函数和变量',
        inputSchema: {
            type: 'object',
            properties: {
                package: { type: 'string', description: '包名（可选）' }
            }
        }
    },
{
        name: 'import_funlib',
        description: '从网络导入 @lisp 函数库数据到 AI Agent',
        inputSchema: {
            type: 'object',
            properties: {
                format: { type: 'string', enum: ['json', 'list'], description: '返回格式：json（完整JSON）或 list（函数名:描述 列表），默认 json' }
            }
        }
    },
{
        name: 'list_prompts',
        description: '列出所有可用的 @lisp 提示模板',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'get_prompt',
        description: '获取指定提示模板的内容',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '提示模板名称' },
                args: { type: 'object', description: '模板参数（可选）' }
            },
            required: ['name']
        }
    },
{ name: 'search_tools', description: '按关键词搜索可用工具', inputSchema: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词(匹配名称和描述)' } }, required: ['query'] } },
{ name: 'list_tools_by_category', description: '按分类列出工具', inputSchema: { type: 'object', properties: { category: { type: 'string', description: '分类名称(可选,不传则列出所有分类)' } } } },
{ name: 'get_tool_info', description: '获取工具的详细信息（参数、分类、只读/破坏性标记等）', inputSchema: { type: 'object', properties: { name: { type: 'string', description: '工具名称' } }, required: ['name'] } },
];
