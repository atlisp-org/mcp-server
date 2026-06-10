export const tools = [
{
        name: 'plot_to_pdf',
        description: '打印到 PDF 文件',
        inputSchema: {
            type: 'object',
            properties: {
                outputPath: { type: 'string', description: '输出 PDF 路径' },
                layout: { type: 'string', description: '布局名称（默认 Model）' },
                paperSize: { type: 'string', description: '图纸尺寸（如 A4, A3）' },
                plotScale: { type: 'string', description: '打印比例（如 1:1）' },
                orientation: { type: 'string', description: '方向：Portrait/Landscape' }
            },
            required: ['outputPath']
        }
    },
{
        name: 'plot_to_printer',
        description: '打印到打印机',
        inputSchema: {
            type: 'object',
            properties: {
                printerName: { type: 'string', description: '打印机名称' },
                layout: { type: 'string', description: '布局名称（默认 Model）' }
            },
            required: ['printerName']
        }
    },
{
        name: 'create_group',
        description: '创建组（GROUP）',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '组名称' },
                handles: { type: 'object', description: '实体句柄数组' }
            },
            required: ['name', 'handles']
        }
    },
{
        name: 'delete_group',
        description: '删除组',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '组名称' }
            },
            required: ['name']
        }
    },
{
        name: 'list_groups',
        description: '列出所有组',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'get_group_entities',
        description: '获取组内实体句柄',
        inputSchema: {
            type: 'object',
            properties: {
                groupName: { type: 'string', description: '组名称' }
            },
            required: ['groupName']
        }
    },
{
        name: 'measure_distance',
        description: '测量两点距离',
        inputSchema: {
            type: 'object',
            properties: {
                p1: { type: 'string', description: '点1坐标，如 0,0,0' },
                p2: { type: 'string', description: '点2坐标，如 100,50,0' }
            },
            required: ['p1', 'p2']
        }
    },
{
        name: 'measure_area',
        description: '测量多边形面积',
        inputSchema: {
            type: 'object',
            properties: {
                points: { type: 'string', description: '点序列，如 0,0 100,0 100,100 0,100' }
            }
        }
    },
{
        name: 'get_entity_info',
        description: '获取实体详细信息',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '实体句柄' }
            },
            required: ['handle']
        }
    },
{ name: 'create_page_setup', description: '创建页面设置', inputSchema: { type: 'object', properties: { name: { type: 'string', description: '页面设置名称' }, printer: { type: 'string', description: '打印机名称(默认DWG To PDF.pc3)' }, paperSize: { type: 'string', description: '纸张大小(默认A4)' }, orientation: { type: 'string', description: '方向: Portrait/Landscape' }, scale: { type: 'string', description: '比例(默认1:1)' } }, required: ['name'] } },
{ name: 'list_page_setups', description: '列出所有页面设置', inputSchema: { type: 'object', properties: {} } },
{ name: 'set_page_setup', description: '为布局指定页面设置', inputSchema: { type: 'object', properties: { layout: { type: 'string', description: '布局名称' }, pageSetupName: { type: 'string', description: '页面设置名称' } }, required: ['layout', 'pageSetupName'] } },
{ name: 'import_page_setup', description: '从外部DWG导入页面设置', inputSchema: { type: 'object', properties: { dwgPath: { type: 'string', description: '源DWG文件路径' }, pageSetupName: { type: 'string', description: '要导入的页面设置名称(可选,默认全部)' } }, required: ['dwgPath'] } },
];
