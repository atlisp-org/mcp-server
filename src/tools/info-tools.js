export const tools = [
{
        name: 'get_function_usage',
        description: '查询 @lisp 函数的详细用法、参数说明和示例。用户不知道怎么用某函数时调用',
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
        description: '列出 @lisp 环境中所有可用的函数和变量。指定包名则只列出该包符号。用于探索可用功能',
        inputSchema: {
            type: 'object',
            properties: {
                package: { type: 'string', description: '包名（可选），如 string、block、dim' }
            }
        }
    },
{
        name: 'import_funlib',
        description: '从 @lisp 服务器获取函数库清单导入到 Agent 上下文。让 Agent 知道有哪些 @lisp 函数可用。format=list 返回简洁的函数名:描述列表',
        inputSchema: {
            type: 'object',
            properties: {
                format: { type: 'string', enum: ['json', 'list'], description: '返回格式：json（完整JSON含参数）或 list（函数名:描述），默认 json' }
            }
        }
    },
{
        name: 'list_prompts',
        description: '列出所有可用的 MCP Prompt 模板（如 分析图纸/生成标注/导出报表 等）。用户想用预制功能时先列出来看看',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'get_prompt',
        description: '获取指定 Prompt 模板的详细内容（含参数说明和使用示例）',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '提示模板名称' },
                args: { type: 'object', description: '模板参数（可选）' }
            },
            required: ['name']
        }
    },
{ name: 'search_tools', description: '搜索工具名称或描述。不知道用什么工具时先用此工具搜索', inputSchema: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词（匹配工具名称和描述）' } }, required: ['query'] } },
{ name: 'list_tools_by_category', description: '按分类浏览所有工具（绘图/修改/图层/块/打印等）。不传 category 则列出所有分类名称', inputSchema: { type: 'object', properties: { category: { type: 'string', description: '分类名称，如 绘图与3D、修改、图层、块、打印（可选，不传则列出所有分类）' } } } },
{ name: 'get_tool_info', description: '获取工具的详细元数据：参数列表、分类（category）、只读(readOnlyHint)、破坏性(destructiveHint)标记', inputSchema: { type: 'object', properties: { name: { type: 'string', description: '工具名称' } }, required: ['name'] } },
];
