export const tools = [
{
        name: 'create_ucs',
        description: '创建用户坐标系(UCS)。用户说"建坐标系/设UCS"时调用。返回新UCS名称。示例: name="我的UCS", origin="0,0,0", xAxis="1,0,0", yAxis="0,1,0"。创建后可用 set_ucs 切换到该UCS或 delete_ucs 删除',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'UCS名称，如 "立面UCS"、"剖切UCS"' },
                origin: { type: 'string', description: '原点坐标，如 0,0,0（默认WCS原点）' },
                xAxis: { type: 'string', description: 'X轴方向向量，如 1,0,0（默认世界X轴）' },
                yAxis: { type: 'string', description: 'Y轴方向向量，如 0,1,0（默认世界Y轴）' }
            },
            required: ['name']
        }
    },
{
        name: 'set_ucs',
        description: '切换到之前创建的 UCS。用户说"切换到XX坐标系"时调用。切换后绘制命令使用新坐标系。示例: name="立面UCS"。可用 list_ucs 查看所有可用UCS，用 get_current_ucs 查看当前UCS',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '要切换到的UCS名称，如 "立面UCS"。用 list_ucs 查看所有可选项' }
            },
            required: ['name']
        }
    },
{
        name: 'list_ucs',
        description: '列出当前图形中所有已定义的 UCS 名称。用户问"有哪些坐标系"时调用。返回UCS名称数组如 ["世界","立面UCS","剖切UCS"]。配合 set_ucs 切换坐标系或 delete_ucs 删除不需要的',
        inputSchema: { type: 'object', properties: {} },
        outputSchema: {
            type: 'object',
            properties: {
                count: { type: 'number', description: 'UCS 数量' },
                ucs: { type: 'array', items: { type: 'string' }, description: 'UCS 名称数组' },
                raw: { type: 'string', description: '原始文本（仅当无 UCS 或无法解析时出现）' }
            },
            required: ['count', 'ucs']
        }
    },
{
        name: 'delete_ucs',
        description: '删除指定的已命名 UCS。用户说"删除XX坐标系"时调用。示例: name="临时UCS"。不能删除当前正在使用的UCS，需先 set_ucs 切换到其他坐标系。World(世界)UCS不可删除',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '要删除的UCS名称，如 "临时UCS"。使用 list_ucs 查看可删除项' }
            },
            required: ['name']
        }
    },
{
        name: 'get_current_ucs',
        description: '查询当前正在使用的 UCS 名称。用户问"当前是什么坐标系"时调用。返回UCS名称字符串，如 "世界"、"立面UCS"。只读操作，不改变当前状态',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'create_layout',
        description: '创建新布局（图纸空间）。用户说"新建布局/新建图纸"时调用。返回新布局名称。示例: name="A1-平面图"。创建后用 set_layout 切换到该布局，或创建视口 viewport在其中显示模型内容',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '布局名称，如 "A1-平面图"、"剖面图"。不能与已有布局重名' }
            },
            required: ['name']
        }
    },
{
        name: 'set_layout',
        description: '切换到指定布局（图纸空间）。用户说"切换到XX布局/看布局"时调用。切换后所有命令在选定布局中执行。示例: name="A1-平面图"。用 list_layouts 查看所有布局，用 get_current_layout 确认当前布局',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '布局名称，如 "A1-平面图"、"Model"。用 list_layouts 查看可选项' }
            },
            required: ['name']
        }
    },
{
        name: 'list_layouts',
        description: '列出当前 DWG 中所有布局名称（含 Model）。用户问"有哪些布局"时调用。返回布局名数组如 ["Model","A1-平面图","剖面图"]。配合 set_layout 切换或 delete_layout 删除不需要的布局',
        inputSchema: { type: 'object', properties: {} },
        outputSchema: {
            type: 'object',
            properties: {
                count: { type: 'number', description: '布局数量' },
                layouts: { type: 'array', items: { type: 'string' }, description: '布局名称数组' },
                raw: { type: 'string', description: '原始文本（仅当无布局或无法解析时出现）' }
            },
            required: ['count', 'layouts']
        }
    },
{
        name: 'delete_layout',
        description: '删除指定布局。用户说"删除布局"时调用。示例: name="旧布局"。不能删除 Model 布局。如果布局中有视口/实体，建议先清理再删除。删除后不可恢复',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '要删除的布局名称，如 "旧布局"。Model不可删除。用 list_layouts 查看可选项' }
            },
            required: ['name']
        }
    },
{
        name: 'get_current_layout',
        description: '查询当前正在工作的布局名称。用户问"当前在哪个布局"时调用。返回布局名如 "Model" 或 "A1-平面图"。只读操作，不切换布局。如需切换请用 set_layout',
        inputSchema: { type: 'object', properties: {} }
    },
{
        name: 'rename_layout',
        description: '给布局改名字。用户说"重命名布局"时调用。示例: oldName="布局1", newName="A1-平面图"。Model不能重命名。重命名后所有引用该布局的工具需使用新名称',
        inputSchema: {
            type: 'object',
            properties: {
                oldName: { type: 'string', description: '原布局名称，如 "布局1"' },
                newName: { type: 'string', description: '新布局名称，如 "A1-平面图"' }
            },
            required: ['oldName', 'newName']
        }
    }
];
