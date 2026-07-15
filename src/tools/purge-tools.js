export const tools = [
{
        name: 'purge_all',
        description: '一键清理所有未使用的命名项(块/图层/线型/样式等)。用户说"清理/瘦身"时调用',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'purge_blocks',
        description: '清理未使用的块定义。namePattern支持通配符如 *TEMP*',
        inputSchema: {
            type: 'object',
            properties: {
                namePattern: { type: 'string', description: '名称匹配模式，如 *TEMP*' }
            }
        }
    },
{
        name: 'purge_layers',
        description: '清理未使用的图层（空图层）',
        inputSchema: {
            type: 'object',
            properties: {
                namePattern: { type: 'string', description: '名称匹配模式' }
            }
        }
    },
{
        name: 'purge_styles',
        description: '清理未使用的文字/标注/表格样式',
        inputSchema: {
            type: 'object',
            properties: {
                namePattern: { type: 'string', description: '名称匹配模式' }
            }
        }
    },
{
        name: 'purge_registered_apps',
        description: '清理未使用的注册应用程序(RegApp)',
        inputSchema: {
            type: 'object',
            properties: {
                namePattern: { type: 'string', description: '名称匹配模式' }
            }
        }
    },
{
        name: 'drawing_audit',
        description: '审计并修复当前图形中的错误(AUDIT)',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'drawing_recover',
        description: '尝试恢复损坏的DWG文件(RECOVER)',
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
        description: '删除重叠/重复的几何图形。用户说"删重复/清理重叠"时调用',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { type: 'array', description: '要处理的实体句柄列表' }
            },
            required: ['handles']
        }
    }
];
