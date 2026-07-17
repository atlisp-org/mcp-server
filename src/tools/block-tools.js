export const tools = [
{
        name: 'create_block',
        description: '创建块定义(BLOCK)。将选中的实体组合为命名块，可在图中多次引用。当用户说"做成块/定义块/建块"时调用。注意：块名需唯一，重复会覆盖已存在的同名块定义。destructive（同名覆盖）。必须先有实体——先用 draw_* 创建或通过 select_entities 获取。',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '块名称，全局唯一。建议用英文或拼音，如 "door-w01", "window-c01", "desk-01"。同名会覆盖已有块定义。' },
                entities: { type: 'string', description: '块内实体定义Lisp代码（可选）。不传则使用当前选择集中的实体。高级用法，通常无需填写。' }
            },
            required: ['name']
        }
    },
{
        name: 'insert_block',
        description: '插入块引用(INSERT)到图形中。当用户说"放个块/插入图块/放门放窗"时调用。须先有块定义（通过 create_block 创建或 get_blocks 查看已有块）。返回新插入块引用的句柄。idempotent——每次调用创建一个新的块引用。前置条件：块名需已存在于图形中。',
        inputSchema: {
            type: 'object',
            properties: {
                blockName: { type: 'string', description: '要插入的块名称。通过 get_blocks 可查看所有可用块名。如 "door-w01", "A-窗"。' },
                point: { type: 'string', description: '插入点坐标，如 "0,0"（2D）或 "100,200,0"（3D）。支持绝对坐标。' },
                scale: { type: 'string', description: '缩放比例（默认 "1"）。如 "2"=放大2倍，"0.5"=缩小一半。支持不均匀缩放如 "1,2"。' },
                rotation: { type: 'string', description: '旋转角度（默认 "0"），单位为度。如 "90"=顺时针90°，"-45"=逆时针45°。' }
            },
            required: ['blockName', 'point']
        }
    },
{
        name: 'get_blocks',
        description: '列出当前 DWG 中所有块定义的名称列表(string[])。当用户问"有哪些块/有什么图块"时调用。只读。用于在 insert_block 前查找可用块名，或在 purge_blocks 前确认要清理的块。',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'explode_block',
        description: '炸开（分解）块引用为独立的基本图元。当用户说"炸开块/分解块/拆块"时调用。destructive——块引用被删除，取而代之的是组成它的基本实体（LINE/ARC/CIRCLE等）。不可逆（除非undo）。对比 batch_explode（可批量操作多个）。',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '块引用实体的句柄。先通过 select_entities({type:"INSERT"}) 或 get_entity 获取。' }
            },
            required: ['handle']
        }
    },
    {
        name: 'batch_get_block_attributes',
        description: '批量获取所有块参照的属性(ATTRIB)标签和值。当用户说"查所有块属性/看看这些块带什么数据"时调用。可选按 blockName 和/或 layer 过滤。只读。对比 get_block_attributes（仅查单个块）。',
        inputSchema: {
            type: 'object',
            properties: {
                blockName: { type: 'string', description: '块名称（可选）。仅返回该类型块的属性。不填则返回所有类型块的属性。' },
                layer: { type: 'string', description: '图层名称（可选）。仅返回指定图层的块属性。' }
            }
        }
    },
    {
        name: 'batch_set_block_attributes',
        description: '批量修改多个块参照的属性值。当用户说"批量改块属性/把这些块的XX改成XX"时调用。items 数组中每项指定 handle(块句柄) 和 attributes(属性键值对)。destructive——直接修改原块属性值。对比 set_block_attribute（仅改单个）。',
        inputSchema: {
            type: 'object',
            properties: {
                items: { type: 'array', description: '块属性项数组。每项格式: { handle: "1A2B", attributes: { "编号": "D001", "名称": "门" } }。handle 为块引用句柄，attributes 为标签到值的映射。' }
            },
            required: ['items']
        }
    }
];
