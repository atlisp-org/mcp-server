export const tools = [
{
        name: 'create_dimension_style',
        description: '创建标注样式(DimStyle)，控制箭头、颜色、文字样式等',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '样式名称' },
                color: { type: 'string', description: '颜色' },
                arrow: { type: 'string', description: '箭头类型' },
                textStyle: { type: 'string', description: '文字样式' }
            },
            required: ['name']
        }
    },
{
        name: 'set_dimstyle_var',
        description: '修改标注样式的系统变量(如DIMTXT,DIMSCALE等)',
        inputSchema: {
            type: 'object',
            properties: {
                styleName: { type: 'string', description: '标注样式名称' },
                variable: { type: 'string', description: '变量名' },
                value: { type: 'string', description: '变量值' }
            },
            required: ['styleName', 'variable', 'value']
        }
    },
{
        name: 'list_dimension_styles',
        description: '列出所有已定义的标注样式名称',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'create_text_style',
        description: '创建文字样式(TextStyle)。指定字体文件、字高、宽度因子和倾斜角',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '样式名称' },
                fontFile: { type: 'string', description: '字体文件名' },
                height: { type: 'number', description: '字高' },
                width: { type: 'number', description: '宽度因子' },
                angle: { type: 'number', description: '倾斜角度' }
            },
            required: ['name', 'fontFile']
        }
    },
{
        name: 'list_text_styles',
        description: '列出所有已定义的文字样式名称',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'create_linetype',
        description: '创建自定义线型。需提供描述和图案定义',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '线型名称' },
                description: { type: 'string', description: '线型描述' },
                pattern: { type: 'string', description: '线型图案定义' }
            },
            required: ['name', 'description', 'pattern']
        }
    },
{
        name: 'load_linetype',
        description: '从 .lin 线型定义文件加载线型到图形',
        inputSchema: {
            type: 'object',
            properties: {
                linetypeName: { type: 'string', description: '线型名称' },
                filePath: { type: 'string', description: '线型文件路径 (.lin)' }
            },
            required: ['linetypeName', 'filePath']
        }
    },
{
        name: 'list_linetypes',
        description: '列出当前图形中所有已加载的线型名称',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'create_mleader_style',
        description: '创建多重引线样式(MLeaderStyle)',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '样式名称' }
            },
            required: ['name']
        }
    },
{
        name: 'set_mleader_style_prop',
        description: '修改多重引线样式的属性',
        inputSchema: {
            type: 'object',
            properties: {
                styleName: { type: 'string', description: '样式名称' },
                property: { type: 'string', description: '属性名' },
                value: { type: 'string', description: '属性值' }
            },
            required: ['styleName', 'property', 'value']
        }
    },
{
        name: 'list_mleader_styles',
        description: '列出所有已定义的多重引线样式名称',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'create_cloud_line',
        description: '创建修订云线(CloudLine)。指定起点终点和凸度/弧长',
        inputSchema: {
            type: 'object',
            properties: {
                startPoint: { type: 'string', description: '起点 (x,y)' },
                endPoint: { type: 'string', description: '终点 (x,y)' },
                bulge: { type: 'number', description: '凸度' },
                arcRadius: { type: 'number', description: '弧长' }
            },
            required: ['startPoint', 'endPoint']
        }
    },
{
        name: 'convert_to_cloud_line',
        description: '将已有实体(圆/多段线等)转换为修订云线',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '实体句柄' }
            },
            required: ['handle']
        }
    }
];
