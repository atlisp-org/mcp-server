export const tools = [
{
        name: 'attach_pdf',
        description: '将PDF文件作为底图(underlay)附着到DWG中，不可编辑仅用于参考。指定插入点、缩放比例和旋转角度。用户说"导入PDF/附着PDF参考"时调用',
        inputSchema: {
            type: 'object',
            properties: {
                point: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }], description: '插入点坐标，如 "0,0" 或 [0,0]' },
                pdfPath: { type: 'string', description: 'PDF 文件完整路径，如 "C:/drawings/reference.pdf"' },
                scale: { type: 'number', description: '缩放比例（默认 1）。如 0.5=缩小一半，2=放大一倍' },
                rotation: { type: 'number', description: '旋转角度（默认 0），单位度，如 90' }
            },
            required: ['point', 'pdfPath']
        }
    },
{
        name: 'list_attached_pdfs',
        description: '列出当前 DWG 中所有已附着的 PDF 底图的名称、路径和状态。返回数组。用户问"图里贴了哪些PDF"时调用。配合 get_pdf_info 查看详情',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'reload_pdf',
        description: '重新加载 PDF 底图——当源 PDF 文件内容更新后刷新显示。用户说"刷新PDF/更新PDF底图"时调用',
        inputSchema: {
            type: 'object',
            properties: {
                pdfHandle: { type: 'string', description: 'PDF 底图实体句柄。先 list_attached_pdfs 获取' }
            },
            required: ['pdfHandle']
        }
    },
{
        name: 'detach_pdf',
        description: '拆离(删除)已附着的 PDF 底图，从 DWG 中移除引用。不可撤销。用户说"删掉PDF底图/拆离PDF"时调用。先 list_attached_pdfs 获取句柄',
        inputSchema: {
            type: 'object',
            properties: {
                pdfHandle: { type: 'string', description: 'PDF 底图实体句柄' }
            },
            required: ['pdfHandle']
        }
    },
{
        name: 'get_pdf_info',
        description: '获取 PDF 底图的详细信息（文件路径、总页数、页面尺寸、插入点等）。返回信息对象。用户问"这个PDF底图的信息"时调用',
        inputSchema: {
            type: 'object',
            properties: {
                pdfHandle: { type: 'string', description: 'PDF 底图实体句柄。先 list_attached_pdfs 获取' }
            },
            required: ['pdfHandle']
        }
    },
{
        name: 'import_dxf',
        description: '导入 DXF 文件到当前图形。explode=true 则炸开为基本图元插入。用户说"打开DXF/导入DXF"时调用。对比 import_dgn 导入 MicroStation 格式',
        inputSchema: {
            type: 'object',
            properties: {
                dxfPath: { type: 'string', description: 'DXF 文件路径，如 "C:/exchange/model.dxf"' },
                explode: { type: 'boolean', description: '是否炸开导入 true=炸开为基本图元, false=作为块参照插入（可选，默认 false）' }
            },
            required: ['dxfPath']
        }
    },
{
        name: 'import_dgn',
        description: '导入 DGN(V8) 文件为 DWG。支持 MicroStation 格式转换。可选指定 targetFile 保存到新文件。用户说"打开DGN/导入DGN"时调用',
        inputSchema: {
            type: 'object',
            properties: {
                sourceFile: { type: 'string', description: '源 DGN 文件路径，如 "C:/exchange/model.dgn"' },
                targetFile: { type: 'string', description: '目标 DWG 文件路径（可选，默认保存到当前图形）。如 "C:/output/result.dwg"' }
            },
            required: ['sourceFile']
        }
    },
{
        name: 'export_dgn',
        description: '导出当前图形为 DGN(V8) 格式，用于 MicroStation 等软件的交换。用户说"导出DGN"时调用。对比 export_dxf 导出为 DXF',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: '输出 DGN 文件路径，如 "C:/output/export.dgn"' }
            },
            required: ['filePath']
        }
    },
{
        name: 'create_dgn_underlay',
        description: '将 DGN 文件作为底图(underlay)附着到 DWG 中，不可编辑仅参考。指定插入点和缩放。用户说"附着DGN参考"时调用',
        inputSchema: {
            type: 'object',
            properties: {
                dgnPath: { type: 'string', description: 'DGN 文件路径，如 "C:/references/base.dgn"' },
                point: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }], description: '插入点坐标，如 "0,0" 或 [0,0]' },
                scale: { type: 'number', description: '缩放比例，如 1（可选，默认 1）' }
            },
            required: ['dgnPath', 'point']
        }
    },
{
        name: 'create_dwf_underlay',
        description: '将 DWF 文件作为底图(underlay)附着到 DWG 中，不可编辑仅参考。指定插入点和缩放。用户说"附着DWF参考"时调用',
        inputSchema: {
            type: 'object',
            properties: {
                dwfPath: { type: 'string', description: 'DWF 文件路径，如 "C:/references/review.dwf"' },
                point: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }], description: '插入点坐标，如 "0,0" 或 [0,0]' },
                scale: { type: 'number', description: '缩放比例，如 1（可选，默认 1）' }
            },
            required: ['dwfPath', 'point']
        }
    },
{
        name: 'create_hyperlink',
        description: '为实体添加超链接(URL)，点击实体可打开网页。用户说"加链接/加超链接"时调用。可选 description 描述文字。用 remove_hyperlink 删除',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '实体句柄，如 "1F3"' },
                url: { type: 'string', description: '超链接 URL，如 "https://example.com/spec" 或 "file://C:/docs/spec.pdf"' },
                description: { type: 'string', description: '链接描述文字（鼠标悬停时显示，可选）' }
            },
            required: ['handle', 'url']
        }
    },
{
        name: 'remove_hyperlink',
        description: '删除实体上的超链接(URL)。不可撤销。用户说"删掉链接/去掉超链接"时调用。也可以用 set_xdata 覆盖',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '实体句柄' }
            },
            required: ['handle']
        }
    },
{
        name: 'batch_attach_pdfs',
        description: '批量附着多个 PDF 底图到 DWG，按拼图方式排列（沿 X 或 Y 方向）。指定基准点、间距和排列方向。用户说"批量导入PDF"时调用',
        inputSchema: {
            type: 'object',
            properties: {
                pdfFiles: { type: 'array', items: { type: 'string' }, description: 'PDF 文件路径数组，如 ["C:/a.pdf", "C:/b.pdf"]' },
                basePoint: { type: 'string', description: '第一个 PDF 的基准插入点，如 "0,0"' },
                spacing: { type: 'number', description: '相邻 PDF 间距（默认 0）。如 100' },
                direction: { type: 'string', enum: ['x', 'y'], description: '排列方向: x=水平排列, y=垂直排列（默认 x）' }
            },
            required: ['pdfFiles', 'basePoint']
        }
    },
{
        name: 'save_pdf_layout',
        description: '按页面设置将布局打印为 PDF 文件到指定路径。可指定打印设备和纸张大小。用户说"把布局导出为PDF/打印布局"时调用',
        inputSchema: {
            type: 'object',
            properties: {
                layoutName: { type: 'string', description: '布局名称，如 "Model" 或 "A1-平面图"' },
                outputPath: { type: 'string', description: '输出 PDF 路径，如 "C:/output/平面图.pdf"' },
                plotDevice: { type: 'string', description: '打印设备名称（默认 "DWG to PDF.pc3"）。如 "DWG to PDF.pc3"' },
                paperSize: { type: 'string', description: '纸张大小（默认 "A4"）。可选 "A3"、"A2"、"A1"、"A0"、"Letter"' }
            },
            required: ['layoutName', 'outputPath']
        }
    }
];
