export const tools = [
{
        name: 'create_layer',
        description: '创建图层',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '图层名称' },
                color: { type: 'string', description: '颜色号（1-255，默认7）' },
                linetype: { type: 'string', description: '线型名称（默认 Continuous）' }
            },
            required: ['name']
        }
    },
{
        name: 'delete_layer',
        description: '删除图层',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '图层名称' }
            },
            required: ['name']
        }
    },
{
        name: 'set_layer',
        description: '设置图层属性',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '图层名称' },
                property: { type: 'string', description: '属性: color, linetype, freeze, thaw, lock, unlock' },
                value: { type: 'string', description: '属性值' }
            },
            required: ['name', 'property']
        }
    },
{
        name: 'set_current_layer',
        description: '设置当前图层',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '图层名称' }
            },
            required: ['name']
        }
    },
{ name: 'layer_isolate', description: '隔离图层（关闭其他所有图层）', inputSchema: { type: 'object', properties: { name: { type: 'string', description: '要隔离的图层名称' } }, required: ['name'] } },
{ name: 'layer_unisolate', description: '取消图层隔离，恢复之前的图层状态', inputSchema: { type: 'object', properties: {} } },
{ name: 'layer_freeze_all', description: '冻结所有图层', inputSchema: { type: 'object', properties: {} } },
{ name: 'layer_thaw_all', description: '解冻所有图层', inputSchema: { type: 'object', properties: {} } },
{ name: 'layer_lock_all', description: '锁定所有图层', inputSchema: { type: 'object', properties: {} } },
{ name: 'layer_unlock_all', description: '解锁所有图层', inputSchema: { type: 'object', properties: {} } },
{ name: 'layer_merge', description: '合并图层（将源图层所有实体移动到目标图层并删除源图层）', inputSchema: { type: 'object', properties: { sourceName: { type: 'string', description: '源图层名称' }, targetName: { type: 'string', description: '目标图层名称' } }, required: ['sourceName', 'targetName'] } }
];
