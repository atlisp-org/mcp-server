export const tools = [
{
        name: 'get_entity',
        description: '获取单个实体属性（句柄/类型/图层/颜色/线型/坐标等）。通过 handle 查询。想知道某实体是什么时调用',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '实体句柄' }
            },
            required: ['handle']
        }
    },
{
        name: 'set_entity',
        description: '修改单个实体的属性值。支持: layer(图层)/color(颜色号)/linetype(线型名)/elevation(标高)',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '实体句柄' },
                property: { type: 'string', description: '属性名: layer, color, linetype, elevation' },
                value: { type: 'string', description: '属性值' }
            },
            required: ['handle', 'property', 'value']
        }
    },
{
        name: 'delete_entity',
        description: '删除单个实体。用户说"删除某物体/擦除"时调用。批量删除请用 batch_delete',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '实体句柄' }
            },
            required: ['handle']
        }
    },
{
        name: 'select_entities',
        description: '按条件(type/layer)过滤选择实体，返回句柄数组(string[])。结果可传给 batch_delete/batch_move/batch_set_layer 等批量工具。这是获取句柄的主要入口',
        inputSchema: {
            type: 'object',
            properties: {
                filter: { type: 'object', description: '过滤条件: { type: "LINE", layer: "0" }。type 可选 LINE/CIRCLE/TEXT/ARC/etc，layer 为图层名' }
            }
        }
    },
{ name: 'bring_to_front_entity', description: '将指定实体移到显示顺序最前（覆盖在其他实体之上）', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '实体句柄' } }, required: ['handle'] } },
{ name: 'send_to_back_entity', description: '将指定实体移到显示顺序最后（被其他实体覆盖）', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '实体句柄' } }, required: ['handle'] } },
{ name: 'bring_above_entity', description: '将目标实体置于参照实体上方（调整显示顺序）', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '目标实体句柄' }, referenceHandle: { type: 'string', description: '参照实体句柄' } }, required: ['handle', 'referenceHandle'] } },
{ name: 'send_below_entity', description: '将目标实体置于参照实体下方（调整显示顺序）', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '目标实体句柄' }, referenceHandle: { type: 'string', description: '参照实体句柄' } }, required: ['handle', 'referenceHandle'] } },
{ name: 'select_all', description: '选择当前图形中所有实体，返回句柄数组。适合批量操作前全选', inputSchema: { type: 'object', properties: {} } },
{ name: 'select_last', description: '选择最后创建的一个实体，返回句柄。刚创建的实体想获取其句柄时调用', inputSchema: { type: 'object', properties: {} } },
{ name: 'select_by_color', description: '按颜色索引号选择实体，返回句柄数组。颜色号范围 1-255（1=红,2=黄,3=绿等）', inputSchema: { type: 'object', properties: { colorIndex: { type: 'integer', description: '颜色索引号 (1-255)。1=Red,2=Yellow,3=Green,5=Blue,7=White/Black' } }, required: ['colorIndex'] } }
];
