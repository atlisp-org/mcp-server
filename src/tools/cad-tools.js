export const tools = [
{
        name: 'connect_cad',
        description: '连接到 CAD (AutoCAD/ZWCAD/GStarCAD/BricsCAD)',
        inputSchema: {
            type: 'object',
            properties: {
                platform: { type: 'string', description: '指定 CAD 平台: AutoCAD, ZWCAD, GStarCAD, BricsCAD（可选，自动检测）' }
            }
        }
    },
{
        name: 'eval_lisp',
        description: '在 CAD 中执行 AutoLISP 代码（不返回结果）',
        inputSchema: {
            type: 'object',
            properties: { code: { type: 'string', description: '要执行的 LISP 代码' } },
            required: ['code']
        }
    },
{
        name: 'eval_lisp_with_result',
        description: '在 CAD 中执行 AutoLISP 代码并返回结果',
        inputSchema: {
            type: 'object',
            properties: {
                code: { type: 'string', description: '要执行的 LISP 代码' },
                encoding: { type: 'string', description: '结果编码，如 utf-8, gbk, gb2312, gb18030（可选，默认自动检测）' }
            },
            required: ['code']
        }
    },
{
        name: 'get_cad_info',
        description: '获取当前 CAD 信息',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'get_platform_info',
        description: '获取 CAD 平台信息',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'at_command',
        description: '执行 @lisp 命令',
        inputSchema: {
            type: 'object',
            properties: { command: { type: 'string', description: '@lisp 命令' } },
            required: ['command']
        }
    },
{
        name: 'new_document',
        description: '在 CAD 中新建空白文档',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'bring_to_front',
        description: '将 CAD 窗口切换到前台（从后台运行状态唤醒）',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'install_atlisp',
        description: '在 CAD 中安装 @lisp',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'init_atlisp',
        description: '初始化 CAD 中的 @lisp 环境，加载函数库和初始变量',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'get_system_status',
        description: '获取完整系统诊断信息：MCP 状态、CAD 连接、Lisp 执行、包列表',
        inputSchema: { type: 'object', properties: {} }
    },
{ name: 'get_system_variable', description: '获取 CAD 系统变量值。输出字符串形式的值。使用 * 可列出所有系统变量', inputSchema: { type: 'object', properties: { name: { type: 'string', description: '系统变量名，使用 * 列出所有' } }, required: ['name'] } },
{ name: 'set_system_variable', description: '设置 CAD 系统变量值', inputSchema: { type: 'object', properties: { name: { type: 'string', description: '系统变量名' }, value: { type: 'string', description: '变量值' } }, required: ['name', 'value'] } }
];
