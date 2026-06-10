export const tools = [
{
        name: 'find_text',
        description: '查找文本',
        inputSchema: {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: '搜索文本模式（支持通配符）' },
                caseSensitive: { type: 'boolean', description: '是否区分大小写' }
            },
            required: ['pattern']
        }
    },
{
        name: 'replace_text',
        description: '替换文本',
        inputSchema: {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: '搜索文本模式' },
                replacement: { type: 'string', description: '替换文本' },
                caseSensitive: { type: 'boolean', description: '是否区分大小写' }
            },
            required: ['pattern', 'replacement']
        }
    },
{
        name: 'set_text_height',
        description: '设置文字高度',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '文字实体句柄' },
                height: { type: 'number', description: '新文字高度' }
            },
            required: ['handle', 'height']
        }
    },
{
        name: 'set_text_style_name',
        description: '设置文字样式',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '文字实体句柄' },
                styleName: { type: 'string', description: '文字样式名称' }
            },
            required: ['handle', 'styleName']
        }
    },
{
        name: 'justify_text',
        description: '设置文字对齐方式',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '文字实体句柄' },
                justification: { type: 'string', description: '对齐方式: TL/TC/TR/ML/MC/MR/BL/BC/BR' }
            },
            required: ['handle', 'justification']
        }
    },
{
        name: 'convert_text_to_mtext',
        description: '文本转多行文字',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { type: 'array', description: '要转换的单行文字句柄列表' }
            },
            required: ['handles']
        }
    },
{
        name: 'explode_text',
        description: '分解文字为线',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '文字实体句柄' }
            },
            required: ['handle']
        }
    }
];
