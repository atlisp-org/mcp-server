export const tools = [
{
        name: 'create_ucs',
        description: '创建用户坐标系(UCS)。指定原点、X轴和Y轴方向。用户说"建坐标系/设UCS"时调用',
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
        description: '切换到之前创建的 UCS。用户说"切换到XX坐标系"时调用',
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
        description: '列出当前图形中所有已定义的 UCS 名称',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'delete_ucs',
        description: '删除指定的已命名 UCS',
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
        description: '查询当前正在使用的 UCS 名称',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'create_layout',
        description: '创建新布局（图纸空间）。用户说"新建布局/新建图纸"时调用',
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
        description: '切换到指定布局（图纸空间）。用户说"切换到XX布局/看布局"时调用',
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
        description: '列出当前 DWG 中所有布局名称（含 Model）',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'delete_layout',
        description: '删除指定布局（不能删除 Model）',
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
        description: '查询当前正在工作的布局名称（Model 或布局名）',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'rename_layout',
        description: '给布局改名字。用户说"重命名布局"时调用',
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
