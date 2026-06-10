export const tools = [
{
        name: 'get_entity',
        description: '获取实体属性信息',
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
        description: '设置实体属性（layer/color/linetype/elevation）',
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
        description: '删除实体',
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
        description: '按条件选择实体，返回句柄列表',
        inputSchema: {
            type: 'object',
            properties: {
                filter: { type: 'object', description: '过滤条件: type, layer' }
            }
        }
    },
{ name: 'bring_to_front_entity', description: '将实体置于显示顺序最前', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '实体句柄' } }, required: ['handle'] } },
{ name: 'send_to_back_entity', description: '将实体置于显示顺序最后', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '实体句柄' } }, required: ['handle'] } },
{ name: 'bring_above_entity', description: '将实体置于参照实体之上', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '目标实体句柄' }, referenceHandle: { type: 'string', description: '参照实体句柄' } }, required: ['handle', 'referenceHandle'] } },
{ name: 'send_below_entity', description: '将实体置于参照实体之下', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: '目标实体句柄' }, referenceHandle: { type: 'string', description: '参照实体句柄' } }, required: ['handle', 'referenceHandle'] } },
{ name: 'select_all', description: '全选所有实体', inputSchema: { type: 'object', properties: {} } },
{ name: 'select_last', description: '选择最后创建的实体', inputSchema: { type: 'object', properties: {} } },
{ name: 'select_by_color', description: '按颜色选择实体', inputSchema: { type: 'object', properties: { colorIndex: { type: 'integer', description: '颜色编号' } }, required: ['colorIndex'] } }
];
