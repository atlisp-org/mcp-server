export const tools = [
{
        name: 'create_sheet_set',
        description: '创建图纸集(SheetSet)管理多个布局。用户说"建图纸集/创建图纸集"时调用。需先有布局(create_layout)。创建后可用 add_sheet 添加图纸',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '图纸集名称，如 "高层住宅A栋"' },
                description: { type: 'string', description: '图纸集描述说明，如 "A栋全套施工图"' }
            },
            required: ['name']
        }
    },
{
        name: 'open_sheet_set',
        description: '打开已有的 .dst 图纸集文件。用户说"打开图纸集"时调用。返回图纸集内容。打开后可用 list_sheets 列出图纸',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: '图纸集文件路径（.dst），如 "C:/projects/building.dst"' }
            },
            required: ['filePath']
        }
    },
{
        name: 'list_sheet_sets',
        description: '列出当前可用的所有图纸集(SheetSet)名称和路径。返回名称数组。用户问"有哪些图纸集"时调用',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'add_sheet',
        description: '向图纸集中添加图纸（关联一个布局）。用户说"添加图纸到图纸集/把布局加入图纸集"时调用。需先有布局(create_layout)',
        inputSchema: {
            type: 'object',
            properties: {
                sheetSetName: { type: 'string', description: '图纸集名称，如 "高层住宅A栋"' },
                sheetName: { type: 'string', description: '图纸名称（显示名），如 "一层平面图"' },
                layoutName: { type: 'string', description: '关联的布局名称（默认 Model）。如 "A1-一层平面"（可选）' }
            },
            required: ['sheetSetName', 'sheetName']
        }
    },
{
        name: 'list_sheets',
        description: '列出图纸集中所有图纸的名称、编号和状态。返回图纸数组。用户问"图纸集里有哪些图"时调用',
        inputSchema: {
            type: 'object',
            properties: {
                sheetSetName: { type: 'string', description: '图纸集名称，如 "高层住宅A栋"' }
            },
            required: ['sheetSetName']
        }
    },
{
        name: 'delete_sheet',
        description: '从图纸集中移除指定图纸（仅移除引用，不影响布局）。不可撤销。删除前建议先用 list_sheets 确认图纸名',
        inputSchema: {
            type: 'object',
            properties: {
                sheetSetName: { type: 'string', description: '图纸集名称' },
                sheetName: { type: 'string', description: '要移除的图纸名称' }
            },
            required: ['sheetSetName', 'sheetName']
        }
    },
{
        name: 'publish_sheet_set',
        description: '将整个图纸集发布为PDF或DWF文件到指定目录。用户说"发布图纸集/打印整套图"时调用。每张图纸生成一个文件',
        inputSchema: {
            type: 'object',
            properties: {
                sheetSetName: { type: 'string', description: '图纸集名称，如 "高层住宅A栋"' },
                outputDir: { type: 'string', description: '输出目录，如 "C:/projects/output/"' },
                format: { type: 'string', enum: ['PDF', 'DWF'], description: '输出格式: PDF（推荐）或 DWF，默认 PDF' }
            },
            required: ['sheetSetName', 'outputDir']
        }
    },
{
        name: 'get_sheet_set_property',
        description: '读取图纸集的自定义属性值。返回属性值字符串。配合 set_sheet_property 读写图纸集元数据。用户问"图纸集属性"时调用',
        inputSchema: {
            type: 'object',
            properties: {
                sheetSetName: { type: 'string', description: '图纸集名称，如 "高层住宅A栋"' },
                propertyName: { type: 'string', description: '自定义属性名，如 "项目编号"、"设计人"' }
            },
            required: ['sheetSetName', 'propertyName']
        }
    },
    {
        name: 'create_sheet_set_archive',
        description: '归档图纸集——通过 eTransmit 打包所有依赖文件（含 DWG、xref、字体等）为 zip。适用于交付或备份。用户说"打包图纸集/归档"时调用',
        inputSchema: {
            type: 'object',
            properties: {
                sheetSetName: { type: 'string', description: '图纸集名称，如 "高层住宅A栋"' },
                archivePath: { type: 'string', description: '归档 zip 文件输出路径，如 "C:/projects/archive.zip"' }
            },
            required: ['sheetSetName', 'archivePath']
        }
    },
    {
        name: 'reorder_sheet',
        description: '调整图纸在图纸集中的显示顺序（索引从0开始）。用户说"把XX图移到第N张"时调用。先 list_sheets 看当前顺序',
        inputSchema: {
            type: 'object',
            properties: {
                sheetSetName: { type: 'string', description: '图纸集名称' },
                sheetName: { type: 'string', description: '要移动的图纸名称' },
                newIndex: { type: 'number', description: '新位置索引（0-based），如 0=最前，3=第四张' }
            },
            required: ['sheetSetName', 'sheetName', 'newIndex']
        }
    },
    {
        name: 'create_subset',
        description: '在图纸集中创建子集（相当于文件夹），用于将图纸按专业/楼层分类。用户说"建子集/建分类文件夹"时调用。之后 add_sheet 时可指定到此子集',
        inputSchema: {
            type: 'object',
            properties: {
                sheetSetName: { type: 'string', description: '图纸集名称' },
                subsetName: { type: 'string', description: '子集名称，如 "建筑专业"、"一层图纸"' }
            },
            required: ['sheetSetName', 'subsetName']
        }
    },
    {
        name: 'list_subsets',
        description: '列出图纸集中的所有子集（分类文件夹）名称。返回子集名称数组。用户问"图纸集有哪些分类"时调用',
        inputSchema: {
            type: 'object',
            properties: {
                sheetSetName: { type: 'string', description: '图纸集名称' }
            },
            required: ['sheetSetName']
        }
    },
    {
        name: 'set_sheet_property',
        description: '设置图纸的自定义属性值（键值对）。可用于标注图号、版本、设计人等信息。配合 get_sheet_set_property 读取。用户说"给图纸加属性"时调用',
        inputSchema: {
            type: 'object',
            properties: {
                sheetSetName: { type: 'string', description: '图纸集名称' },
                sheetName: { type: 'string', description: '图纸名称' },
                propertyName: { type: 'string', description: '属性名，如 "图号"、"版本"、"状态"' },
                value: { type: 'string', description: '属性值，如 "JS-01"、"Rev.A"、"送审"' }
            },
            required: ['sheetSetName', 'sheetName', 'propertyName', 'value']
        }
    }
];
