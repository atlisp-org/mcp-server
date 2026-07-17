export const tools = [
{
        name: 'batch_rename',
        description: '批量重命名多个实体（块参照、标注等）。{n} 自动替换为递增序号（如 "门-{n}" → 门-1, 门-2...）。当用户说"批量改名/统一命名"时调用。返回每个实体的旧名和新名对应关系。单个重命名用 set_block_attribute 或 set_entity。',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '实体句柄列表，可传逗号分隔的字符串或数组。如 "1A2,3B4" 或 ["1A2","3B4"]' },
                newNameTemplate: { type: 'string', description: '新名称模板，{n} 会被替换为递增序号。如 "门-{n}"、"轴{编号}"、"{n}F-柱"' },
                startNum: { type: 'integer', description: '起始序号，默认 1。如 startNum=10 会生成 门-10, 门-11...' }
            },
            required: ['handles', 'newNameTemplate']
        }
    },
{
        name: 'batch_move',
        description: '批量将实体移动到另一个图层（图层归属变更，非几何位移！）。fromLayer 可选过滤源图层。当用户说"把这些移到XX图层"时调用。几何位移请用 move_entity（dx/dy）。此工具已合并原 batch_set_layer 的功能，推荐统一使用 batch_move。',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '实体句柄列表。可传逗号分隔字符串或数组，如 "A1,B2,C3"' },
                fromLayer: { type: 'string', description: '源图层过滤（可选，只移动此图层上的实体）。例："墙体"' },
                toLayer: { type: 'string', description: '目标图层名称。实体将被移至该图层。例："已删除"' }
            },
            required: ['handles', 'toLayer']
        }
    },
{
        name: 'batch_copy',
        description: '批量复制多个实体，按 dx/dy/dz 偏移生成副本。当用户说"复制一份/拷贝到旁边"时调用。返回新生成实体的句柄数组。单个复制用 copy_entity。',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '实体句柄列表，如 "A1,B2" 或 ["A1","B2"]' },
                dx: { type: 'number', description: 'X 方向偏移量（正数向右，负数向左）。例：100' },
                dy: { type: 'number', description: 'Y 方向偏移量（正数向上，负数向下）。例：50' },
                dz: { type: 'number', description: 'Z 方向偏移量（可选，默认0）。仅3D场景需要。例：0' }
            },
            required: ['handles', 'dx', 'dy']
        }
    },
{
        name: 'batch_delete',
        description: '批量删除多个句柄指定的实体。危险操作，不可撤销！当用户说"删除这些/全删了/删掉"时调用。单个删除用 delete_entity。确认后再执行。',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '要删除的实体句柄列表。如 "A1,B2,C3" 或 ["A1","B2","C3"]' }
            },
            required: ['handles']
        }
    },
{
        name: 'batch_set_color',
        description: '批量修改多个实体的颜色。颜色号 0=ByLayer, 1=红, 2=黄, 3=绿, 4=青, 5=蓝, 6=紫, 7=白/黑, 8-255 其他。当用户说"把这些改成XX颜色"时调用。返回被修改的实体数量。使用 set_entity 可改单个。',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '实体句柄列表，如 "A1,B2"' },
                color: { type: 'integer', description: '颜色编号 (0-256)。0=ByLayer, 1=红, 2=黄, 3=绿, 5=蓝, 7=白' }
            },
            required: ['handles', 'color']
        }
    },
{
        name: 'batch_explode',
        description: '批量炸开多个复合实体为基本图元。不可逆！当用户说"炸开/分解"时调用。炸开后原实体消失，生成多个零散的图元（线段、圆弧等）。确认后再执行。',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '要炸开的复合实体句柄列表（块/多段线/标注等）。如 "A1,B2"' }
            },
            required: ['handles']
        }
    },
{
        name: 'batch_mirror',
        description: '批量镜像多个实体沿指定镜像线翻转。可保留（两侧都有）或删除原对象（只留镜像侧）。当用户说"镜像/对称复制"时调用。返回新生成实体的句柄数组。',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '实体句柄列表，如 "A1,B2"' },
                startPoint: { type: 'string', description: '镜像线起点，如 "0,0" 或 "100,50"' },
                endPoint: { type: 'string', description: '镜像线终点，镜像过两点连线。如 "100,0" 或 "200,50"' },
                deleteOriginal: { type: 'boolean', description: '是否删除原对象。true=删除原对象只保留镜像副本，false（默认）=两侧都保留' }
            },
            required: ['handles', 'startPoint', 'endPoint']
        }
    },
{
        name: 'batch_offset',
        description: '批量偏移多个实体指定距离。side=both 向两侧各偏一次生成两个新实体，side=single 只偏一侧。当用户说"偏移/向外偏移XX"时调用。返回新生成实体的句柄。单个偏移用 offset_entity。',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '实体句柄列表，如 "A1,B2"' },
                distance: { type: 'number', description: '偏移距离（正数）。如 50、100' },
                side: { type: 'string', enum: ['both', 'single'], description: '偏移侧：both=向两侧各偏一次，single=只偏一侧（随机选择侧，或使用 offset_entity 指定侧点）' }
            },
            required: ['handles', 'distance']
        }
    },
{
        name: 'batch_rotate',
        description: '批量旋转多个实体绕基点旋转指定角度。正数逆时针（数学正向），负数顺时针。当用户说"把这些旋转XX度"时调用。不传 basePoint 则默认绕各实体自身原点旋转。',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '实体句柄列表，如 "A1,B2"' },
                angle: { type: 'number', description: '旋转角度（度）。正数=逆时针，负数=顺时针。如 90=右转90度，-45=左转45度' },
                basePoint: { type: 'string', description: '公共旋转基点 (x,y)。如 "0,0" 或 "100,50"。所有实体绕此点旋转' }
            },
            required: ['handles', 'angle']
        }
    },
{
        name: 'batch_scale',
        description: '批量缩放多个实体。scaleFactor>1 放大，0<scaleFactor<1 缩小。当用户说"把这个放大一倍/缩小一半"时调用。不传 basePoint 则自动选择实体中心。',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '实体句柄列表，如 "A1,B2"' },
                scaleFactor: { type: 'number', description: '缩放比例。>1 放大（如 2=放大一倍），<1 缩小（如 0.5=缩小一半）。不能为 0 或负数' },
                basePoint: { type: 'string', description: '缩放基点 (x,y)。所有实体相对此点缩放。如 "0,0" 或 "50,50"（可选，默认各实体中心）' }
            },
            required: ['handles', 'scaleFactor']
        }
    },
{
        name: 'batch_set_linetype',
        description: '批量修改多个实体的线型。可用线型：Continuous（实线）、DASHED（虚线）、CENTER（中心线）、DOT（点线）、HIDDEN（隐藏线）、PHANTOM（双点划线）等。当用户说"改线型/改成虚线"时调用。需确保线型已加载。',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '实体句柄列表，如 "A1,B2"' },
                linetypeName: { type: 'string', description: '线型名称。常用：Continuous（实线）、DASHED（虚线）、CENTER（中心线）、DOT（点线）、HIDDEN（隐藏线）' }
            },
            required: ['handles', 'linetypeName']
        }
    },
{
        name: 'batch_match_properties',
        description: '格式刷：将源实体的属性（图层/颜色/线型/线宽/透明度等）复制到多个目标实体。当用户说"格式刷/刷属性/匹配属性"时调用。先选被复制的源实体，再选要刷的目标实体。',
        inputSchema: {
            type: 'object',
            properties: {
                sourceHandle: { type: 'string', description: '源实体句柄——格式刷的"模板"实体，其属性将被复制。如 "A1"' },
                targetHandles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '目标实体句柄列表——被刷属性的实体。如 "B1,B2,B3" 或 ["B1","B2","B3"]' }
            },
            required: ['sourceHandle', 'targetHandles']
        }
    },
{
        name: 'batch_create_group',
        description: '将多个实体一步创建为命名组（GROUP）。当用户说"编组/成组/创建组"时调用。组是命名的选择集，方便整体选择移动。如果组已存在则追加实体。返回创建的组名。查看已有组用 list_groups，添加实体到已有组用 batch_add_to_group。',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '组名称。如 "门窗组"、"轴线组"。名称在当前图形中应唯一' },
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '要编组的实体句柄列表。如 "A1,B2,C3" 或 ["A1","B2","C3"]' }
            },
            required: ['name', 'handles']
        }
    },
{
        name: 'batch_add_to_group',
        description: '向已有组中添加更多实体。当用户说"把某某也加到这个组里"时调用。组必须已存在（用 batch_create_group 或 create_group 创建）。查看已有组用 list_groups。',
        inputSchema: {
            type: 'object',
            properties: {
                groupName: { type: 'string', description: '要添加到的现有组名称。如 "门窗组"' },
                handles: { oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'string' }], description: '要加入组的实体句柄列表。如 "A1,B2"' }
            },
            required: ['groupName', 'handles']
        }
    },
{ name: 'move_entity', description: '单个实体几何位移（dx/dy 移动位置）。当用户说"把这个往右移XX/往上挪XX"时调用。批量几何位移用 batch_copy（带删除原对象方式）。注意：batch_move 是换图层不是位移！', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '要移动的实体句柄，如 "A1"' }, dx: { type: 'number', description: 'X 方向位移量。正数=右移，负数=左移。如 100' }, dy: { type: 'number', description: 'Y 方向位移量。正数=上移，负数=下移。如 50' }, dz: { type: 'number', description: 'Z 方向位移量（可选，默认0），仅3D场景需要。如 0' } }, required: ['handle','dx','dy'] } },
{ name: 'copy_entity', description: '单个实体复制——按 dx/dy/dz 偏移创建副本。当用户说"复制这个/拷贝一份"时调用。返回新实体句柄。批量复制多个用 batch_copy。', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '要复制的源实体句柄，如 "A1"' }, dx: { type: 'number', description: 'X 偏移量。正数=向右复制，负数=向左。如 100' }, dy: { type: 'number', description: 'Y 偏移量。正数=向上复制，负数=向下。如 50' }, dz: { type: 'number', description: 'Z 偏移量（可选，默认0）。仅3D场景需要。如 0' } }, required: ['handle','dx','dy'] } },
{ name: 'rotate_entity', description: '单个实体绕基点旋转指定角度。正数=逆时针旋转（数学正向），负数=顺时针旋转。当用户说"把这个转XX度"时调用。批量旋转用 batch_rotate。', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '要旋转的实体句柄，如 "A1"' }, angle: { type: 'number', description: '旋转角度（度）。正数=逆时针，负数=顺时针。如 90=逆时针90度，-45=顺时针45度' }, basePoint: { type: 'string', description: '旋转基点坐标，如 "0,0" 或 "100,50"（可选，默认实体中心）' } }, required: ['handle','angle'] } },
{ name: 'scale_entity', description: '单个实体按比例缩放。scaleFactor>1 放大，0<scaleFactor<1 缩小。当用户说"把这个放大/缩小"时调用。如 2=放大一倍，0.5=缩小一半。批量缩放用 batch_scale。', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '要缩放的实体句柄，如 "A1"' }, scaleFactor: { type: 'number', description: '缩放比例。如 2=放大一倍，0.5=缩小一半。不能为 0 或负数' }, basePoint: { type: 'string', description: '缩放基点坐标(可选，默认实体几何中心)。如 "0,0" 或 "50,50"' } }, required: ['handle','scaleFactor'] } },
{ name: 'mirror_entity', description: '单个实体沿镜像线翻转。当用户说"镜像/反射"时调用。deleteOriginal=true 则只保留镜像侧（类似 MoveMirror），false 则两侧都有。批量镜像用 batch_mirror。', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '要镜像的实体句柄，如 "A1"' }, startPoint: { type: 'string', description: '镜像线起点，如 "0,0"' }, endPoint: { type: 'string', description: '镜像线终点，如 "100,0"（水平镜像线）' }, deleteOriginal: { type: 'boolean', description: '是否删除原对象。true=只保留镜像副本，false（默认）=两侧都保留' } }, required: ['handle','startPoint','endPoint'] } },
{ name: 'offset_entity', description: '单个实体按距离偏移复制（创建平行副本）。当用户说"偏移/平行复制"时调用。side 是偏移方向侧的一个点坐标，用于确定偏移到哪一侧。批量偏移用 batch_offset。', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '要偏移的实体句柄，如 "A1"' }, distance: { type: 'number', description: '偏移距离（正数）。如 50、100' }, side: { type: 'string', description: '偏移方向侧点坐标 (x,y)——确定偏移到哪一侧。如 "10,0"=右侧、"0,10"=上方' } }, required: ['handle','distance','side'] } },
{ name: 'array_rectangular', description: '矩形阵列复制实体——按指定行数列数间距排列复制。当用户说"阵列/矩阵复制/行列复制/排一排"时调用。rows 行数, cols 列数, rowSpacing 行间距, colSpacing 列间距。所有正值表示向右向上排列。返回新生成实体句柄数组。环形阵列用 array_polar。', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '要阵列的实体句柄，如 "A1"' }, rows: { type: 'integer', description: '行数（>=1）。如 3=3行' }, cols: { type: 'integer', description: '列数（>=1）。如 4=4列' }, rowSpacing: { type: 'number', description: '行间距（正值=向上排列）。如 100' }, colSpacing: { type: 'number', description: '列间距（正值=向右排列）。如 200' } }, required: ['handle','rows','cols','rowSpacing','colSpacing'] } },
{ name: 'array_polar', description: '环形阵列实体——绕中心点旋转复制。当用户说"环形阵列/圆周阵列/绕圈复制"时调用。count=总项目数（含原实体），angle=填充角度（默认360度整圆）。返回新生成实体句柄数组。矩形阵列用 array_rectangular。', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '要阵列的实体句柄，如 "A1"' }, center: { type: 'string', description: '阵列中心点 x,y。如 "0,0" 或 "100,50"' }, count: { type: 'integer', description: '项目总数（含原实体）。如 8=一周均匀分布8个' }, angle: { type: 'number', description: '填充角度（度）。默认360=整圆，180=半圆。如 360、270、180' } }, required: ['handle','center','count'] } }
];
