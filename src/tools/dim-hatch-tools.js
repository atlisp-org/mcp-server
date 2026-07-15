export const tools = [
{
        name: 'create_dimension',
        description: '创建尺寸标注。支持类型: ALIGNED(对齐)/LINEAR(线性)/ORDINATE(坐标)/RADIAL(半径)/DIAMETER(直径)/ANGULAR(角度)。先选类型再给点坐标',
        inputSchema: {
            type: 'object',
            properties: {
                type: { type: 'string', description: '标注类型: ALIGNED, LINEAR, ORDINATE, RADIAL, DIAMETER, ANGULAR' },
                points: { type: 'object', description: '点坐标: defPt, pt1, pt2', properties: { defPt: { type: 'string' }, pt1: { type: 'string' }, pt2: { type: 'string' } } },
                style: { type: 'object', description: '样式选项: leaderLength' }
            },
            required: ['type', 'points']
        }
    },
{
        name: 'get_dimension',
        description: '读取标注实体的测量值。用户问"这个标了多少"时调用',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '实体句柄' }
            },
            required: ['handle']
        }
    },
{
        name: 'create_hatch',
        description: '创建图案填充。填充图案如 ANSI31(斜线), ANSI32(交叉斜线), BRICK(砖), DOTS(点), AR-CONC(混凝土), SOLID(实心)',
        inputSchema: {
            type: 'object',
            properties: {
                patternName: { type: 'string', description: '填充图案名: ANSI31, ANSI32, BRICK, DOTS 等' },
                boundary: { type: 'object', description: '边界选择（可选）' },
                scale: { type: 'string', description: '比例（默认1）' },
                angle: { type: 'string', description: '角度（默认0）' }
            },
            required: ['patternName']
        }
    },
{
        name: 'set_hatch',
        description: '修改填充属性：pattern(图案名)、scale(比例)、angle(角度)、color(颜色号)',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '填充实体句柄' },
                props: { type: 'object', description: '属性: pattern, scale, angle, color' }
            },
            required: ['handle', 'props']
        }
    },
{
        name: 'get_block_attributes',
        description: '获取单个块参照的所有属性标签和值。对比 batch_get_block_attributes 只查单个',
        inputSchema: {
            type: 'object',
            properties: {
                blockHandle: { type: 'string', description: '块引用句柄' }
            },
            required: ['blockHandle']
        }
    },
{
        name: 'set_block_attribute',
        description: '修改单个块参照的指定属性标签的值。对比 batch_set_block_attributes 只改单个',
        inputSchema: {
            type: 'object',
            properties: {
                blockHandle: { type: 'string', description: '块引用句柄' },
                tag: { type: 'string', description: '属性标签' },
                value: { type: 'string', description: '属性值' }
            },
            required: ['blockHandle', 'tag', 'value']
        }
    },
{
        name: 'zoom_extents',
        description: '缩放至所有实体的整体范围（显示全部图形）。用户说"全屏/缩放全部/看全部"时调用',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'zoom_window',
        description: '缩放至指定窗口区域。用户说"放大某区域/看这里"时调用。p1,p2为对角点',
        inputSchema: {
            type: 'object',
            properties: {
                p1: { type: 'string', description: '角点1: x,y' },
                p2: { type: 'string', description: '角点2: x,y' }
            },
            required: ['p1', 'p2']
        }
    },
{
        name: 'create_named_view',
        description: '保存当前视图为命名视图，方便之后快速恢复',
        inputSchema: {
            type: 'object',
            properties: {
                viewName: { type: 'string', description: '视图名称' },
                center: { type: 'string', description: '中心点（可选）: x,y' }
            },
            required: ['viewName']
        }
    },
{
        name: 'restore_named_view',
        description: '切换到之前保存的命名视图。用户说"切换到XX视图"时调用',
        inputSchema: {
            type: 'object',
            properties: {
                viewName: { type: 'string', description: '视图名称' }
            },
            required: ['viewName']
        }
    },
{
        name: 'list_named_views',
        description: '列出当前 DWG 中所有命名视图的名称列表',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'export_dxf',
        description: '导出为 DXF 交换文件。version 可选 R2000/R2004/R2007/R2010/R2015/R2018',
        inputSchema: {
            type: 'object',
            properties: {
                outputPath: { type: 'string', description: '输出路径' },
                version: { type: 'string', description: '版本: R2018, R2015, R2010, R2007, R2004, R2000' }
            },
            required: ['outputPath']
        }
    },
{
        name: 'export_dwf',
        description: '导出为 DWF 三维/web 发布格式',
        inputSchema: {
            type: 'object',
            properties: {
                outputPath: { type: 'string', description: '输出路径' }
            },
            required: ['outputPath']
        }
    },
{
        name: 'batch_set_layer',
        description: '批量移动多个实体到指定图层。传入句柄数组和目标图层名。用户说"把这些移到XX图层"时调用',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { type: 'object', description: '句柄数组', items: { type: 'string' } },
                layerName: { type: 'string', description: '目标图层名' }
            },
            required: ['handles', 'layerName']
        }
    }
];
