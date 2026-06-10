export const tools = [
{
        name: 'purge_all',
        description: '清理所有未使用项',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'purge_blocks',
        description: '清理未使用的块',
        inputSchema: {
            type: 'object',
            properties: {
                namePattern: { type: 'string', description: '名称匹配模式，如 *TEMP*' }
            }
        }
    },
{
        name: 'purge_layers',
        description: '清理未使用的图层',
        inputSchema: {
            type: 'object',
            properties: {
                namePattern: { type: 'string', description: '名称匹配模式' }
            }
        }
    },
{
        name: 'purge_styles',
        description: '清理未使用的样式',
        inputSchema: {
            type: 'object',
            properties: {
                namePattern: { type: 'string', description: '名称匹配模式' }
            }
        }
    },
{
        name: 'purge_registered_apps',
        description: '清理未注册的应用程序',
        inputSchema: {
            type: 'object',
            properties: {
                namePattern: { type: 'string', description: '名称匹配模式' }
            }
        }
    },
{
        name: 'drawing_audit',
        description: '审计当前图形并修复错误',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'drawing_recover',
        description: '恢复损坏的 DWG 文件',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: '要恢复的 DWG 文件路径' }
            },
            required: ['filePath']
        }
    },
{
        name: 'overkill',
        description: '删除重复和重叠的几何图形',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { type: 'array', description: '要处理的实体句柄列表' }
            },
            required: ['handles']
        }
    }
];
