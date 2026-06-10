export const tools = [
{
        name: 'create_ucs',
        description: '创建 UCS 用户坐标系',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'UCS 名称' },
                origin: { type: 'string', description: '原点，如 0,0,0' },
                xAxis: { type: 'string', description: 'X 轴方向，如 1,0,0' },
                yAxis: { type: 'string', description: 'Y 轴方向，如 0,1,0' }
            },
            required: ['name']
        }
    },
{
        name: 'set_ucs',
        description: '切换到指定 UCS',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'UCS 名称' }
            },
            required: ['name']
        }
    },
{
        name: 'list_ucs',
        description: '列出所有 UCS',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'delete_ucs',
        description: '删除 UCS',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'UCS 名称' }
            },
            required: ['name']
        }
    },
{
        name: 'get_current_ucs',
        description: '获取当前 UCS 名称',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'create_layout',
        description: '创建布局',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '布局名称' }
            },
            required: ['name']
        }
    },
{
        name: 'set_layout',
        description: '切换到指定布局',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '布局名称' }
            },
            required: ['name']
        }
    },
{
        name: 'list_layouts',
        description: '列出所有布局',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'delete_layout',
        description: '删除布局',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '布局名称' }
            },
            required: ['name']
        }
    },
{
        name: 'get_current_layout',
        description: '获取当前布局名称',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'rename_layout',
        description: '重命名布局',
        inputSchema: {
            type: 'object',
            properties: {
                oldName: { type: 'string', description: '原名称' },
                newName: { type: 'string', description: '新名称' }
            },
            required: ['oldName', 'newName']
        }
    }
];
