export const tools = [
{
        name: 'trim_entity',
        description: '修剪实体(TRIM)：用剪切边切掉指定实体的多余部分。当用户说"修剪/切掉/裁剪"时调用。先选剪切边（作为刀），再选要被修剪的实体。一个实体既可以做剪切边也可以被修剪。反向操作用 extend_entity（延伸）。',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '要修剪的实体句柄——被剪掉多余部分的实体。如 "A1"' },
                cuttingEdgeHandle: { type: 'string', description: '剪切边实体句柄——作为"剪刀"的边界实体。如 "B1"' }
            },
            required: ['handle', 'cuttingEdgeHandle']
        }
    },
{
        name: 'extend_entity',
        description: '延伸实体(EXTEND)：将实体的一端延伸到与边界线相交的位置。当用户说"延伸/延长到"时调用。先选边界线，再选要延伸的实体。反向操作用 trim_entity（修剪）。',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '要延伸的实体句柄——需要被拉长的实体。如 "A1"' },
                boundaryHandle: { type: 'string', description: '边界实体句柄——延伸到的目标边界线。如 "B1"' }
            },
            required: ['handle', 'boundaryHandle']
        }
    },
{
        name: 'fillet',
        description: '圆角(FILLET)：在两个实体（线段/圆弧/多段线）之间创建指定半径的圆弧过渡连接。当用户说"倒圆角/圆角连接/做圆弧转角"时调用。radius=0 可将两线直接相连。尖角/斜角连接用 chamfer（倒角）。',
        inputSchema: {
            type: 'object',
            properties: {
                handle1: { type: 'string', description: '第一个实体句柄，如 "A1"' },
                handle2: { type: 'string', description: '第二个实体句柄，如 "B1"' },
                radius: { type: 'number', description: '圆角半径（正值）。如 50=半径50的圆弧过渡。输入 0 可让两线交点连接' }
            },
            required: ['handle1', 'handle2', 'radius']
        }
    },
{
        name: 'chamfer',
        description: '倒角(CHAMFER)：在两个实体之间创建指定距离的斜角（直线段）连接。当用户说"倒角/切角/做斜角"时调用。distance1 和 distance2 是两个实体上各自从交点量起的倒角距离。圆角连接用 fillet。',
        inputSchema: {
            type: 'object',
            properties: {
                handle1: { type: 'string', description: '第一个实体句柄，如 "A1"' },
                handle2: { type: 'string', description: '第二个实体句柄，如 "B1"' },
                distance1: { type: 'number', description: '第一个倒角距离（从交点沿第一个实体的距离）。如 50' },
                distance2: { type: 'number', description: '第二个倒角距离（从交点沿第二个实体的距离）。如 30' }
            },
            required: ['handle1', 'handle2', 'distance1', 'distance2']
        }
    },
{
        name: 'break_entity',
        description: '打断(BREAK)：在实体上两点之间断开，删除中间部分变成两段。当用户说"打断/断开/截断"时调用。如果两点重合则是在该点处切断（一分为二）。合并用 join_entities。',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '要打断的实体句柄，如 "A1"' },
                point1: { type: 'string', description: '第一个打断点坐标，如 "50,50"。断开将从这里开始' },
                point2: { type: 'string', description: '第二个打断点坐标，如 "100,100"。两点之间部分被删除' }
            },
            required: ['handle', 'point1', 'point2']
        }
    },
{
        name: 'join_entities',
        description: '合并(JOIN)：将多个端点相连的实体合并为一个整体（线段→多段线、圆弧→圆等）。当用户说"合并/连接/接起来"时调用。实体需要首尾相连才可合并。打断/分离用 break_entity。',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { type: 'array', description: '要合并的实体句柄列表（需首尾相连）。如 ["A1","B1","C1"]' }
            },
            required: ['handles']
        }
    },
{
        name: 'stretch',
        description: '拉伸(STRETCH)：通过交叉选择窗口移动实体的一部分（保持与其他部分的连接）。当用户说"拉伸/拉长/拉宽"时调用。需用交叉窗口（crossing）选择要拉伸的部分。配合 basePoint（基点）和 displacement（位移向量）使用。移动整个实体用 move_entity。',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { type: 'array', description: '要拉伸的实体句柄列表（交叉窗口选中的实体）。如 ["A1","B1"]' },
                basePoint: { type: 'string', description: '参考基点坐标，如 "0,0"。从该点开始测量位移' },
                displacement: { type: 'string', description: '位移目标点坐标，如 "100,50"。实体部分将从 basePoint 移动到 displacement' }
            },
            required: ['handles', 'basePoint', 'displacement']
        }
    }
];
