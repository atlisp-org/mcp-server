export const tools = [
  {
    name: 'batch_plot_wizard',
    description: '批量打印向导 - 支持多布局、PDF/DWF、页面设置、命名规则和预览模式',
    inputSchema: {
      type: 'object',
      properties: {
        layouts: { type: 'array', items: { type: 'string' }, description: '布局名称列表' },
        outputDir: { type: 'string', description: '输出目录' },
        format: { type: 'string', enum: ['PDF', 'DWF'], description: '输出格式（默认 PDF）' },
        pageSetup: { type: 'string', description: '页面设置名称（可选）' },
        namingRule: { type: 'string', description: '命名规则，如 {layout}_{date}（默认 {layout}）' },
        preview: { type: 'boolean', description: '预览模式，只返回文件名不实际打印（可选）' }
      },
      required: ['layouts', 'outputDir']
    }
  },
  {
    name: 'plot_device_management',
    description: '打印设备管理 - 列出/获取/设置/测试打印设备',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'get', 'set', 'test'], description: '操作类型: list（列出）、get（查看详情）、set（设置为当前）、test（测试打印）' },
        name: { type: 'string', description: '打印设备名称（get/set/test 时需要）' }
      },
      required: ['action']
    }
  },
  {
    name: 'plot_log',
    description: '查询打印作业历史记录（从 ~/.atlisp/plot-log.json 读取）',
    inputSchema: {
      type: 'object',
      properties: {
        fromDate: { type: 'string', description: '起始日期（ISO 格式，如 2024-01-01，可选）' },
        toDate: { type: 'string', description: '结束日期（ISO 格式，可选）' },
        status: { type: 'string', description: '状态过滤（如 success/error/failed，可选）' }
      }
    }
  },
  {
    name: 'plot_from_file_list',
    description: '根据文件列表批量打印 - 支持直接传入文件列表或从文本文件读取',
    inputSchema: {
      type: 'object',
      properties: {
        fileList: { type: 'array', items: { type: 'object', properties: { dwgPath: { type: 'string' }, layout: { type: 'string' }, outputPath: { type: 'string' } } }, description: '文件列表数组，每项含 dwgPath、layout、outputPath' },
        textFile: { type: 'string', description: '文本文件路径，每行格式: dwgPath|layout|outputPath' }
      }
    }
  }
];
