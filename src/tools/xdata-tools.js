export const tools = [
{
        name: 'get_xdata',
        description: '读取实体的扩展数据(Xdata)指定应用程序下的数据。用户查实体附加信息时调用',
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
        description: '为实体写入扩展数据(Xdata)。需指定appName和AutoLISP格式的data字符串。常用于附加业务标识',
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
        description: '删除实体上指定应用程序的扩展数据',
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
        description: '列出某实体上注册了哪些扩展数据应用程序名',
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
        description: '获取实体上所有应用程序的完整扩展数据',
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
        description: '将源实体上的扩展数据复制到目标实体。可选只复制指定appName',
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
        description: '按扩展数据中的键值对搜索匹配的实体。需知appName和key/value',
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
        description: '将实体的扩展数据导出到JSON文件',
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
        description: '从JSON文件导入扩展数据到实体',
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
