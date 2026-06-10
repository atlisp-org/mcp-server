export const tools = [
{
        name: 'create_block',
        description: '创建块定义',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '块名称' },
                entities: { type: 'string', description: '块内实体定义代码（可选）' }
            },
            required: ['name']
        }
    },
{
        name: 'insert_block',
        description: '插入块',
        inputSchema: {
            type: 'object',
            properties: {
                blockName: { type: 'string', description: '块名称' },
                point: { type: 'string', description: '插入点，如 0,0 或 100,200,0' },
                scale: { type: 'string', description: '缩放比例（默认1）' },
                rotation: { type: 'string', description: '旋转角度（默认0）' }
            },
            required: ['blockName', 'point']
        }
    },
{
        name: 'get_blocks',
        description: '获取图形中所有块定义',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'explode_block',
        description: '炸开块引用',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '块引用实体句柄' }
            },
            required: ['handle']
        }
    },
    {
        name: 'batch_get_block_attributes',
        description: '批量获取块属性（按块名/图层过滤）',
        inputSchema: {
            type: 'object',
            properties: {
                blockName: { type: 'string', description: '块名称（可选，不填则获取所有块）' },
                layer: { type: 'string', description: '图层名称（可选）' }
            }
        }
    },
    {
        name: 'batch_set_block_attributes',
        description: '批量设置块属性',
        inputSchema: {
            type: 'object',
            properties: {
                items: { type: 'array', description: '块属性项数组，每项含 handle 和 attributes 对象' }
            },
            required: ['items']
        }
    }
];
