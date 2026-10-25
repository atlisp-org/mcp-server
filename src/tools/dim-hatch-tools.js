export const tools = [
{
        name: 'create_dimension',
        description: '创建尺寸标注(DIMENSION)。当用户说"标尺寸/标注/量尺寸"时调用。支持6种类型（见 type 参数：对齐/水平垂直/坐标/半径/直径/角度）。返回新标注实体的句柄。idempotent——每次调用创建一个新标注。',
        inputSchema: {
            type: 'object',
            properties: {
                type: { type: 'string', description: '标注类型: "ALIGNED"(对齐,平行于两点), "LINEAR"(水平/垂直), "ORDINATE"(坐标标注), "RADIAL"(半径), "DIAMETER"(直径), "ANGULAR"(角度)。' },
                points: { type: 'object', description: '点坐标对象。格式: { defPt: "位置", pt1: "起点", pt2: "终点" }。defPt=标注线位置, pt1/pt2=测量点。RADIAL/DIAMETER: defPt=圆心, pt1=圆上点。ANGULAR: pt1=顶点, pt2=起点, defPt=终点。坐标格式 "x,y"。' },
                style: { type: 'object', description: '样式选项（可选）。{ leaderLength: 10 } 指定引线长度。其他标注系统变量通过 set_dimstyle_var 设置。' }
            },
            required: ['type', 'points']
        }
    },
{
        name: 'get_dimension',
        description: '读取标注实体的测量值及相关属性。当用户问"这个标了多少/尺寸多少"时调用。返回标注的实际测量值、标注文字和样式信息。只读。',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '标注实体句柄。先通过 select_entities({type:"DIMENSION"}) 查找标注。' }
            },
            required: ['handle']
        }
    },
{
        name: 'create_hatch',
        description: '创建图案填充(HATCH)。当用户说"填充/加填充图案/画斜线"时调用。自动拾取边界实体。返回新填充实体的句柄。idempotent。注意：边界需为闭合实体（封闭多段线/圆/椭圆/面域）。对比 draw_hatch（用点序列定义边界）。',
        inputSchema: {
            type: 'object',
            properties: {
                patternName: { type: 'string', description: '填充图案名。常用: "ANSI31"(45°斜线)、"ANSI32"(交叉斜线)、"BRICK"(砖)、"DOTS"(点)、"AR-CONC"(混凝土)、"SOLID"(实心填充)。' },
                boundary: { type: 'object', description: '边界选择参数（可选）。不传则自动选择闭合边界。{ type: "select", handles: ["1A2B","3C4D"] } 指定边界实体句柄。' },
                scale: { type: 'string', description: '填充比例（默认 "1"），控制图案疏密。如 "2"=放大2倍更稀疏，"0.5"=缩小更密集。' },
                angle: { type: 'string', description: '填充角度（默认 "0"），单位为度。如 "45"=旋转45°。' }
            },
            required: ['patternName']
        }
    },
{
        name: 'set_hatch',
        description: '修改已有填充的图案属性。当用户说"改填充/换填充图案/调填充比例"时调用。支持修改: pattern(图案名)、scale(比例)、angle(角度)、color(颜色号)。destructive——直接修改原填充实体。对比 create_hatch（创建新填充）。',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '填充实体句柄。先通过 select_entities({type:"HATCH"}) 查找。' },
                props: { type: 'object', description: '要修改的属性对象。可选字段: { pattern: "ANSI31", scale: "2", angle: "45", color: "1" }。只传需修改的字段。' }
            },
            required: ['handle', 'props']
        }
    },
{
        name: 'get_block_attributes',
        description: '获取单个块参照的所有属性(ATTRIB)标签和值。当用户说"查这个块的属性/这个块带什么数据"时调用。只读。对比 batch_get_block_attributes（批量查多个块）。前置条件：块需有定义的属性标签。',
        inputSchema: {
            type: 'object',
            properties: {
                blockHandle: { type: 'string', description: '块引用实体的句柄。先通过 select_entities({type:"INSERT"}) 获取。' }
            },
            required: ['blockHandle']
        }
    },
{
        name: 'set_block_attribute',
        description: '修改单个块参照的指定属性标签的值。当用户说"改这个块的XX属性值"时调用。destructive——直接修改原块属性值。对比 batch_set_block_attributes（批量改多个块）。前置条件：块需有指定 tag 的属性定义。',
        inputSchema: {
            type: 'object',
            properties: {
                blockHandle: { type: 'string', description: '块引用实体句柄（INSERT 的 Handle，不是块定义名；get_block_attributes 可返回）' },
                tag: { type: 'string', description: '属性标签名称，如 "编号"、"规格"、"材质"。通过 get_block_attributes 可查看所有标签。' },
                value: { type: 'string', description: '要设置的新属性值，如 "D001"、"C30混凝土"。' }
            },
            required: ['blockHandle', 'tag', 'value']
        }
    },
{
        name: 'zoom_extents',
        description: '缩放至所有实体的整体范围（显示全部图形）。当用户说"全屏/缩放全部/看全部/显示整个图纸"时调用。确保所有实体都可见。只读/idempotent——仅改变视图，不修改图形。',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'zoom_window',
        description: '缩放至指定矩形窗口区域。当用户说"放大某区域/看这里/放大这个范围"时调用。p1/p2 为对角角点。只读/idempotent——仅改变视图。',
        inputSchema: {
            type: 'object',
            properties: {
                p1: { type: 'string', description: '窗口第一个角点坐标，如 "0,0"' },
                p2: { type: 'string', description: '窗口对角点坐标，如 "100,100"。两点定义缩放区域。' }
            },
            required: ['p1', 'p2']
        }
    },
{
        name: 'create_named_view',
        description: '保存当前视图为命名视图。当用户说"保存当前视图/创建视图"时调用。之后可用 restore_named_view 快速恢复。idempotent——同名视图会被覆盖。前置条件：当前图形需已保存（有文件名）。',
        inputSchema: {
            type: 'object',
            properties: {
                viewName: { type: 'string', description: '视图名称，用于之后恢复。如 "平面图-1层"、"立面图-A轴"。' },
                center: { type: 'string', description: '视图中心点（可选），如 "500,500"。不传则使用当前视图中心。' }
            },
            required: ['viewName']
        }
    },
{
        name: 'restore_named_view',
        description: '切换到之前保存的命名视图。当用户说"切换到XX视图/恢复XX视图"时调用。视图由 create_named_view 预先保存。只读/idempotent——仅改变视图。',
        inputSchema: {
            type: 'object',
            properties: {
                viewName: { type: 'string', description: '要恢复的视图名称，通过 list_named_views 可查看所有已保存视图。' }
            },
            required: ['viewName']
        }
    },
{
        name: 'list_named_views',
        description: '列出当前 DWG 中所有命名视图的名称列表。当用户问"有哪些视图/保存了哪些视图"时调用。只读。用于 restore_named_view 前查找可用视图。',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'export_dxf',
        description: '导出当前图形为 DXF 交换文件。当用户说"导出DXF/转DXF"时调用。version 参数控制兼容性（高版本支持更多特性但兼容性差）。idempotent——每次调用创建新文件。前置条件：图形需先保存。',
        inputSchema: {
            type: 'object',
            properties: {
                outputPath: { type: 'string', description: '输出文件完整路径，如 "C:\\projects\\drawing.dxf"。确保目录存在。' },
                version: { type: 'string', description: 'DXF 版本: "R2018"(最新), "R2015", "R2010", "R2007", "R2004", "R2000"(最兼容)。高版本支持更多特性，低版本兼容旧版 CAD。默认 R2018。' }
            },
            required: ['outputPath']
        }
    },
{
        name: 'export_dwf',
        description: '导出当前图形为 DWF（Design Web Format）格式。当用户说"导出DWF/发布DWF"时调用。DWF 用于设计审查和 Web 发布，文件比 DWG 小。idempotent。前置条件：图形需先保存。',
        inputSchema: {
            type: 'object',
            properties: {
                outputPath: { type: 'string', description: '输出文件完整路径，如 "C:\\projects\\drawing.dwf"。' }
            },
            required: ['outputPath']
        }
    }
];
