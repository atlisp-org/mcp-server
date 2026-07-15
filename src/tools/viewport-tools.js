export const tools = [
{
        name: 'create_viewport',
        description: '在布局中创建矩形视口(Viewport)用于显示模型空间内容',
        inputSchema: {
            type: 'object',
            properties: {
                layout: { type: 'string', description: '布局名称' },
                corner1: { type: 'string', description: '第一个角点坐标' },
                corner2: { type: 'string', description: '第二个角点坐标' }
            },
            required: ['layout', 'corner1', 'corner2']
        }
    },
{
        name: 'create_polygonal_viewport',
        description: '在布局中创建多边形视口',
        inputSchema: {
            type: 'object',
            properties: {
                layout: { type: 'string', description: '布局名称' },
                points: { type: 'string', description: '多边形顶点坐标列表' }
            },
            required: ['layout', 'points']
        }
    },
{
        name: 'set_viewport_scale',
        description: '设置布局视口的比例(如 100 表示 1:100)',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '视口实体句柄' },
                scale: { type: 'number', description: '比例值（如 100 表示 1:100）' }
            },
            required: ['handle', 'scale']
        }
    },
{
        name: 'lock_viewport',
        description: '锁定视口比例，防止缩放时比例改变',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '视口实体句柄' }
            },
            required: ['handle']
        }
    },
{
        name: 'unlock_viewport',
        description: '解锁视口比例',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '视口实体句柄' }
            },
            required: ['handle']
        }
    },
{
        name: 'maximize_viewport',
        description: '最大化视口到全屏以便编辑',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '视口实体句柄' }
            },
            required: ['handle']
        }
    },
{
        name: 'minimize_viewport',
        description: '将最大化视口恢复到原位置',
        inputSchema: { type: 'object', properties: {} }
    }
];
