export const tools = [
{
        name: 'open_dwg',
        description: '打开 DWG 文件',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: '文件完整路径' }
            },
            required: ['filePath']
        }
    },
{
        name: 'save_dwg',
        description: '保存当前图形',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: '另存为路径（可选，不传则保存当前文件）' }
            }
        }
    },
{
        name: 'export_pdf',
        description: '导出 PDF',
        inputSchema: {
            type: 'object',
            properties: {
                outputPath: { type: 'string', description: '输出 PDF 路径' },
                layout: { type: 'string', description: '布局名称（默认 Model）' }
            },
            required: ['outputPath']
        }
    },
    {
        name: 'close_dwg',
        description: '关闭当前图形',
        inputSchema: {
            type: 'object',
            properties: {
                save: { type: 'string', description: '是否保存，true/false（默认 false）' }
            }
        }
    },
    {
        name: 'publish_layouts',
        description: '批量发布布局到 PDF',
        inputSchema: {
            type: 'object',
            properties: {
                layouts: { type: 'array', items: { type: 'string' }, description: '布局名称列表' },
                outputDir: { type: 'string', description: '输出目录' },
                namingRule: { type: 'string', description: '命名规则，{layout} 和 {format} 为占位符（默认 {layout}）' },
                merge: { type: 'string', description: '是否合并为一个 PDF（默认 true）' }
            },
            required: ['layouts']
        }
    },
{ name: 'export_svg', description: '导出 SVG 文件', inputSchema: { type: 'object', properties: { outputPath: { type: 'string', description: '输出路径' }, layout: { type: 'string', description: '布局名称(默认Model)' } }, required: ['outputPath'] } },
{ name: 'export_bmp', description: '导出 BMP 图片', inputSchema: { type: 'object', properties: { outputPath: { type: 'string', description: '输出路径' } }, required: ['outputPath'] } },
{ name: 'export_stl', description: '导出 STL 文件(3D打印)', inputSchema: { type: 'object', properties: { outputPath: { type: 'string', description: '输出路径' }, handle: { type: 'string', description: '3D实体句柄(可选，默认所有实体)' } }, required: ['outputPath'] } }
];
