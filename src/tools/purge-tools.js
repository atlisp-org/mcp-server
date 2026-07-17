export const tools = [
{
        name: 'purge_all',
        description: '一键清理所有未使用的命名项(块定义/图层/线型/文字样式/标注样式/表格样式等)。当用户说"清理/瘦身/垃圾清理"时调用。⚠️ 不可撤销！先保存(save_dwg)再清理。适合大幅缩小DWG文件体积',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'purge_blocks',
        description: '清理当前图形中未使用（无实例引用）的块定义。当用户说"清理块/删无用块"时调用。namePattern支持通配符*?如*TEMP*匹配含TEMP的所有块。⚠️ 不可撤销，仅删除定义不影响已插入的块参照。对比 purge_all 只清理块',
        inputSchema: {
            type: 'object',
            properties: {
                namePattern: { type: 'string', description: '块名称匹配模式，支持通配符:*匹配任意字符?匹配单个字符。如 "*TEMP*"匹配所有含TEMP的块，"A?"匹配A加一个字符。不传则清理所有未使用块' }
            }
        }
    },
{
        name: 'purge_layers',
        description: '清理当前图形中未使用（无实体引用）的空图层。当用户说"清理空图层/删无用图层"时调用。namePattern支持通配符过滤。⚠️ 不可撤销。如需强制删除含实体的图层先用 batch_move 移动实体到其他图层再删除',
        inputSchema: {
            type: 'object',
            properties: {
                namePattern: { type: 'string', description: '图层名称匹配模式，支持通配符*?。如 "*temp*"匹配所有含temp的层。不传则清理所有空图层' }
            }
        }
    },
{
        name: 'purge_styles',
        description: '清理当前图形中未使用的文字样式/标注样式/表格样式等。当用户说"清理样式"时调用。namePattern支持通配符过滤。⚠️ 不可撤销。不会删除 Standard 等默认样式',
        inputSchema: {
            type: 'object',
            properties: {
                namePattern: { type: 'string', description: '样式名称匹配模式，支持通配符*?。如 "*old*"匹配所有含old的样式。不传则清理所有未使用样式' }
            }
        }
    },
{
        name: 'purge_registered_apps',
        description: '清理当前图形中未使用的注册应用程序(RegApp)。当用户说"清理注册应用"时调用。namePattern支持通配符过滤。⚠️ 不可撤销。影响扩展数据(XDATA)的注册标识',
        inputSchema: {
            type: 'object',
            properties: {
                namePattern: { type: 'string', description: '应用程序名称匹配模式，支持通配符*?。如 "*ACAD*"匹配ACAD相关应用。不传则清理所有未使用的注册应用程序' }
            }
        }
    },
{
        name: 'drawing_audit',
        description: '对当前图形执行错误审计并尝试自动修复(AUDIT命令)。当用户说"审计图形/检查错误/修复图形"时调用。检测并修复损坏的图元、符号表错误等。执行后建议 save_dwg 保存修复结果',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'drawing_recover',
        description: '尝试打开并修复损坏的DWG文件(RECOVER命令)。当用户说"修复文件/恢复图纸"时调用。打开已损坏无法正常打开的DWG文件并尽力恢复有效数据。恢复后建议另存为新文件避免覆盖源文件',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: '要恢复的损坏DWG文件完整路径，如 "C:\\projects\\drawing.dwg"。文件须存在且可读' }
            },
            required: ['filePath']
        }
    },
{
        name: 'overkill',
        description: '删除当前图形中重叠/重复的几何图形（合并重合线段/圆弧等）。当用户说"删重复/清理重叠/去重"时调用。⚠️ 不可撤销！操作前建议先保存(save_dwg)。适合DWG导入或复制粘贴后出现的重叠问题',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { type: 'array', description: '要检查并清理重叠的实体句柄列表，如 ["1F3","2A7","3B9"]。可通过 select_entities 或 select_all 获取' }
            },
            required: ['handles']
        }
    }
];
