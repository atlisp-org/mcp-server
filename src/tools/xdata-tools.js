export const tools = [
{
        name: 'get_xdata',
        description: '获取实体扩展数据 (Xdata)',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '实体句柄' },
                appName: { type: 'string', description: '应用程序名称（默认 ACAD）' }
            },
            required: ['handle']
        }
    },
{
        name: 'set_xdata',
        description: '设置实体扩展数据 (Xdata)',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '实体句柄' },
                appName: { type: 'string', description: '应用程序名称' },
                data: { type: 'string', description: '扩展数据 (AutoLISP 格式)' }
            },
            required: ['handle', 'appName', 'data']
        }
    },
{
        name: 'delete_xdata',
        description: '删除实体扩展数据',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '实体句柄' },
                appName: { type: 'string', description: '应用程序名称' }
            },
            required: ['handle', 'appName']
        }
    },
{
        name: 'list_xdata_apps',
        description: '列出实体上所有 Xdata 应用程序名',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '实体句柄' }
            },
            required: ['handle']
        }
    },
{
        name: 'get_all_entity_xdata',
        description: '获取实体所有扩展数据',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '实体句柄' }
            },
            required: ['handle']
        }
    },
{
        name: 'copy_xdata',
        description: '复制扩展数据到另一实体',
        inputSchema: {
            type: 'object',
            properties: {
                sourceHandle: { type: 'string', description: '源实体句柄' },
                targetHandle: { type: 'string', description: '目标实体句柄' },
                appName: { type: 'string', description: '应用程序名称（可选，复制全部）' }
            },
            required: ['sourceHandle', 'targetHandle']
        }
    },
{
        name: 'search_by_xdata',
        description: '根据 Xdata 搜索实体',
        inputSchema: {
            type: 'object',
            properties: {
                appName: { type: 'string', description: '应用程序名称' },
                key: { type: 'string', description: '搜索键' },
                value: { type: 'string', description: '搜索值' }
            },
            required: ['appName', 'key', 'value']
        }
    },
{
        name: 'export_xdata_to_file',
        description: '导出实体 Xdata 到 JSON 文件',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '实体句柄' },
                filePath: { type: 'string', description: '导出文件路径' }
            },
            required: ['handle', 'filePath']
        }
    },
{
        name: 'import_xdata_from_file',
        description: '从 JSON 文件导入 Xdata',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '实体句柄' },
                filePath: { type: 'string', description: '导入文件路径' },
                appName: { type: 'string', description: '应用程序名称（可选，导入全部）' }
            },
            required: ['handle', 'filePath']
        }
    }
];
