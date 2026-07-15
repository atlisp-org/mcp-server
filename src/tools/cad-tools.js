export const tools = [
{
        name: 'open_cad',
        description: '首选：启动/连接 CAD 并使窗口前置。用户要求"打开CAD/启动CAD/开启CAD"或首次操作 CAD 前必须先调此工具。未指定平台时自动检测 AutoCAD > ZWCAD > GStarCAD > BricsCAD',
        inputSchema: {
            type: 'object',
            properties: {
                platform: { type: 'string', description: '指定 CAD 平台: AutoCAD（推荐，自动检测）, ZWCAD（中望）, GStarCAD（浩辰）, BricsCAD。不传则按 AutoCAD > ZWCAD > GStarCAD > BricsCAD 优先级自动检测' }
            }
        }
    },
{
        name: 'connect_cad',
        description: '连接到 CAD 后台（不切窗口）。open_cad 失败时可尝试此工具。自动检测 AutoCAD > ZWCAD > GStarCAD > BricsCAD',
        inputSchema: {
            type: 'object',
            properties: {
                platform: { type: 'string', description: '指定 CAD 平台: AutoCAD, ZWCAD, GStarCAD, BricsCAD（可选，自动检测）' }
            }
        }
    },
{
        name: 'eval_lisp',
        description: '在 CAD 中执行 AutoLISP 代码（不返回结果）。适用于设置变量、定义函数、执行命令等无需回读的场景。如需返回结果请用 eval_lisp_with_result',
        inputSchema: {
            type: 'object',
            properties: { code: { type: 'string', description: '要执行的 LISP 代码' } },
            required: ['code']
        }
    },
{
        name: 'eval_lisp_with_result',
        description: '在 CAD 中执行 AutoLISP 代码并返回结果字符串。适用查询(getvar/ssget/entget/tblnext等)或需要回读函数返回值的场景。有中文时建议 encoding=gbk',
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
        description: '获取当前连接的 CAD 信息（平台名称、版本号、文档名等）。首次了解 CAD 环境时调用',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'get_platform_info',
        description: '获取支持的 CAD 平台列表及当前连接状态。用于排查连接问题',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'at_command',
        description: '执行 @lisp 包管理器命令，如 package-install, system-info 等。需要 @lisp 环境已加载（先调用 init_atlisp）',
        inputSchema: {
            type: 'object',
            properties: { command: { type: 'string', description: '@lisp 命令' } },
            required: ['command']
        }
    },
{
        name: 'new_document',
        description: '在 CAD 中新建空白 DWG 文档。用户要求"新建文件/新建图纸"时调用',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'bring_to_front',
        description: '仅将 CAD 窗口切换到前台（不重新连接）。用户说"切换到CAD/显示CAD窗口/唤醒CAD"时调用。若未连接请先用 open_cad',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'install_atlisp',
        description: '在 CAD 中安装 @lisp 包管理器（首次使用前调用一次即可）。若已安装则跳过',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'init_atlisp',
        description: '加载 @lisp 函数库和初始变量到 CAD。若连接后自动加载失败可手动调用。执行 @lisp 函数前需先调用此工具',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'get_system_status',
        description: '获取完整诊断信息：MCP版本、Worker状态、CAD连接状态(Lisp可执行性)、已安装包。排查"工具不工作/CAD没反应"时优先调用',
        inputSchema: { type: 'object', properties: {} }
    },
{ name: 'get_system_variable', description: '读取 CAD 系统变量值。用户问"当前图层/捕捉状态/单位设置"时调用。传 * 列出所有变量及当前值', inputSchema: { type: 'object', properties: { name: { type: 'string', description: '系统变量名。传 * 列出所有系统变量及当前值' } }, required: ['name'] } },
{ name: 'set_system_variable', description: '设置 CAD 系统变量值，如修改图层/捕捉/osmode/单位等。需要知道变量名和合法值', inputSchema: { type: 'object', properties: { name: { type: 'string', description: '系统变量名' }, value: { type: 'string', description: '变量值（数值或字符串，不需引号）' } }, required: ['name', 'value'] } }
];
