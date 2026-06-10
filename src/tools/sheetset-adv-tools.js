export const tools = [
  {
    name: 'sheet_set_publish_options',
    description: '配置图纸发布选项（每张图纸的 PDF/DWF 格式、页面设置覆盖、打印戳记）',
    inputSchema: {
      type: 'object',
      properties: {
        sheetSetName: { type: 'string', description: '图纸集名称' },
        sheetName: { type: 'string', description: '图纸名称' },
        format: { type: 'string', enum: ['PDF', 'DWF'], description: '发布格式（可选）' },
        pageSetup: { type: 'string', description: '页面设置覆盖名称（可选）' },
        plotStamp: { type: 'boolean', description: '是否启用打印戳记（可选）' }
      },
      required: ['sheetSetName', 'sheetName']
    }
  },
  {
    name: 'sheet_set_transmit',
    description: 'eTransmit 打包图纸集：收集所有依赖文件（含外部参照）并创建传输包',
    inputSchema: {
      type: 'object',
      properties: {
        sheetSetName: { type: 'string', description: '图纸集名称' },
        outputPath: { type: 'string', description: '输出文件路径（zip 包，可选）' }
      },
      required: ['sheetSetName']
    }
  },
  {
    name: 'sheet_set_compare',
    description: '比较两个图纸集，列出仅存在于其中一个的图纸',
    inputSchema: {
      type: 'object',
      properties: {
        sheetSetName1: { type: 'string', description: '第一个图纸集名称' },
        sheetSetName2: { type: 'string', description: '第二个图纸集名称' }
      },
      required: ['sheetSetName1', 'sheetSetName2']
    }
  },
  {
    name: 'sheet_list_views',
    description: '列出图纸中布局的所有命名视图',
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
    name: 'sheet_import_layouts',
    description: '从外部 DWG 文件导入布局到图纸集',
    inputSchema: {
      type: 'object',
      properties: {
        sheetSetName: { type: 'string', description: '图纸集名称' },
        sourceDwg: { type: 'string', description: '源 DWG 文件路径' },
        layoutNames: { type: 'array', items: { type: 'string' }, description: '要导入的布局名称列表（可选，导入全部）' }
      },
      required: ['sheetSetName', 'sourceDwg']
    }
  }
];
