export const tools = [
{
        name: 'get_entity',
        description: '获取单个实体的基本属性。当用户问"这是什么/查询实体/这个物体是什么"时调用。返回实体类型、图层、颜色、线型、坐标等（无扩展数据）。只读。对比 get_entity_info（返回更详细的完整 DXF 组码）。',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '目标实体句柄（16进制字符串，如 "1A2B"）。先通过 select_entities 或 find_* 工具获取' }
            },
            required: ['handle']
        },
        outputSchema: {
            type: 'object',
            properties: {
                type: { type: 'string', description: '实体 DXF 类型，如 LINE/CIRCLE/TEXT/INSERT' },
                handle: { type: 'string', description: '实体句柄（16进制）' },
                layer: { type: 'string', description: '所在图层名' },
                color: { type: 'number', description: '颜色号（256=ByLayer，256 以下为索引色）' },
                linetype: { type: 'string', description: '线型名（ByLayer=随层）' },
                elevation: { type: 'number', description: '标高（Z 值，图形单位）' },
                raw: { type: 'string', description: '原始文本（仅当返回值无法解析为键值对时出现）' }
            },
            required: ['type', 'handle', 'layer']
        }
    },
{
        name: 'set_entity',
        description: '修改单个实体的基本属性。当用户说"把这个改成XX色/换到XX图层/改线型"时调用。支持修改: layer(图层归属)、color(颜色号)、linetype(线型名)、elevation(标高)。destructive——直接修改原实体。对比 batch_match_properties：用源实体批量复制属性。',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '目标实体句柄（get_entity / select_entities 返回的 Handle，如 "1F3A"）' },
                property: { type: 'string', description: '要修改的属性: layer(图层), color(颜色号1-255), linetype(线型名), elevation(标高Z值)' },
                value: { type: 'string', description: '属性值。color 传数字(1-255)，如 "1"=红、"2"=黄。linetype 传线型名如 "DASHED"、"CENTER"。layer 传图层名如 "0"、"墙体"' }
            },
            required: ['handle', 'property', 'value']
        }
    },
{
        name: 'delete_entity',
        description: '删除单个实体。当用户说"删除某物体/擦除/移除"时调用。destructive——删除后不可恢复（除非撤回undo操作）。批量删除请用 batch_delete，单个操作推荐此工具。',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '要删除的实体句柄（get_entity / dwg/entities 返回的 Handle）' }
            },
            required: ['handle']
        }
    },
{
        name: 'select_entities',
        description: '按条件(type/layer)过滤选择实体。当用户说"选出/找到/选择所有XX"时调用。返回句柄数组(string[])。结果可传给 batch_delete/batch_move/batch_set_layer 等批量工具。这是获取实体句柄的主要入口。只读。',
        inputSchema: {
            type: 'object',
            properties: {
                filter: { type: 'object', description: '过滤条件对象: { type: "LINE", layer: "0" }。type 可选 LINE/CIRCLE/TEXT/ARC/MTEXT/LWPOLYLINE/SPLINE/ELLIPSE/INSERT(块参照)/HATCH/DIMENSION/RAY/XLINE 等。未指定 type 返回所有类型。未指定 layer 返回所有图层。留空 {} 选择全部实体。' }
            }
        },
        outputSchema: {
            type: 'object',
            properties: {
                count: { type: 'number', description: '匹配的实体数量' },
                handles: { type: 'array', items: { type: 'string' }, description: '匹配实体的句柄数组' },
                raw: { type: 'string', description: '原始文本（仅当无匹配或无法解析时出现）' }
            },
            required: ['count', 'handles']
        }
    },
{ name: 'bring_to_front_entity', description: '将指定实体移到显示顺序最前（覆盖在其他所有实体之上）。当用户说"把这个置前/移到最前"时调用。影响显示顺序，不改变图层。destructive（视觉上）。对比 send_to_back_entity。', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '要置前的实体句柄（目标实体 Handle）' } }, required: ['handle'] } },
{ name: 'send_to_back_entity', description: '将指定实体移到显示顺序最后（被其他实体覆盖）。当用户说"把这个置后/移到最后"时调用。影响显示顺序。destructive（视觉上）。对比 bring_to_front_entity。', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '要置后的实体句柄（目标实体 Handle）' } }, required: ['handle'] } },
{ name: 'bring_above_entity', description: '将目标实体置于参照实体上方（调整显示顺序）。当用户说"把这个放到XX上面"时调用。两个实体都需要句柄。destructive（视觉上）。对比 bring_to_front_entity（直接置顶）和 send_below_entity。', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '目标实体句柄（要移动的实体）' }, referenceHandle: { type: 'string', description: '参照实体句柄（目标将置于此实体上方）' } }, required: ['handle', 'referenceHandle'] } },
{ name: 'send_below_entity', description: '将目标实体置于参照实体下方（调整显示顺序）。当用户说"把这个放到XX下面"时调用。两个实体都需要句柄。destructive（视觉上）。对比 bring_above_entity。', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '目标实体句柄（要移动的实体）' }, referenceHandle: { type: 'string', description: '参照实体句柄（目标将置于此实体下方）' } }, required: ['handle', 'referenceHandle'] } },
{ name: 'select_all', description: '选择当前图形中所有实体，返回句柄数组(string[])。当用户说"全选/选所有/选全部"时调用。适合在批量操作前获取全部实体。只读。', inputSchema: { type: 'object', properties: {} } },
{ name: 'select_last', description: '选择最后创建的一个实体，返回其句柄。当用户说"取最后一个/刚画的那个"时调用。适合在创建实体后立即获取句柄以进行后续操作。只读。', inputSchema: { type: 'object', properties: {} } },
{ name: 'select_by_color', description: '按颜色索引号选择实体，返回句柄数组(string[])。当用户说"找出所有红色/选中XX颜色的"时调用。颜色号范围 1-255。只读。', inputSchema: { type: 'object', properties: { colorIndex: { type: 'integer', description: '颜色索引号 (1-255)。常用: 1=Red(红),2=Yellow(黄),3=Green(绿),4=Cyan(青),5=Blue(蓝),6=Magenta(紫),7=White/Black(白/黑)' } }, required: ['colorIndex'] } }
];
