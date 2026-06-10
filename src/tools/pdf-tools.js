export const tools = [
{
        name: 'attach_pdf',
        description: '附着 PDF 底图',
        inputSchema: {
            type: 'object',
            properties: {
                point: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }], description: '插入点 (x,y)' },
                pdfPath: { type: 'string', description: 'PDF 文件路径' },
                scale: { type: 'number', description: '缩放比例（默认1）' },
                rotation: { type: 'number', description: '旋转角度（默认0）' }
            },
            required: ['point', 'pdfPath']
        }
    },
{
        name: 'list_attached_pdfs',
        description: '列出所有已附着的 PDF',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'reload_pdf',
        description: '重载 PDF 底图',
        inputSchema: {
            type: 'object',
            properties: {
                pdfHandle: { type: 'string', description: 'PDF 实体句柄' }
            },
            required: ['pdfHandle']
        }
    },
{
        name: 'detach_pdf',
        description: '拆离 PDF 底图',
        inputSchema: {
            type: 'object',
            properties: {
                pdfHandle: { type: 'string', description: 'PDF 实体句柄' }
            },
            required: ['pdfHandle']
        }
    },
{
        name: 'get_pdf_info',
        description: '获取 PDF 底图信息',
        inputSchema: {
            type: 'object',
            properties: {
                pdfHandle: { type: 'string', description: 'PDF 实体句柄' }
            },
            required: ['pdfHandle']
        }
    },
{
        name: 'import_dxf',
        description: '导入 DXF 文件',
        inputSchema: {
            type: 'object',
            properties: {
                dxfPath: { type: 'string', description: 'DXF 文件路径' },
                explode: { type: 'boolean', description: '是否炸开导入' }
            },
            required: ['dxfPath']
        }
    },
{
        name: 'import_dgn',
        description: '导入 DGN 文件',
        inputSchema: {
            type: 'object',
            properties: {
                sourceFile: { type: 'string', description: '源 DGN 文件路径' },
                targetFile: { type: 'string', description: '目标 DWG 文件路径（可选）' }
            },
            required: ['sourceFile']
        }
    },
{
        name: 'export_dgn',
        description: '导出为 DGN 文件',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: '输出文件路径' }
            },
            required: ['filePath']
        }
    },
{
        name: 'create_dgn_underlay',
        description: '附着 DGN 底图',
        inputSchema: {
            type: 'object',
            properties: {
                dgnPath: { type: 'string', description: 'DGN 文件路径' },
                point: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }], description: '插入点' },
                scale: { type: 'number', description: '缩放比例' }
            },
            required: ['dgnPath', 'point']
        }
    },
{
        name: 'create_dwf_underlay',
        description: '附着 DWF 底图',
        inputSchema: {
            type: 'object',
            properties: {
                dwfPath: { type: 'string', description: 'DWF 文件路径' },
                point: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' } }], description: '插入点' },
                scale: { type: 'number', description: '缩放比例' }
            },
            required: ['dwfPath', 'point']
        }
    },
{
        name: 'create_hyperlink',
        description: '创建超链接',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '实体句柄' },
                url: { type: 'string', description: '超链接 URL' },
                description: { type: 'string', description: '描述（可选）' }
            },
            required: ['handle', 'url']
        }
    },
{
        name: 'remove_hyperlink',
        description: '删除超链接',
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
        description: '批量附着 PDF（如拼图打印）',
        inputSchema: {
            type: 'object',
            properties: {
                pdfFiles: { type: 'array', items: { type: 'string' }, description: 'PDF 文件路径列表' },
                basePoint: { type: 'string', description: '基准点 (x,y)' },
                spacing: { type: 'number', description: '间距（默认0）' },
                direction: { type: 'string', enum: ['x', 'y'], description: '排列方向' }
            },
            required: ['pdfFiles', 'basePoint']
        }
    },
{
        name: 'save_pdf_layout',
        description: '保存布局为 PDF（批量打印）',
        inputSchema: {
            type: 'object',
            properties: {
                layoutName: { type: 'string', description: '布局名称' },
                outputPath: { type: 'string', description: '输出路径' },
                plotDevice: { type: 'string', description: '打印设备（默认 DWG to PDF.pc3）' },
                paperSize: { type: 'string', description: '纸张大小（默认 A4）' }
            },
            required: ['layoutName', 'outputPath']
        }
    }
];
