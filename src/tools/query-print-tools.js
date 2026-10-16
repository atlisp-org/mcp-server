export const tools = [
{
        name: 'plot_to_pdf',
        description: '将布局打印到 PDF 文件。用户说"打印PDF"时调用。可设图纸尺寸(A4~A0)、比例和方向（参数说明见 inputSchema）。批量打印多个布局请用 publish_layouts',
        inputSchema: {
            type: 'object',
            properties: {
                outputPath: { type: 'string', description: '输出PDF路径，如 "C:/output/图纸.pdf"' },
                layout: { type: 'string', description: '布局名称（默认"Model"），如 "Model"、"A1布局"' },
                paperSize: { type: 'string', description: '图纸尺寸，如 A4、A3、A2、A1、A0、Letter（默认根据布局）' },
                plotScale: { type: 'string', description: '打印比例，如 "1:1"、"1:100"、"2:1"（默认适配纸张）' },
                orientation: { type: 'string', description: '方向：Portrait(纵向)/Landscape(横向)（默认根据图纸尺寸）' }
            },
            required: ['outputPath']
        }
    },
{
        name: 'plot_to_printer',
        description: '将布局发送到实体打印机打印。用户说"打印到打印机"时调用。示例: printerName="HP LaserJet MFP", layout="A1-平面图"。需先使用 plot_device_management action=list 查看可用打印机名称',
        inputSchema: {
            type: 'object',
            properties: {
                printerName: { type: 'string', description: '打印机名称，如 "HP LaserJet MFP"、"Canon iR-ADV"。用 plot_device_management action=list 查看' },
                layout: { type: 'string', description: '布局名称（默认"Model"），如 "Model"、"A1-平面图"' }
            },
            required: ['printerName']
        }
    },
{
        name: 'create_group',
        description: '将多个实体编为一组（GROUP）。用户说"编组/成组"时调用。编组后方便整体选择和操作。创建后可用 get_group_entities 查看组内实体，或 batch_delete 整体删除。与"块(block)"不同，编组不解散也可单独选中组内实体',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '组名称，如 "墙体组"、"标注组"' },
                handles: { type: 'object', description: '实体句柄数组，如 ["ABC","DEF","GHI"]' }
            },
            required: ['name', 'handles']
        }
    },
{
        name: 'delete_group',
        description: '删除指定的组定义（不解散组内实体，仅删除组）。用户说"取消编组/删组"时调用。示例: name="临时组"。组内实体保留在图纸中不变。如需彻底解散并删除所有实体请用 batch_delete',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '要删除的组名称，如 "临时组"。用 list_groups 查看所有组' }
            },
            required: ['name']
        }
    },
{
        name: 'list_groups',
        description: '列出当前 DWG 中所有已命名的组名称。用户问"有哪些编组"时调用。返回组名数组如 ["墙体组","标注组","门窗组"]。配合 create_group 新建组，或 get_group_entities 查看组内实体',
        inputSchema: { type: 'object', properties: {} },
        outputSchema: {
            type: 'object',
            properties: {
                count: { type: 'number', description: '组数量' },
                groups: { type: 'array', items: { type: 'string' }, description: '组名数组' },
                raw: { type: 'string', description: '原始文本（仅当无法解析时出现）' }
            },
            required: ['count', 'groups']
        }
    },
{
        name: 'get_group_entities',
        description: '获取指定组中包含的所有实体句柄列表。用户问"XX组里有什么"时调用。返回句柄数组如 ["ABC","DEF","GHI"]。示例: groupName="墙体组"。获取后可用 batch_set_color 批量修改颜色或 batch_set_layer 批量改图层',
        inputSchema: {
            type: 'object',
            properties: {
                groupName: { type: 'string', description: '组名称，如 "墙体组"。用 list_groups 查看所有可用组' }
            },
            required: ['groupName']
        },
        outputSchema: {
            type: 'object',
            properties: {
                groupName: { type: 'string', description: '查询的组名' },
                count: { type: 'number', description: '组内实体数量' },
                handles: { type: 'array', items: { type: 'string' }, description: '组内实体句柄数组' },
                raw: { type: 'string', description: '原始文本（仅当无实体或无法解析时出现）' }
            },
            required: ['groupName', 'count', 'handles']
        }
    },
{
        name: 'measure_distance',
        description: '测量 CAD 中两点间的距离。用户问"多长/多远/间距多少"时调用。返回距离值及X/Y/Z分量差值。示例: p1="0,0,0", p2="100,50,0"。返回结果为数字（图形单位）。如需测量面积请用 measure_area',
        inputSchema: {
            type: 'object',
            properties: {
                p1: { type: 'string', description: '起点坐标，如 "0,0,0"（支持2D或3D）' },
                p2: { type: 'string', description: '终点坐标，如 "100,50,0"（支持2D或3D）' }
            },
            required: ['p1', 'p2']
        },
        outputSchema: {
            type: 'object',
            properties: {
                distance: { type: 'number', description: '两点间距离（图形单位）' },
                angleDeg: { type: 'number', description: '连线方向角（度）' },
                dx: { type: 'number', description: 'X 方向差值' },
                dy: { type: 'number', description: 'Y 方向差值' },
                raw: { type: 'string', description: '原始文本（仅当无法解析时出现）' }
            }
        }
    },
{
        name: 'measure_area',
        description: '测量多边形围合区域的面积和周长。用户问"面积多少/多大面积"时调用。返回面积和周长值。示例: points="0,0 100,0 100,100 0,100"（计算100x100正方形的面积10000）。如需测量距离请用 measure_distance',
        inputSchema: {
            type: 'object',
            properties: {
                points: { type: 'string', description: '多边形顶点坐标序列（空格分隔），如 "0,0 100,0 100,100 0,100"。至少3个点，自动闭合' }
            }
        },
        outputSchema: {
            type: 'object',
            properties: {
                area: { type: 'number', description: '面积（平方图形单位）' },
                perimeter: { type: 'number', description: '周长（图形单位）' },
                raw: { type: 'string', description: '原始文本（仅当无法解析时出现）' }
            }
        }
    },
{
        name: 'get_entity_info',
        description: '获取实体的详细 DXF 数据（含所有组码，如几何坐标、图层、颜色、线型、扩展数据等）。用户说"查这个实体详情"时调用。返回JSON包含全部组码。比 get_entity 信息更全。示例: handle="ABC"。只读操作不修改实体',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '实体句柄，如 "ABC"' }
            },
            required: ['handle']
        },
        outputSchema: {
            type: 'object',
            properties: {
                type: { type: 'string', description: '实体 DXF 类型' },
                handle: { type: 'string', description: '实体句柄' },
                layer: { type: 'string', description: '所在图层名' },
                color: { type: 'number', description: '颜色号（256=ByLayer）' },
                linetype: { type: 'string', description: '线型名' },
                elevation: { type: 'number', description: '标高（Z 值）' },
                layerFrozen: { type: 'boolean', description: '所在图层是否被冻结' },
                layerLocked: { type: 'boolean', description: '所在图层是否被锁定' },
                raw: { type: 'string', description: '原始文本（仅当无法解析时出现）' }
            },
            required: ['type', 'handle', 'layer']
        }
    },
{ name: 'create_page_setup', description: '创建页面设置（打印配置模板）。用户说"设置页面/打印设置"时调用。创建后可用 set_page_setup 应用到布局，或用 list_page_setups 管理', inputSchema: { type: 'object', properties: { name: { type: 'string', description: '页面设置名称，如 "我的模板"、"A3打印设置"' }, printer: { type: 'string', description: '打印机名称，默认"DWG To PDF.pc3"。可用 plot_device_management 查看' }, paperSize: { type: 'string', description: '纸张大小，默认"A4"。可选: A0, A1, A2, A3, A4, A5, Letter, Legal, Tabloid' }, orientation: { type: 'string', description: '方向: Portrait(纵向)/Landscape(横向)。默认 Landscape' }, scale: { type: 'string', description: '打印比例，默认"1:1"。如 "1:50"、"1:100"、"2:1"' } }, required: ['name'] } },
{ name: 'list_page_setups', description: '列出所有已保存的页面设置（打印配置模板）。用户说"有哪些打印模板"时调用。返回名称数组如 ["我的模板","A3打印","PDF输出"]。配合 set_page_setup 应用到布局或 create_page_setup 新建', inputSchema: { type: 'object', properties: {} }, outputSchema: { type: 'object', properties: { count: { type: 'number', description: '页面设置数量' }, pageSetups: { type: 'array', items: { type: 'string' }, description: '页面设置名称数组' }, raw: { type: 'string', description: '原始文本（仅当无法解析时出现）' } }, required: ['count', 'pageSetups'] } },
{ name: 'set_page_setup', description: '将页面设置应用到指定布局。用户说"用XX设置打印此布局"时调用。示例: layout="A1-平面图", pageSetupName="我的模板"。应用后可用 plot_to_pdf 按此设置打印。创建页面设置请先调用 create_page_setup', inputSchema: { type: 'object', properties: { layout: { type: 'string', description: '要应用设置的布局名称，如 "A1-平面图"' }, pageSetupName: { type: 'string', description: '页面设置名称（先用 create_page_setup 创建或用 list_page_setups 查看）' } }, required: ['layout', 'pageSetupName'] } },
{ name: 'import_page_setup', description: '从其他 DWG 文件中导入页面设置到当前图形。用户说"导入打印设置"时调用。示例: dwgPath="C:/模板/标准模板.dwg", pageSetupName="A3模板"（可选，不传则导入全部）。可用于统一团队打印标准', inputSchema: { type: 'object', properties: { dwgPath: { type: 'string', description: '源 DWG 文件路径，如 "C:/模板/标准模板.dwg"' }, pageSetupName: { type: 'string', description: '要导入的页面设置名称（可选，不传则导入全部）。如 "A3模板"' } }, required: ['dwgPath'] } },
];
