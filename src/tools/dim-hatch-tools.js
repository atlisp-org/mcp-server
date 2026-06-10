export const tools = [
{
        name: 'create_dimension',
        description: '创建标注 (ALIGNED/LINEAR/ORDINATE/RADIAL/DIAMETER/ANGULAR)',
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
        description: '获取标注值',
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
        description: '创建图案填充',
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
        description: '设置填充属性',
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
        description: '获取块属性',
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
        description: '设置块属性值',
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
        description: '缩放到图形范围',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'zoom_window',
        description: '缩放到窗口',
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
        description: '创建命名视图',
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
        description: '恢复命名视图',
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
        description: '列出所有命名视图',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'export_dxf',
        description: '导出 DXF 文件',
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
        description: '导出 DWF 文件',
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
        description: '批量设置实体图层',
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
