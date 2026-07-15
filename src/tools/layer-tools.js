export const tools = [
{
        name: 'create_layer',
        description: '创建新图层，可指定颜色和线型。用户要求"新建图层/创建图层"时调用。颜色号 1-255（1红2黄3绿5蓝7白）',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '图层名称。常用命名: 0, 标注, 轴线, 墙体, 门窗, 文字, 填充' },
                color: { type: 'string', description: '颜色索引号（1-255，默认7=白/黑）。1=红,2=黄,3=绿,4=青,5=蓝,6=紫,7=白/黑' },
                linetype: { type: 'string', description: '线型名称（默认 Continuous）。其他: DASHED, CENTER, DOT, HIDDEN' }
            },
            required: ['name']
        }
    },
{
        name: 'delete_layer',
        description: '删除指定图层。只能删除空图层（无实体的图层）。如需强制删除请先移动实体到其他图层',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '要删除的图层名称' }
            },
            required: ['name']
        }
    },
{
        name: 'set_layer',
        description: '修改图层的属性。支持 color(颜色号)、linetype(线型名)、freeze(冻结)/thaw(解冻)、lock(锁定)/unlock(解锁)',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '图层名称' },
                property: { type: 'string', description: '要修改的属性: color, linetype, freeze, thaw, lock, unlock' },
                value: { type: 'string', description: '属性值（color传数字1-255，linetype传线型名，其他传true/false）' }
            },
            required: ['name', 'property']
        }
    },
{
        name: 'set_current_layer',
        description: '切换当前图层。新创建的实体将自动位于此图层。用户说"切到XX图层"时调用',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '图层名称' }
            },
            required: ['name']
        }
    },
{ name: 'layer_isolate', description: '隔离指定图层——关闭其他所有图层，只显示该图层上的实体。查看特定图层时调用', inputSchema: { type: 'object', properties: { name: { type: 'string', description: '要保留显示的图层名称' } }, required: ['name'] } },
{ name: 'layer_unisolate', description: '取消隔离状态，恢复之前关闭的图层', inputSchema: { type: 'object', properties: {} } },
{ name: 'layer_freeze_all', description: '冻结所有图层（不显示且不参与重生成）。适合大幅提升操作性能', inputSchema: { type: 'object', properties: {} } },
{ name: 'layer_thaw_all', description: '解冻所有之前冻结的图层', inputSchema: { type: 'object', properties: {} } },
{ name: 'layer_lock_all', description: '锁定所有图层（可见但不可编辑，防止误操作）', inputSchema: { type: 'object', properties: {} } },
{ name: 'layer_unlock_all', description: '解锁所有之前锁定的图层', inputSchema: { type: 'object', properties: {} } },
{ name: 'layer_merge', description: '合并图层：将源图层中所有实体移动到目标图层，然后删除源图层。用户说"合并图层"时调用', inputSchema: { type: 'object', properties: { sourceName: { type: 'string', description: '源图层名称（将被删除）' }, targetName: { type: 'string', description: '目标图层名称（接收实体）' } }, required: ['sourceName', 'targetName'] } }
];
