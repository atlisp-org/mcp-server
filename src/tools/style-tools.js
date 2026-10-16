export const tools = [
{
        name: 'create_dimension_style',
        description: '创建标注样式(DimStyle)。用户说"新建标注样式"时调用。控制箭头样式、颜色、文字样式等。创建后可用 set_dimstyle_var 调整详细变量，用 list_dimension_styles 查看所有样式',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '标注样式名称，如 "建筑标注"、"ISO-25"' },
                color: { type: 'string', description: '标注颜色，数字(1-255)或颜色名。如 "5"(蓝)、"1"(红)、"7"(白)' },
                arrow: { type: 'string', description: '箭头类型，如 "建筑标记"、"实心闭合"、"点"、"倾斜"' },
                textStyle: { type: 'string', description: '标注文字使用的文字样式名。先用 create_text_style 创建' }
            },
            required: ['name']
        }
    },
{
        name: 'set_dimstyle_var',
        description: '修改标注样式的系统变量。用户说"改标注变量/调标注细节"时调用。示例: styleName="建筑标注", variable="DIMTXT", value="3.5"。常见变量: DIMTXT(字高3.5)、DIMSCALE(全局比例100)、DIMGAP(基线间距)、DIMASZ(箭头大小)',
        inputSchema: {
            type: 'object',
            properties: {
                styleName: { type: 'string', description: '标注样式名称，如 "建筑标注"。用 list_dimension_styles 查看' },
                variable: { type: 'string', description: 'DIM变量名，如 "DIMTXT"(字高)、"DIMSCALE"(全局比例)、"DIMASZ"(箭头大小)、"DIMGAP"(文字偏移)' },
                value: { type: 'string', description: '变量值，如 "3.5"(字高)、"100"(比例)、"2.5"(箭头大小)' }
            },
            required: ['styleName', 'variable', 'value']
        }
    },
{
        name: 'list_dimension_styles',
        description: '列出所有已定义的标注样式名称。用户问"有哪些标注样式"时调用。返回名称数组如 ["ISO-25","建筑标注","土木标注"]。配合 create_dimension_style 新建或 set_dimstyle_var 调整现有样式',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'create_text_style',
        description: '创建文字样式(TextStyle)。用户说"新建文字样式"时调用。height=0 不固定字高（写文字时指定），大于0 固定。创建后在 draw_text/draw_mtext 中使用',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '文字样式名称，如 "工程字体"、"标注文字"' },
                fontFile: { type: 'string', description: '字体文件名，如 "simsun.ttc"(宋体)、"simhei.ttf"(黑体)、"arial.ttf"、"txt.shx"' },
                height: { type: 'number', description: '字高，0=不固定（写文字时指定），>0=固定高度。如 0 或 3.5' },
                width: { type: 'number', description: '宽度因子，1.0=标准，<1=窄体，>1=宽体。如 0.7' },
                angle: { type: 'number', description: '倾斜角度（度），0=正体，>0=右斜。如 0、15' }
            },
            required: ['name', 'fontFile']
        }
    },
{
        name: 'list_text_styles',
        description: '列出所有已定义的文字样式名称。用户问"有哪些文字样式"时调用。返回名称数组如 ["Standard","工程字体","标注文字"]。配合 create_text_style 新建或 set_text_style_name 应用到已有文字',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'create_linetype',
        description: '创建自定义线型。用户说"新建线型/自定义线型"时调用。需提供描述和图案定义。示例: name="DASHEDX2", description="双倍间距虚线", pattern="A,20,-10"。图案格式: A=对齐, 正数=实线段长, 负数=空白段长, 0=点。创建后用 load_linetype 加载到图形',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '线型名称，如 "DASHEDX2"、"自定义虚线"' },
                description: { type: 'string', description: '线型描述（显示在属性面板中），如 "双倍间距虚线"' },
                pattern: { type: 'string', description: '线型图案定义，如 "A,20,-10"(实线20空白10)、"A,5,-2,0,-2"(点划线)' }
            },
            required: ['name', 'description', 'pattern']
        }
    },
{
        name: 'load_linetype',
        description: '从 .lin 线型定义文件加载线型到图形。用户说"加载线型"时调用。示例: linetypeName="CENTER", filePath="C:/acad/acad.lin"。加载后可用 set_entity 将线型应用到实体。标准线型文件位于CAD安装目录的Support文件夹',
        inputSchema: {
            type: 'object',
            properties: {
                linetypeName: { type: 'string', description: '要加载的线型名称，如 "CENTER"、"DASHED"、"HIDDEN"' },
                filePath: { type: 'string', description: '.lin 线型定义文件路径，如 "C:/Program Files/AutoCAD 2024/Support/acad.lin"' }
            },
            required: ['linetypeName', 'filePath']
        }
    },
{
        name: 'list_linetypes',
        description: '列出当前图形中所有已加载的线型名称。用户问"有哪些线型"时调用。返回名称数组如 ["ByLayer","Continuous","CENTER","DASHED","HIDDEN"]。配合 load_linetype 加载更多线型，或 set_entity 改变实体线型',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'create_mleader_style',
        description: '创建多重引线样式(MLeaderStyle)。用户说"新建引线样式"时调用。示例: name="标注引线"。创建后用 set_mleader_style_prop 调整箭头、文字、引线等详细属性，用 list_mleader_styles 查看所有样式',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '多重引线样式名称，如 "标注引线"、"大样引线"' }
            },
            required: ['name']
        }
    },
{
        name: 'set_mleader_style_prop',
        description: '修改多重引线样式的详细属性。用户说"改引线样式"时调用。示例: styleName="标注引线", property="ArrowSymbol", value="箭头"。常见属性: ArrowSymbol(箭头类型)、LeaderColor(颜色)、TextColor(文字颜色)、TextHeight(文字高度)',
        inputSchema: {
            type: 'object',
            properties: {
                styleName: { type: 'string', description: '引线样式名称，如 "标注引线"。用 list_mleader_styles 查看' },
                property: { type: 'string', description: '属性名，如 "ArrowSymbol"(箭头)、"LeaderColor"(颜色)、"TextColor"(文字颜色)、"TextHeight"(字高)' },
                value: { type: 'string', description: '属性值，如 "箭头"、"实心闭合"、"1"(红色)、"3.5"(字高)' }
            },
            required: ['styleName', 'property', 'value']
        }
    },
{
        name: 'list_mleader_styles',
        description: '列出所有已定义的多重引线样式名称。用户问"有哪些引线样式"时调用。返回名称数组如 ["Standard","标注引线","大样引线"]。配合 create_mleader_style 新建或 set_mleader_style_prop 调整',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'create_cloud_line',
        description: '创建修订云线(CloudLine)。用户说"画云线/创建修订云线"时调用。返回新实体句柄。示例: startPoint="0,0", endPoint="100,0", bulge=0.5(凸度), arcRadius=10(弧长)。创建后可用 convert_to_cloud_line 将已有实体转为云线',
        inputSchema: {
            type: 'object',
            properties: {
                startPoint: { type: 'string', description: '起点坐标，如 "0,0"' },
                endPoint: { type: 'string', description: '终点坐标，如 "100,0"' },
                bulge: { type: 'number', description: '凸度（圆弧弯曲程度），正数逆时针负数顺时针，如 0.5。弧度=4*arctan(bulge)' },
                arcRadius: { type: 'number', description: '弧长（每段弧的尺寸），控制云线密度，如 10' }
            },
            required: ['startPoint', 'endPoint']
        }
    },
{
        name: 'convert_to_cloud_line',
        description: '将已有实体(圆/椭圆/多段线等)转换为修订云线。用户说"转云线"时调用。不可撤销！示例: handle="ABC"。转换后原实体形状保留但变为云线样式。与 create_cloud_line(新建云线)不同，本工具修改现有实体',
        inputSchema: {
            type: 'object',
            properties: {
                handle: { type: 'string', description: '要转换的实体句柄（圆/椭圆/多段线等），如 "ABC"' }
            },
            required: ['handle']
        }
    }
];
