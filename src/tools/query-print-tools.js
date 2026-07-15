export const tools = [
{
        name: 'plot_to_pdf',
        description: '将布局打印到 PDF 文件。可设置图纸尺寸(A4/A3/A2/A1/A0)、比例和方向。用户说"打印PDF"时调用',
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
        description: '将布局发送到实体打印机打印。需先知道打印机名称（用 plot_device_management action=list 查看）',
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
        description: '将多个实体编为一组（GROUP），方便整体选择和操作。用户说"编组/成组"时调用',
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
        description: '删除指定的组（不解散组内实体，仅删除组定义）',
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
        description: '列出当前 DWG 中所有已命名的组名称',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'get_group_entities',
        description: '获取指定组中包含的所有实体句柄列表',
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
        description: '测量 CAD 中两点间的距离。用户问"多长/多远/间距多少"时调用',
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
        description: '测量多边形围合区域的面积和周长。用户问"面积多少"时调用',
        inputSchema: {
            type: 'object',
            properties: {
                points: { type: 'string', description: '点序列，如 0,0 100,0 100,100 0,100' }
            }
        }
    },
{
        name: 'get_entity_info',
        description: '获取实体的详细 DXF 数据（含所有组码）。比 get_entity 信息更全',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '实体句柄' }
            },
            required: ['handle']
        }
    },
{ name: 'create_page_setup', description: '创建页面设置（打印配置模板）。指定打印机、纸张、方向和比例。用户说"设置页面/打印设置"时调用', inputSchema: { type: 'object', properties: { name: { type: 'string', description: '页面设置名称' }, printer: { type: 'string', description: '打印机名称(默认DWG To PDF.pc3)' }, paperSize: { type: 'string', description: '纸张大小(默认A4)。可选: A0, A1, A2, A3, A4, A5, Letter, Legal, Tabloid' }, orientation: { type: 'string', description: '方向: Portrait(纵向) / Landscape(横向)' }, scale: { type: 'string', description: '打印比例(默认1:1)。如 1:50, 1:100, 2:1' } }, required: ['name'] } },
{ name: 'list_page_setups', description: '列出所有已保存的页面设置（打印配置模板）', inputSchema: { type: 'object', properties: {} } },
{ name: 'set_page_setup', description: '将页面设置应用到指定布局，用于打印。用户说"用XX设置打印此布局"时调用', inputSchema: { type: 'object', properties: { layout: { type: 'string', description: '要应用设置的布局名称' }, pageSetupName: { type: 'string', description: '页面设置名称（先 create_page_setup 创建）' } }, required: ['layout', 'pageSetupName'] } },
{ name: 'import_page_setup', description: '从其他 DWG 文件中导入页面设置到当前图形', inputSchema: { type: 'object', properties: { dwgPath: { type: 'string', description: '源 DWG 文件路径' }, pageSetupName: { type: 'string', description: '要导入的页面设置名称(可选,默认全部)' } }, required: ['dwgPath'] } },
];
