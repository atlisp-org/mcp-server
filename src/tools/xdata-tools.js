export const tools = [
{
        name: 'get_xdata',
        description: '读取实体上指定应用程序(RegApp)的扩展数据(Xdata)。返回数据字符串。用户查实体附加业务标识时调用。与 get_all_entity_xdata 相比只查单个app',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '实体句柄，如 "1F3"' },
                appName: { type: 'string', description: '应用程序注册名称（默认 ACAD）。如 "ACAD"、"MY_APP"、"{GUID}"' }
            },
            required: ['handle']
        }
    },
{
        name: 'set_xdata',
        description: '为实体写入扩展数据(Xdata)。当用户说"给实体加扩展数据/写业务标识"时调用。需指定appName（需先注册）和AutoLISP格式的data字符串。常用于附加业务标识、BIM信息等。写入后可用 get_xdata 读取',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '实体句柄，如 "1F3"' },
                appName: { type: 'string', description: '应用程序注册名称，需先通过 RegApp 注册。如 "MY_APP"' },
                data: { type: 'string', description: '扩展数据 AutoLISP 格式，如 \'(1000 . "TagA") (1070 . 42) (1040 . 3.14)\'' }
            },
            required: ['handle', 'appName', 'data']
        }
    },
{
        name: 'delete_xdata',
        description: '删除实体上指定应用程序(Xdata)的扩展数据。当用户说"删掉这个扩展数据/清理Xdata"时调用。不可逆。删除后可用 get_xdata 确认已清除',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '实体句柄' },
                appName: { type: 'string', description: '要删除的应用程序名称，如 "MY_APP"' }
            },
            required: ['handle', 'appName']
        }
    },
{
        name: 'list_xdata_apps',
        description: '列出某实体上注册了哪些扩展数据(Xdata)应用程序名(RegApp)。当用户问"这个实体带了什么附加数据"时调用。返回 appName 数组。想知道实体带了哪些业务的附加信息时先调用此工具',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '实体句柄，如 "1F3"' }
            },
            required: ['handle']
        }
    },
{
        name: 'get_all_entity_xdata',
        description: '获取实体上所有应用程序(RegApp)的完整扩展数据(Xdata)。当用户问"查这个实体全部附加数据"时调用。返回完整数据（含所有 appName 及其数据）。对比 get_xdata 只查指定app',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '实体句柄，如 "1F3"' }
            },
            required: ['handle']
        }
    },
{
        name: 'copy_xdata',
        description: '将源实体上的扩展数据(Xdata)复制到目标实体。当用户说"把扩展数据复制过去/迁移属性"时调用。可选参数 appName 只复制指定应用程序的数据。批量标注或属性迁移时使用',
        inputSchema: {
            type: 'object',
            properties: {
                sourceHandle: { type: 'string', description: '源实体句柄，数据来源' },
                targetHandle: { type: 'string', description: '目标实体句柄，数据去向' },
                appName: { type: 'string', description: '仅复制指定应用程序的数据，如 "MY_APP"（可选，默认复制全部）' }
            },
            required: ['sourceHandle', 'targetHandle']
        }
    },
{
        name: 'search_by_xdata',
        description: '按扩展数据(Xdata)中的键值对搜索匹配的实体。当用户说"按ID/标签找实体"时调用。需知道 appName 和 key/value。返回匹配的实体句柄数组。适用于按业务ID/标签检索实体的场景',
        inputSchema: {
            type: 'object',
            properties: {
                appName: { type: 'string', description: '应用程序名称，如 "MY_APP"' },
                key: { type: 'string', description: '搜索键（组码 1001 后的数据键名），如 "ProjectID"' },
                value: { type: 'string', description: '搜索值，如 "PROJ-2024-001"' }
            },
            required: ['appName', 'key', 'value']
        }
    },
{
        name: 'export_xdata_to_file',
        description: '将实体的扩展数据(Xdata)导出到JSON文件。当用户说"导出扩展数据/备份Xdata"时调用。可用于备份/迁移业务数据。配合 import_xdata_from_file 实现跨图数据迁移',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '实体句柄' },
                filePath: { type: 'string', description: '导出 JSON 文件路径，如 "C:/data/xdata-backup.json"' }
            },
            required: ['handle', 'filePath']
        }
    },
{
        name: 'import_xdata_from_file',
        description: '从JSON文件导入扩展数据(Xdata)到实体。当用户说"导入扩展数据/恢复Xdata"时调用。可选 appName 只导入指定应用程序的数据。配合 export_xdata_to_file 使用',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '目标实体句柄' },
                filePath: { type: 'string', description: '导入 JSON 文件路径，如 "C:/data/xdata-backup.json"' },
                appName: { type: 'string', description: '仅导入指定应用程序的数据，如 "MY_APP"（可选，默认导入全部）' }
            },
            required: ['handle', 'filePath']
        }
    }
];
