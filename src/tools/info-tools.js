export const tools = [
{
        name: 'get_function_usage',
        description: '查询 @lisp 函数的详细用法、参数说明和示例。用户说"这个函数怎么用/查函数用法"时调用。不知道某 @lisp 函数的调用方式时先用此工具。前置条件：需先 init_atlisp',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '函数名，如 string:length、block:make、dim:add。格式为 包名:函数名' },
                package: { type: 'string', description: '包名，如 string、block、dim。不传则自动在所有包中搜索（可选）' }
            },
            required: ['name']
        }
    },
{
        name: 'list_symbols',
        description: '列出 @lisp 环境中所有可用的函数和变量名。用户说"有哪些函数可用/@lisp能干什么"时调用。指定包名则只显示该包符号。前置条件：已 init_atlisp。如需详细用法请用 get_function_usage',
        inputSchema: {
            type: 'object',
            properties: {
                package: { type: 'string', description: '包名（可选），如 string(字符串处理)、block(块操作)、dim(标注)、layer(图层)、plot(打印)。不传则列出所有包符号' }
            }
        }
    },
{
        name: 'import_funlib',
        description: '从 @lisp 服务器获取完整函数库清单并导入到 Agent 上下文内存。让 Agent 知道有哪些 @lisp 函数可用(名称+参数+描述)。format=list 返回简洁的函数名:描述列表更省 token。前置条件：需先 init_atlisp',
        inputSchema: {
            type: 'object',
            properties: {
                format: { type: 'string', enum: ['json', 'list'], description: '返回格式：json（完整JSON含参数详情，信息更全）或 list（"函数名: 描述"简洁列表，节省 token）。默认 json' }
            }
        }
    },
{
        name: 'list_prompts',
        description: '列出所有可用的 MCP Prompt 模板名称（如 分析图纸/生成标注/导出报表等）。用户说"有什么模板/有什么预制功能"时调用。通过 get_prompt 查看模板详情和参数',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'get_prompt',
        description: '获取指定 Prompt 模板的详细内容（含参数说明和使用示例）。用户说"给我XX模板/查看XX模板"时调用。先用 list_prompts 查看有哪些可用模板',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Prompt 模板名称（从 list_prompts 结果中获取）' },
                args: { type: 'object', description: '模板参数对象，键值对形式（可选）。如 { arg1: "value1", arg2: "value2" }' }
            },
            required: ['name']
        }
    },
{ name: 'search_tools', description: '按关键词搜索工具名称和描述。用户说"有没有能XX的工具/怎么实现XX"时率先调用。返回匹配的工具列表及其分类。如搜索"阵列"可找到 array_polar/array_rectangular 等', inputSchema: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词，匹配工具名称和描述。如 "阵列"、"图层"、"块"、"打印"、"文字"、"标注"' } }, required: ['query'] } },
{ name: 'list_tools_by_category', description: '按分类浏览工具：绘图与3D、修改、图层、块、标注、打印、选择、查询、图纸集等。不传 category 则列出所有分类名和工具计数。用于发现某类功能的所有可用工具', inputSchema: { type: 'object', properties: { category: { type: 'string', description: '分类名称，如 "绘图与3D"、"修改"、"图层"、"块"、"标注"、"选择"、"查询"、"打印"、"图纸集"。不传则列出所有分类' } } } },
{ name: 'get_tool_info', description: '获取工具的详细元数据：完整参数列表及类型、分类(category)、只读(readOnlyHint)、破坏性(destructiveHint)标记。用户说"XX工具怎么用/参数是什么"时调用', inputSchema: { type: 'object', properties: { name: { type: 'string', description: '工具名称，如 "draw_circle"、"eval_lisp"、"batch_delete"。先用 search_tools 找到准确工具名' } }, required: ['name'] } },
];
