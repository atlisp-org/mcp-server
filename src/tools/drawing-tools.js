export const tools = [
{
        name: 'open_dwg',
        description: '打开指定的 DWG 文件。用户说"打开图纸/打开文件"时调用。需提供文件完整路径',
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
        description: '保存当前 DWG。不传 filePath 则保存当前文件；传入路径则另存为新文件。用户说"保存/另存为"时调用',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: '另存为路径（可选，不传则保存当前文件）' }
            }
        }
    },
{
        name: 'export_pdf',
        description: '将指定布局导出为 PDF 文件。用户说"导出PDF/转PDF"时调用。需指定输出路径和布局名',
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
        description: '关闭当前 DWG 文档。save=true 先保存再关闭，save=false（默认）不保存直接关',
        inputSchema: {
            type: 'object',
            properties: {
                save: { type: 'string', description: '是否保存，true/false（默认 false）' }
            }
        }
    },
    {
        name: 'publish_layouts',
        description: '将多个布局批量发布到 PDF。可合并为一个或多个PDF。用户说"批量导出布局"时调用',
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
{ name: 'export_svg', description: '导出布局为 SVG 矢量图文件', inputSchema: { type: 'object', properties: { outputPath: { type: 'string', description: '输出文件路径（.svg）' }, layout: { type: 'string', description: '布局名称(默认Model)' } }, required: ['outputPath'] } },
{ name: 'export_bmp', description: '导出当前视图为 BMP 位图图片', inputSchema: { type: 'object', properties: { outputPath: { type: 'string', description: '输出文件路径（.bmp）' } }, required: ['outputPath'] } },
{ name: 'export_stl', description: '导出 3D 实体为 STL 文件（3D打印格式）。指定 handle 导出单个实体，不传则导出所有 3D 实体', inputSchema: { type: 'object', properties: { outputPath: { type: 'string', description: '输出文件路径（.stl）' }, handle: { type: 'string', description: '3D实体句柄(可选，导出所有实体则留空)' } }, required: ['outputPath'] } }
];
