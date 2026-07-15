export const tools = [
{
        name: 'create_sheet_set',
        description: '创建图纸集（SheetSet）。用户说"建图纸集"时调用。需先有布局',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '图纸集名称' },
                description: { type: 'string', description: '描述' }
            },
            required: ['name']
        }
    },
{
        name: 'open_sheet_set',
        description: '打开已有的 .dst 图纸集文件',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: '图纸集文件路径' }
            },
            required: ['filePath']
        }
    },
{
        name: 'list_sheet_sets',
        description: '列出当前可用的所有图纸集',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'add_sheet',
        description: '向图纸集中添加图纸（关联布局）。用户说"添加图纸到图纸集"时调用',
        inputSchema: {
            type: 'object',
            properties: {
                sheetSetName: { type: 'string', description: '图纸集名称' },
                sheetName: { type: 'string', description: '图纸名称' },
                layoutName: { type: 'string', description: '布局名称（默认 Model）' }
            },
            required: ['sheetSetName', 'sheetName']
        }
    },
{
        name: 'list_sheets',
        description: '列出图纸集中的所有图纸名称',
        inputSchema: {
            type: 'object',
            properties: {
                sheetSetName: { type: 'string', description: '图纸集名称' }
            },
            required: ['sheetSetName']
        }
    },
{
        name: 'delete_sheet',
        description: '从图纸集中移除指定图纸',
        inputSchema: {
            type: 'object',
            properties: {
                sheetSetName: { type: 'string', description: '图纸集名称' },
                sheetName: { type: 'string', description: '图纸名称' }
            },
            required: ['sheetSetName', 'sheetName']
        }
    },
{
        name: 'publish_sheet_set',
        description: '将整个图纸集发布为PDF或DWF',
        inputSchema: {
            type: 'object',
            properties: {
                sheetSetName: { type: 'string', description: '图纸集名称' },
                outputDir: { type: 'string', description: '输出目录' },
                format: { type: 'string', enum: ['PDF', 'DWF'], description: '输出格式' }
            },
            required: ['sheetSetName', 'outputDir']
        }
    },
{
        name: 'get_sheet_set_property',
        description: '读取图纸集的自定义属性值',
        inputSchema: {
            type: 'object',
            properties: {
                sheetSetName: { type: 'string', description: '图纸集名称' },
                propertyName: { type: 'string', description: '属性名称' }
            },
            required: ['sheetSetName', 'propertyName']
        }
    },
    {
        name: 'create_sheet_set_archive',
        description: '归档图纸集（eTransmit打包为zip）',
        inputSchema: {
            type: 'object',
            properties: {
                sheetSetName: { type: 'string', description: '图纸集名称' },
                archivePath: { type: 'string', description: '归档文件路径' }
            },
            required: ['sheetSetName', 'archivePath']
        }
    },
    {
        name: 'reorder_sheet',
        description: '调整图纸在图纸集中的顺序',
        inputSchema: {
            type: 'object',
            properties: {
                sheetSetName: { type: 'string', description: '图纸集名称' },
                sheetName: { type: 'string', description: '图纸名称' },
                newIndex: { type: 'number', description: '新位置索引' }
            },
            required: ['sheetSetName', 'sheetName', 'newIndex']
        }
    },
    {
        name: 'create_subset',
        description: '在图纸集中创建子集（文件夹）用于分类',
        inputSchema: {
            type: 'object',
            properties: {
                sheetSetName: { type: 'string', description: '图纸集名称' },
                subsetName: { type: 'string', description: '子集名称' }
            },
            required: ['sheetSetName', 'subsetName']
        }
    },
    {
        name: 'list_subsets',
        description: '列出图纸集中的所有子集',
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
        description: '设置图纸的自定义属性',
        inputSchema: {
            type: 'object',
            properties: {
                sheetSetName: { type: 'string', description: '图纸集名称' },
                sheetName: { type: 'string', description: '图纸名称' },
                propertyName: { type: 'string', description: '属性名称' },
                value: { type: 'string', description: '属性值' }
            },
            required: ['sheetSetName', 'sheetName', 'propertyName', 'value']
        }
    }
];
