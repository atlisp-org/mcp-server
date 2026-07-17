export const tools = [
{
        name: 'create_viewport',
        description: '在布局中创建矩形视口(Viewport)用于显示模型空间内容。当用户说"建视口/开视口"时调用。先创建布局(create_layout)，然后创建视口。之后可用 set_viewport_scale 设置比例',
        inputSchema: {
            type: 'object',
            properties: {
                layout: { type: 'string', description: '目标布局名称。可通过 list_layouts 查看已有布局。Model 空间不可创建视口' },
                corner1: { type: 'string', description: '视口矩形第一个角点坐标，如 "0,0"。布局图纸空间坐标' },
                corner2: { type: 'string', description: '视口矩形对角点坐标，如 "297,210"。定义视口大小和位置' }
            },
            required: ['layout', 'corner1', 'corner2']
        }
    },
{
        name: 'create_polygonal_viewport',
        description: '在布局中创建多边形视口——非矩形视口边界。当用户说"建多边形视口"时调用。先创建布局(create_layout)，定义多边形顶点序列。相比 create_viewport 更灵活但需要更多顶点',
        inputSchema: {
            type: 'object',
            properties: {
                layout: { type: 'string', description: '目标布局名称。通过 list_layouts 查看已有布局' },
                points: { type: 'string', description: '多边形顶点坐标列表，空格分隔，如 "0,0 100,0 100,100 50,150 0,100"。至少3个顶点，自动闭合' }
            },
            required: ['layout', 'points']
        }
    },
{
        name: 'set_viewport_scale',
        description: '设置布局视口的打印比例，决定模型空间内容在视口中的缩放显示。当用户说"设置视口比例/改比例"时调用。scale=100 表示 1:100（模型100单位=图纸1单位）。先创建视口(create_viewport)再设比例。设好后用 lock_viewport 锁定防止误改',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '视口实体句柄。通过 select_entities filter={type:"VIEWPORT"} 获取' },
                scale: { type: 'number', description: '比例值，如 100 表示 1:100，50 表示 1:50。常用值:1,2,5,10,20,50,100。值越大显示内容越小(模型:图纸)' }
            },
            required: ['handle', 'scale']
        }
    },
{
        name: 'lock_viewport',
        description: '锁定视口比例、位置和缩放，防止误操作改变视口显示。当用户说"锁定视口"时调用。比例锁定后视图缩放不改变比例。配合 unlock_viewport 解锁。建议设好比例(set_viewport_scale)后立即锁定',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '视口实体句柄。通过 select_entities filter={type:"VIEWPORT"} 获取。锁定后视口边框不变但内部缩放被禁止' }
            },
            required: ['handle']
        }
    },
{
        name: 'unlock_viewport',
        description: '解锁之前锁定的视口，恢复比例和位置的自由调整能力。当用户说"解锁视口"时调用。解锁后才能修改视口比例(set_viewport_scale)或最大化/最小化',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '视口实体句柄。通过 select_entities filter={type:"VIEWPORT"} 获取。解锁后视口恢复正常编辑状态' }
            },
            required: ['handle']
        }
    },
{
        name: 'maximize_viewport',
        description: '将指定视口最大化到全屏编辑模式方便细部操作。当用户说"最大化视口/全屏编辑"时调用。退出全屏用 minimize_viewport。最大化期间模型空间充满整个绘图区',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '视口实体句柄。通过 select_entities filter={type:"VIEWPORT"} 获取' }
            },
            required: ['handle']
        }
    },
{
        name: 'minimize_viewport',
        description: '将最大化视口恢复到原始位置和大小。当用户说"恢复视口/退出全屏"时调用。对应 maximize_viewport 的逆操作。调用后自动恢复到最大化前的位置',
        inputSchema: { type: 'object', properties: {} }
    }
];
