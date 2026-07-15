export const tools = [
{
        name: 'batch_rename',
        description: '批量重命名实体（如块参照、标注等）。{n} 会被替换为序号',
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
        description: '批量将实体移动到另一个图层（图层归属变更，非几何位移）。fromLayer 可选过滤源图层',
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
        description: '批量复制多个实体，按 dx/dy/dz 偏移生成副本',
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
        description: '批量删除多个实体。用户说"删除这些/全删了"时调用。不可撤销！',
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
        description: '批量修改多个实体的颜色。颜色号 0=ByLayer, 1-255 具体颜色',
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
        description: '批量炸开多个实体为基本图元。不可逆',
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
        description: '批量镜像多个实体。可保留或删除原对象',
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
        description: '批量偏移多个实体。side=both 向两侧各偏移一次，side=single 只偏一侧',
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
        description: '批量旋转多个实体绕基点旋转指定角度',
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
        description: '批量缩放多个实体。scaleFactor>1放大，<1缩小',
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
        description: '批量修改多个实体的线型。如 Continuous, DASHED, CENTER, DOT, HIDDEN 等',
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
        description: '格式刷：将源实体的属性（图层/颜色/线型等）复制到多个目标实体',
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
        description: '将多个实体一步创建为命名组',
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
        description: '向已有组中添加更多实体',
        inputSchema: {
            type: 'object',
            properties: {
                groupName: { type: 'string', description: '组名称' },
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '实体句柄列表' }
            },
            required: ['groupName', 'handles']
        }
    },
{ name: 'move_entity', description: '单个实体移动（几何位移 dx/dy）', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '实体句柄' }, dx: { type: 'number', description: 'X 偏移量' }, dy: { type: 'number', description: 'Y 偏移量' }, dz: { type: 'number', description: 'Z 偏移量(可选,默认0)' } }, required: ['handle','dx','dy'] } },
{ name: 'copy_entity', description: '单个实体复制（偏移 dx/dy 创建副本）', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '实体句柄' }, dx: { type: 'number', description: 'X 偏移量' }, dy: { type: 'number', description: 'Y 偏移量' }, dz: { type: 'number', description: 'Z 偏移量(可选,默认0)' } }, required: ['handle','dx','dy'] } },
{ name: 'rotate_entity', description: '单个实体绕基点旋转指定角度（度）', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '实体句柄' }, angle: { type: 'number', description: '旋转角度（度，正数逆时针）' }, basePoint: { type: 'string', description: '基点坐标 x,y' } }, required: ['handle','angle'] } },
{ name: 'scale_entity', description: '单个实体按比例缩放。scaleFactor>1放大，<1缩小', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '实体句柄' }, scaleFactor: { type: 'number', description: '缩放比例（>1放大，<1缩小）' }, basePoint: { type: 'string', description: '基点坐标(可选,默认0,0)' } }, required: ['handle','scaleFactor'] } },
{ name: 'mirror_entity', description: '单个实体沿镜像线翻转。可保留或删除原对象', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '实体句柄' }, startPoint: { type: 'string', description: '镜像线起点 x,y' }, endPoint: { type: 'string', description: '镜像线终点 x,y' }, deleteOriginal: { type: 'boolean', description: '是否删除原对象（默认false）' } }, required: ['handle','startPoint','endPoint'] } },
{ name: 'offset_entity', description: '单个实体按距离偏移复制', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '实体句柄' }, distance: { type: 'number', description: '偏移距离' }, side: { type: 'string', description: '偏移方向侧点坐标 x,y（确定偏移到哪一侧）' } }, required: ['handle','distance','side'] } },
{ name: 'array_rectangular', description: '矩形阵列实体（行列复制）。用户说"阵列/矩阵复制"时调用', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '实体句柄' }, rows: { type: 'integer', description: '行数' }, cols: { type: 'integer', description: '列数' }, rowSpacing: { type: 'number', description: '行间距' }, colSpacing: { type: 'number', description: '列间距' } }, required: ['handle','rows','cols','rowSpacing','colSpacing'] } },
{ name: 'array_polar', description: '环形阵列实体（绕中心点旋转复制）。用户说"环形阵列"时调用', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '实体句柄' }, center: { type: 'string', description: '阵列中心点 x,y' }, count: { type: 'integer', description: '项目数（含原实体）' }, angle: { type: 'number', description: '填充角度(默认360度)' } }, required: ['handle','center','count'] } }
];
