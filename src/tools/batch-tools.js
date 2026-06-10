export const tools = [
{
        name: 'batch_rename',
        description: '批量重命名实体',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '实体句柄列表' },
                newNameTemplate: { type: 'string', description: '新名称模板，{n} 会被替换为序号' },
                startNum: { type: 'integer', description: '起始序号（默认1）' }
            },
            required: ['handles', 'newNameTemplate']
        }
    },
{
        name: 'batch_move',
        description: '批量将实体移动到指定图层（按图层移动，非几何位移）',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '实体句柄列表' },
                fromLayer: { type: 'string', description: '源图层' },
                toLayer: { type: 'string', description: '目标图层' }
            },
            required: ['handles', 'toLayer']
        }
    },
{
        name: 'batch_copy',
        description: '批量复制实体到指定偏移',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '实体句柄列表' },
                dx: { type: 'number', description: 'X 偏移量' },
                dy: { type: 'number', description: 'Y 偏移量' },
                dz: { type: 'number', description: 'Z 偏移量（默认0）' }
            },
            required: ['handles', 'dx', 'dy']
        }
    },
{
        name: 'batch_delete',
        description: '批量删除实体',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '实体句柄列表' }
            },
            required: ['handles']
        }
    },
{
        name: 'batch_set_color',
        description: '批量设置实体颜色',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '实体句柄列表' },
                color: { type: 'integer', description: '颜色编号 (0-256)' }
            },
            required: ['handles', 'color']
        }
    },
{
        name: 'batch_explode',
        description: '批量炸开实体',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '实体句柄列表' }
            },
            required: ['handles']
        }
    },
{
        name: 'batch_mirror',
        description: '批量镜像实体',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '实体句柄列表' },
                startPoint: { type: 'string', description: '镜像线起点 (x,y)' },
                endPoint: { type: 'string', description: '镜像线终点 (x,y)' },
                deleteOriginal: { type: 'boolean', description: '是否删除原对象' }
            },
            required: ['handles', 'startPoint', 'endPoint']
        }
    },
{
        name: 'batch_offset',
        description: '批量偏移实体',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '实体句柄列表' },
                distance: { type: 'number', description: '偏移距离' },
                side: { type: 'string', enum: ['both', 'single'], description: '偏移侧' }
            },
            required: ['handles', 'distance']
        }
    },
{
        name: 'batch_rotate',
        description: '批量旋转实体',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '实体句柄列表' },
                angle: { type: 'number', description: '旋转角度（度）' },
                basePoint: { type: 'string', description: '基点 (x,y)' }
            },
            required: ['handles', 'angle']
        }
    },
{
        name: 'batch_scale',
        description: '批量缩放实体',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '实体句柄列表' },
                scaleFactor: { type: 'number', description: '缩放比例' },
                basePoint: { type: 'string', description: '基点 (x,y)' }
            },
            required: ['handles', 'scaleFactor']
        }
    },
{
        name: 'batch_set_linetype',
        description: '批量设置实体线型',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '实体句柄列表' },
                linetypeName: { type: 'string', description: '线型名称' }
            },
            required: ['handles', 'linetypeName']
        }
    },
{
        name: 'batch_match_properties',
        description: '批量匹配属性（格式刷）',
        inputSchema: {
            type: 'object',
            properties: {
                sourceHandle: { type: 'string', description: '源实体句柄' },
                targetHandles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '目标实体句柄列表' }
            },
            required: ['sourceHandle', 'targetHandles']
        }
    },
{
        name: 'batch_create_group',
        description: '批量创建组',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '组名称' },
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '实体句柄列表' }
            },
            required: ['name', 'handles']
        }
    },
{
        name: 'batch_add_to_group',
        description: '批量添加实体到组',
        inputSchema: {
            type: 'object',
            properties: {
                groupName: { type: 'string', description: '组名称' },
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '实体句柄列表' }
            },
            required: ['groupName', 'handles']
        }
    },
{ name: 'move_entity', description: '移动单个实体', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '实体句柄' }, dx: { type: 'number', description: 'X偏移' }, dy: { type: 'number', description: 'Y偏移' }, dz: { type: 'number', description: 'Z偏移(可选,默认0)' } }, required: ['handle','dx','dy'] } },
{ name: 'copy_entity', description: '复制单个实体', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '实体句柄' }, dx: { type: 'number', description: 'X偏移' }, dy: { type: 'number', description: 'Y偏移' }, dz: { type: 'number', description: 'Z偏移(可选,默认0)' } }, required: ['handle','dx','dy'] } },
{ name: 'rotate_entity', description: '旋转单个实体', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '实体句柄' }, angle: { type: 'number', description: '旋转角度(度)' }, basePoint: { type: 'string', description: '基点 x,y' } }, required: ['handle','angle'] } },
{ name: 'scale_entity', description: '缩放单个实体', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '实体句柄' }, scaleFactor: { type: 'number', description: '缩放比例' }, basePoint: { type: 'string', description: '基点(可选,默认0,0)' } }, required: ['handle','scaleFactor'] } },
{ name: 'mirror_entity', description: '镜像单个实体', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '实体句柄' }, startPoint: { type: 'string', description: '镜像线起点 x,y' }, endPoint: { type: 'string', description: '镜像线终点 x,y' }, deleteOriginal: { type: 'boolean', description: '是否删除原对象' } }, required: ['handle','startPoint','endPoint'] } },
{ name: 'offset_entity', description: '偏移单个实体', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '实体句柄' }, distance: { type: 'number', description: '偏移距离' }, side: { type: 'string', description: '偏移方向 side point x,y' } }, required: ['handle','distance','side'] } },
{ name: 'array_rectangular', description: '矩形阵列实体', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '实体句柄' }, rows: { type: 'integer', description: '行数' }, cols: { type: 'integer', description: '列数' }, rowSpacing: { type: 'number', description: '行间距' }, colSpacing: { type: 'number', description: '列间距' } }, required: ['handle','rows','cols','rowSpacing','colSpacing'] } },
{ name: 'array_polar', description: '环形阵列实体', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '实体句柄' }, center: { type: 'string', description: '阵列中心点 x,y' }, count: { type: 'integer', description: '项目数' }, angle: { type: 'number', description: '填充角度(默认360)' } }, required: ['handle','center','count'] } }
];
