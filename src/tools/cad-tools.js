export const tools = [
{
        name: 'open_cad',
        description: '首次操作 CAD 前必调。用户说"打开CAD/启动CAD/开启CAD"时调用。如果 CAD 未启动则启动它，已运行则连接并使窗口前置。自动检测 AutoCAD > ZWCAD > GStarCAD > BricsCAD。如需后台连接不切窗口请用 connect_cad',
        inputSchema: {
            type: 'object',
            properties: {
                platform: { type: 'string', description: '指定 CAD 平台: AutoCAD（推荐）, ZWCAD（中望）, GStarCAD（浩辰）, BricsCAD。不传则按 AutoCAD > ZWCAD > GStarCAD > BricsCAD 优先级自动检测' }
            }
        }
    },
{
        name: 'connect_cad',
        description: '后台连接 CAD（不切窗口），适合 open_cad 失败时的备用方案。用户说"连CAD/连接CAD"时使用。自动检测 AutoCAD > ZWCAD > GStarCAD > BricsCAD。如需窗口前置请用 open_cad',
        inputSchema: {
            type: 'object',
            properties: {
                platform: { type: 'string', description: '指定 CAD 平台: AutoCAD, ZWCAD, GStarCAD, BricsCAD。不传则自动检测' }
            }
        }
    },
{
        name: 'eval_lisp',
        description: '在 CAD 中执行 AutoLISP 代码，无返回值。用户说"执行代码/运行Lisp"时调用。适用于设置变量、定义函数、执行命令等无需回读的场景。如需读取结果请用 eval_lisp_with_result',
        inputSchema: {
            type: 'object',
            properties: { code: { type: 'string', description: '要执行的 AutoLISP 代码，如 (setq a 1) 或 (command "line" "0,0" "100,100" "")' } },
            required: ['code']
        }
    },
{
        name: 'eval_lisp_with_result',
        description: '在 CAD 中执行 AutoLISP 代码并返回结果。用户说"查变量/查状态/查数据"时调用。适用查询(getvar/ssget/entget/tblnext)或需要回读函数返回值的场景。有中文时建议 encoding=gbk。不关心结果时用 eval_lisp',
        inputSchema: {
            type: 'object',
            properties: {
                code: { type: 'string', description: '要执行的 AutoLISP 代码，如 (getvar "clayer") 或 (ssget "_X")' },
                encoding: { type: 'string', description: '结果编码: utf-8（推荐）, gbk, gb2312, gb18030。含中文时建议 gbk（默认自动检测）' }
            },
            required: ['code']
        }
    },
{
        name: 'get_cad_info',
        description: '获取当前 CAD 连接信息：平台名称、版本号、文档名、是否已连接等。首次了解 CAD 环境时优先调用。用户问"现在用的是哪个CAD/当前环境"时使用',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'get_platform_info',
        description: '获取支持的所有 CAD 平台列表及当前连接状态。用户问"支持哪些CAD"或排查连接问题时调用。如 get_cad_info 返回断开结果可先查此工具了解可用的平台',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'at_command',
        description: '执行 @lisp 包管理器命令。当用户说"运行@lisp命令/装包/查系统信息/升级包"时调用。前置条件：需先调用 init_atlisp 加载 @lisp 环境。示例命令: package-install(装包)、system-info(系统信息)、package-list(已安装列表)、package-update-all(升级所有包)',
        inputSchema: {
            type: 'object',
            properties: { command: { type: 'string', description: '@lisp 命令，如 "system-info"、"package-install <包名>"、"package-list"' } },
            required: ['command']
        }
    },
{
        name: 'new_document',
        description: '在 CAD 中新建空白 DWG 文档。用户说"新建文件/新建图纸/新图"时调用。会基于默认模板创建新图形',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'bring_to_front',
        description: '将 CAD 窗口切换到前台（不重新连接）。用户说"显示CAD/切换到CAD/唤醒CAD/看CAD"时调用。前置条件：已通过 open_cad 或 connect_cad 建立连接',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'send_esc',
        description: '向 CAD 发送 ESC 键（不经过 LISP、不需要活动文档）。用户说"取消/中断/关掉弹窗/让CAD停下来"时调用。用于取消命令行挂起、关闭对话框、解除卡死。依赖系统消息队列，可作用于模态弹窗',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'install_atlisp',
        description: '在 CAD 中安装 @lisp 包管理器（首次使用前调用一次即可）。当用户说"安装@lisp/准备@lisp环境"时调用。安装后需调用 init_atlisp 加载。若已安装则自动跳过，返回已安装信息',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'init_atlisp',
        description: '加载 @lisp 函数库和初始变量到 CAD。当用户需要用到 @lisp 函数/包时调用。前置条件：CAD 已连接，@lisp 已安装(install_atlisp)。所有 @lisp 工具(list_packages/at_command/search_packages等)前需先调用此工具。若自动加载失败可手动调用',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'get_system_status',
        description: '获取完整诊断信息：MCP版本、Worker状态、CAD连接状态(Lisp可执行性)、已安装包。用户说"工具不工作/CAD没反应/查一下状态"时优先调用。先于 get_cad_info 用于深度排查',
        inputSchema: { type: 'object', properties: {} }
    },
{ name: 'get_system_variable', description: '读取 CAD 系统变量值。用户问"当前图层/捕捉状态/单位设置/当前颜色"时调用。传 * 列出所有变量及当前值。如查当前图层传 name="clayer"', inputSchema: { type: 'object', properties: { name: { type: 'string', description: '系统变量名，如 clayer(当前图层)、osmode(捕捉位码)、lunits(单位格式)、dimscale(标注比例)。传 * 列出所有系统变量' } }, required: ['name'] } },
{ name: 'set_system_variable', description: '设置 CAD 系统变量值。用户说"改图层/设捕捉/改单位/改颜色"时调用。需知道变量名和合法值，先用 get_system_variable 查询当前值。如切到0图层传 name="clayer" value="0"', inputSchema: { type: 'object', properties: { name: { type: 'string', description: '系统变量名，如 clayer(当前图层)、osmode(捕捉位码)、lunits(单位制式)、dimscale(标注比例)' }, value: { type: 'string', description: '变量值（数值或字符串，不需引号）。如 "0"(图层名)、"1"(开)、"0"(关)、"4133"(osmode位码)' } }, required: ['name', 'value'] } }
];
