export const tools = [
  {
    name: 'sheet_set_publish_options',
    description: '配置图纸集中单张图纸的发布格式(PDF/DWF)、页面设置覆盖和打印戳记。用于批量发布前精细化控制。配合 publish_sheet_set 使用',
    inputSchema: {
      type: 'object',
      properties: {
        sheetSetName: { type: 'string', description: '图纸集名称，如 "高层住宅A栋"' },
        sheetName: { type: 'string', description: '要配置的图纸名称，如 "一层平面图"' },
        format: { type: 'string', enum: ['PDF', 'DWF'], description: '发布格式覆盖: PDF 或 DWF（可选，使用默认）' },
        pageSetup: { type: 'string', description: '页面设置名称覆盖，如 "A3横排版"（可选）' },
        plotStamp: { type: 'boolean', description: '是否启用打印戳记(plot stamp)，显示图名/日期等（可选，默认不变）' }
      },
      required: ['sheetSetName', 'sheetName']
    }
  },
  {
    name: 'sheet_set_transmit',
    description: 'eTransmit 打包——收集图纸集所有依赖文件（含 DWG、外部参照、字体、打印配置等）准备传输/交付。可选输出为 zip。用户说"打包传输/收集文件"时调用',
    inputSchema: {
      type: 'object',
      properties: {
        sheetSetName: { type: 'string', description: '图纸集名称，如 "高层住宅A栋"' },
        outputPath: { type: 'string', description: '输出 zip 包路径，如 "C:/projects/交付包.zip"（可选，不传则仅列出依赖文件）' }
      },
      required: ['sheetSetName']
    }
  },
  {
    name: 'sheet_set_compare',
    description: '比较两个图纸集的差异——找出新增/删除/修改的图纸。返回差异清单。多版本管理或图纸变更审查时使用',
    inputSchema: {
      type: 'object',
      properties: {
        sheetSetName1: { type: 'string', description: '第一个图纸集名称（基准版本），如 "高层A栋-v1"' },
        sheetSetName2: { type: 'string', description: '第二个图纸集名称（对比版本），如 "高层A栋-v2"' }
      },
      required: ['sheetSetName1', 'sheetSetName2']
    }
  },
  {
    name: 'sheet_list_views',
    description: '列出图纸中布局包含的所有命名视图(named views)。返回视图名称/范围列表。配合 list_sheets 先查出布局再查看视图',
    inputSchema: {
      type: 'object',
      properties: {
        sheetSetName: { type: 'string', description: '图纸集名称，如 "高层住宅A栋"' },
        sheetName: { type: 'string', description: '图纸名称，如 "一层平面图"' }
      },
      required: ['sheetSetName', 'sheetName']
    }
  },
  {
    name: 'sheet_import_layouts',
    description: '从外部 DWG 文件导入布局到图纸集作为新图纸。可选 layoutNames 指定导入哪些布局（不传则导入全部）。用户说"从别的图导入布局"时调用',
    inputSchema: {
      type: 'object',
      properties: {
        sheetSetName: { type: 'string', description: '目标图纸集名称' },
        sourceDwg: { type: 'string', description: '源 DWG 文件路径，如 "C:/projects/source.dwg"' },
        layoutNames: { type: 'array', items: { type: 'string' }, description: '要导入的布局名称列表，如 ["A1-平面", "A2-立面"]（可选，不传则导入全部布局）' }
      },
      required: ['sheetSetName', 'sourceDwg']
    }
  }
];
