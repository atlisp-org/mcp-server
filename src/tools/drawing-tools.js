export const tools = [
{
        name: 'open_dwg',
        description: '打开指定的 DWG 文件。用户说"打开图纸/打开文件"时调用。需提供文件完整路径。示例: filePath="C:/projects/建筑图纸.dwg"。打开后可用 get_cad_info 确认文档已加载。支持AutoCAD/ZWCAD等所有平台',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: 'DWG文件的完整路径，如 "C:/projects/建筑图纸.dwg" 或 "D:\\图纸\\平面图.dwg"' }
            },
            required: ['filePath']
        }
    },
{
        name: 'save_dwg',
        description: '保存当前 DWG。用户说"保存/另存为"时调用。不传 filePath 则保存当前文件；传入路径则另存为新文件。示例: filePath="C:/output/副本.dwg"。返回保存路径。另存后原文件不变',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: '另存为路径（可选），如 "C:/output/副本.dwg"。不传则保存当前文件' }
            }
        }
    },
{
        name: 'export_pdf',
        description: '将布局导出为 PDF 文件。用户说"导出PDF/转PDF"时调用。需指定输出路径和布局名。已合并 plot_to_pdf 和 save_pdf_layout 的功能，推荐统一使用本工具。批量导出多个布局请用 publish_layouts',
        inputSchema: {
            type: 'object',
            properties: {
                outputPath: { type: 'string', description: '输出 PDF 路径，如 "C:/output/图纸1.pdf"' },
                layout: { type: 'string', description: '布局名称（默认 Model），如 "Model"、"A1布局"' }
            },
            required: ['outputPath']
        }
    },
    {
        name: 'close_dwg',
        description: '关闭当前 DWG 文档。用户说"关闭图纸"时调用。示例: save="true" 先保存再关闭；save="false"（默认）不保存直接关。关闭后无法继续操作，需先 open_dwg 或 new_document 加载图纸',
        inputSchema: {
            type: 'object',
            properties: {
                save: { type: 'string', description: '是否保存关闭，"true"=先保存再关，"false"=不保存直接关（默认false）' }
            }
        }
    },
    {
        name: 'publish_layouts',
        description: '将多个布局批量发布到 PDF。用户说"批量导出布局"时调用。merge="true" 合并为一个PDF文件，"false" 每个布局独立PDF。命名规则中 {layout} 和 {format} 为占位符',
        inputSchema: {
            type: 'object',
            properties: {
                layouts: { type: 'array', items: { type: 'string' }, description: '布局名称列表，如 ["A1布局","A2布局","Model"]' },
                outputDir: { type: 'string', description: '输出目录路径，如 "C:/output/"' },
                namingRule: { type: 'string', description: '命名规则，{layout}={布局名}, {format}=pdf。默认 "{layout}"。如 "{layout}_{date}"' },
                merge: { type: 'string', description: '是否合并为一个PDF文件，"true"=合并，"false"=各布局独立文件（默认 true）' }
            },
            required: ['layouts']
        }
    },
{ name: 'export_svg', description: '导出布局为 SVG 矢量图文件。用户说"导出SVG/转矢量图"时调用。示例: outputPath="C:/output/图纸.svg", layout="Model"。SVG 可在浏览器/Illustrator中打开，支持无限缩放', inputSchema: { type: 'object', properties: { outputPath: { type: 'string', description: '输出文件路径，如 "C:/output/图纸.svg"' }, layout: { type: 'string', description: '布局名称，默认"Model"。如 "Model"、"A1布局"' } }, required: ['outputPath'] } },
{ name: 'export_bmp', description: '导出当前视图为 BMP 位图图片。用户说"导出图片/截图"时调用。示例: outputPath="C:/output/screenshot.bmp"。只导出当前视口显示内容，非整个图纸。如需矢量格式请用 export_svg', inputSchema: { type: 'object', properties: { outputPath: { type: 'string', description: '输出文件路径，如 "C:/output/screenshot.bmp"' } }, required: ['outputPath'] } },
{ name: 'export_stl', description: '导出 3D 实体为 STL 文件（3D打印格式）。用户说"导出STL/3D打印"时调用。示例: outputPath="C:/output/model.stl", handle="ABC"。不传 handle 则导出所有 3D 实体。STL 可用于切片软件/Cura/PrusaSlicer', inputSchema: { type: 'object', properties: { outputPath: { type: 'string', description: '输出文件路径（.stl），如 "C:/output/model.stl"' }, handle: { type: 'string', description: '3D实体句柄（可选，不传则导出所有3D实体）。如 "ABC"' } }, required: ['outputPath'] } }
];
