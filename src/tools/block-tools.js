export const tools = [
{
        name: 'create_block',
        description: '创建块定义（将选中的实体组合为块）。块名全局唯一，重复会覆盖',
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
        description: '插入块引用到图形。用户说"放个块/插入图块"时调用。需先选好插入点和比例',
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
        description: '列出当前 DWG 中所有块定义的名称列表。用户问"有哪些块"时调用',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'explode_block',
        description: '炸开（分解）块引用为独立实体。用户说"炸开块/分解块"时调用。不可逆',
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
        description: '批量获取所有块参照的属性值。按块名和/或图层过滤。想查某类块的属性时调用',
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
        description: '批量修改多个块参照的属性值。传入 handle 和 attributes 对象数组。用户说"批量改块属性"时调用',
        inputSchema: {
            type: 'object',
            properties: {
                items: { type: 'array', description: '块属性项数组，每项含 handle 和 attributes 对象' }
            },
            required: ['items']
        }
    }
];
