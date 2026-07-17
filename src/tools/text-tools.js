export const tools = [
{
        name: 'find_text',
        description: '在DWG中搜索文字内容并返回匹配的实体列表（含句柄、内容、位置）。pattern 支持通配符：*（任意多个字符）和 ?（单个字符）。当用户说"找文字/搜索文字/查找"时调用。返回每个匹配文字实体的句柄和完整内容。替换用 replace_text。',
        inputSchema: {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: '搜索文本模式，支持通配符。如 "门*"=找以门开头的、"*柱*"=找含柱的、"A??"=找A开头的三字。不区分大小写' },
                caseSensitive: { type: 'boolean', description: '是否区分大小写。true=精确匹配大小写，false（默认）=不区分。例：true 时 "ABC" 不匹配 "abc"' }
            },
            required: ['pattern']
        }
    },
{
        name: 'replace_text',
        description: '查找并替换文字内容。pattern 支持通配符（*,?），replacement 为替换文本。当用户说"替换/改文字内容/批量改字"时调用。先 find_text 确认要替换的内容再执行。如需保留原格式可用 set_text_height/set_text_style_name 单独修改。',
        inputSchema: {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: '搜索文本模式，支持通配符。如 "门*"、"*柱*"' },
                replacement: { type: 'string', description: '替换文本。如 "窗" 将把所有找到的文本替换为"窗"' },
                caseSensitive: { type: 'boolean', description: '是否区分大小写。true=大小写敏感匹配，false（默认）=不区分' }
            },
            required: ['pattern', 'replacement']
        }
    },
{
        name: 'set_text_height',
        description: '修改单行文字(TEXT)或多行文字(MTEXT)的高度。当用户说"把字改大/字高改XX/文字高度调为"时调用。height 以当前图纸单位为准。修改文字内容用 replace_text，改样式用 set_text_style_name。',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '文字实体句柄，如 "A1"' },
                height: { type: 'number', description: '新文字高度（图纸单位）。如 3.5、5、10' }
            },
            required: ['handle', 'height']
        }
    },
{
        name: 'set_text_style_name',
        description: '修改文字实体所使用的文字样式（StyleName）。当用户说"改字体/改文字样式"时调用。需确保样式名已存在（用 list_text_styles 查看可用样式）。改字高用 set_text_height，改文字内容用 replace_text。',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '文字实体句柄，如 "A1"' },
                styleName: { type: 'string', description: '目标文字样式名称。如 "Standard"、"工程字"、"HZ"。用 list_text_styles 查看可用样式' }
            },
            required: ['handle', 'styleName']
        }
    },
{
        name: 'justify_text',
        description: '设置文字的对齐方式。当用户说"左对齐/居中/右对齐/文字对齐"时调用。对齐点代码含义：TL=左上,TC=中上,TR=右上,ML=左中,MC=正中,MR=右中,BL=左下,BC=中下,BR=右下。修改文字内容用 replace_text。',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '文字实体句柄，如 "A1"' },
                justification: { type: 'string', description: '对齐方式。可选值：TL（左上）、TC（中上）、TR（右上）、ML（左中）、MC（正中）、MR（右中）、BL（左下）、BC（中下）、BR（右下）' }
            },
            required: ['handle', 'justification']
        }
    },
{
        name: 'convert_text_to_mtext',
        description: '将单行文字(TEXT)转换为多行文字(MTEXT)。当用户说"转多行文字/合并成段落"时调用。转换后可获得多行文字支持的高级排版（不同字体/颜色/堆叠等）。转换后原单行文字被删除。不可逆！批量转换可传多个句柄。',
        inputSchema: {
            type: 'object',
            properties: {
                handles: { type: 'array', description: '要转换的单行文字(TEXT)句柄列表。如 ["A1","B1","C1"]。多个单行文字将被合并为一个 MTEXT' }
            },
            required: ['handles']
        }
    },
{
        name: 'explode_text',
        description: '将文字实体分解为几何线条（轮廓变为线段/圆弧）。危险！不可逆！当用户说"把文字炸开成线条/文字转图形"时调用。炸开后文字不再是文字，无法编辑内容。通常用于创建标志/LOGO的轮廓效果。需谨慎使用。',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '要炸开的文字实体句柄（TEXT 或 MTEXT）。如 "A1"' }
            },
            required: ['handle']
        }
    }
];
