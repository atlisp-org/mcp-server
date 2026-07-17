export const tools = [
{
        name: 'create_layer',
        description: '创建新图层(LAYER)。当用户说"新建图层/创建图层/加个图层"时调用。可同时指定颜色和线型。idempotent——同名图层已存在则不重复创建。颜色号和线型名必须合法，否则会失败。',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '图层名称。常用命名: "0"（默认）、"标注"、"轴线"、"墙体"、"门窗"、"文字"、"填充"、"尺寸"、"虚线层"。建议使用有意义的中文名以便管理。' },
                color: { type: 'string', description: '颜色索引号（1-255，默认 "7"=白/黑）。常用: "1"=红, "2"=黄, "3"=绿, "4"=青, "5"=蓝, "6"=紫, "7"=白/黑。不传则默认白色。' },
                linetype: { type: 'string', description: '线型名称（默认 "Continuous"=实线）。其他内置线型: "DASHED"(虚线), "CENTER"(中心线), "DOT"(点线), "HIDDEN"(隐藏线), "PHANTOM"(双点划线)。不传则默认 Continuous。' }
            },
            required: ['name']
        }
    },
{
        name: 'delete_layer',
        description: '删除指定图层。当用户说"删掉XX图层"时调用。限制：只能删除空图层（无任何实体的图层）。如果图层不为空，需先用 batch_move 将实体移走再删除。destructive——图层定义被彻底移除。不能删除 "0" 层和当前层。',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '要删除的图层名称。不能为 "0" 层、当前层或非空层。' }
            },
            required: ['name']
        }
    },
{
        name: 'set_layer',
        description: '修改图层的属性。当用户说"把XX图层改成XX色/冻结XX层"时调用。支持属性: color(颜色号), linetype(线型名), freeze(冻结图层), thaw(解冻图层), lock(锁定), unlock(解锁)。destructive——直接修改图层定义。',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '要修改的图层名称。如 "墙体"、"标注"。' },
                property: { type: 'string', description: '要修改的属性: "color"(颜色)、"linetype"(线型)、"freeze"(冻结不显示)、"thaw"(解冻)、"lock"(锁定只读)、"unlock"(解锁)。' },
                value: { type: 'string', description: '属性值：color 传数字 1-255，如 "1"(红)；linetype 传线型名，如 "DASHED"；freeze/thaw/lock/unlock 传 "true" 或 "false"。' }
            },
            required: ['name', 'property']
        }
    },
{
        name: 'set_current_layer',
        description: '切换当前图层。当用户说"切到XX图层/当前层设为XX"时调用。后续创建的新实体将自动位于此图层上。idempotent——图层需已存在（先 create_layer）。前置条件：图层必须已存在。',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '要设为当前的图层名称。如 "0"、"墙体"、"标注"。必须已存在。' }
            },
            required: ['name']
        }
    },
{ name: 'layer_isolate', description: '隔离指定图层——关闭除指定层外的所有其他图层。当用户说"只看XX层/隔离XX图层"时调用。被关图层不显示不打印。destructive（显示状态）。用 layer_unisolate 恢复。', inputSchema: { type: 'object', properties: { name: { type: 'string', description: '要保留显示的图层名称。其他所有图层将被关闭。如 "轴线"。' } }, required: ['name'] } },
{ name: 'layer_unisolate', description: '取消隔离状态，恢复之前关闭的所有图层。当用户说"恢复所有图层/取消隔离"时调用。在 layer_isolate 后使用。idempotent——若未隔离则无效果。', inputSchema: { type: 'object', properties: {} } },
{ name: 'layer_freeze_all', description: '冻结所有图层（不显示且不参与重生成计算）。当用户说"冻结所有层"时调用。对比 layer_isolate（只关其他层），freeze 后图层完全不参与计算，适合大幅提升后续操作性能。destructive（显示/计算状态）。用 layer_thaw_all 恢复。', inputSchema: { type: 'object', properties: {} } },
{ name: 'layer_thaw_all', description: '解冻所有之前冻结的图层。当用户说"解冻所有层"时调用。在 layer_freeze_all 后使用恢复显示。idempotent。', inputSchema: { type: 'object', properties: {} } },
{ name: 'layer_lock_all', description: '锁定所有图层（可见但不可编辑选择，防止误操作）。当用户说"锁定所有层"时调用。锁定图层上的实体可见但不能修改/选择。destructive（编辑状态）。用 layer_unlock_all 恢复。', inputSchema: { type: 'object', properties: {} } },
{ name: 'layer_unlock_all', description: '解锁所有之前锁定的图层。当用户说"解锁所有层"时调用。在 layer_lock_all 后使用恢复编辑能力。idempotent。', inputSchema: { type: 'object', properties: {} } },
{ name: 'layer_merge', description: '合并图层：将源图层所有实体移动到目标图层，然后删除源图层。当用户说"合并图层/把XX合并到XX"时调用。destructive——源图层被删除。前置条件：源图层和目标图层均需存在。对比 delete_layer（只能删空层）。', inputSchema: { type: 'object', properties: { sourceName: { type: 'string', description: '源图层名称（将被删除），如 "旧墙体"。"0"层不能作为源层。' }, targetName: { type: 'string', description: '目标图层名称（接收所有实体），如 "墙体"。必须已存在。' } }, required: ['sourceName', 'targetName'] } }
];
