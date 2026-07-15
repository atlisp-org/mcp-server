export const tools = [
{
        name: 'attach_pdf',
        description: '将PDF文件作为底图附着到DWG中。指定插入点、缩放和旋转',
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
        description: '列出当前DWG中所有已附着的PDF底图',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'reload_pdf',
        description: '重新加载PDF底图（用于文件更新后刷新显示）',
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
        description: '拆离(删除)已附着的PDF底图',
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
        description: '获取PDF底图的信息（路径、页数、尺寸等）',
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
        description: '导入DXF文件到当前图形。explode=true则炸开插入',
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
        description: '导入DGN(V8)文件为DWG',
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
        description: '导出当前图形为DGN(V8)格式',
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
        description: '附着DGN文件作为底图到DWG',
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
        description: '附着DWF文件作为底图到DWG',
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
        description: '为实体添加超链接(URL)。用户说"加链接"时调用',
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
        description: '删除实体上的超链接',
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
        description: '批量附着多个PDF文件到DWG（拼图排列）。指定间距和方向',
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
        description: '按页面设置将布局打印为PDF文件',
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
