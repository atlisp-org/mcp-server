export const tools = [
  {
    name: 'batch_plot_wizard',
    description: '批量打印向导——选择多个布局同时输出为 PDF/DWF 到指定目录。支持预览模式 preview=true 只查看不实际打印。用户说"批量打印/打印多个布局"时调用。对比 publish_sheet_set 在图纸集上操作',
    inputSchema: {
      type: 'object',
      properties: {
        layouts: { type: 'array', items: { type: 'string' }, description: '布局名称列表，如 ["Model", "A1-平面图", "A2-立面图"]' },
        outputDir: { type: 'string', description: '输出目录，如 "C:/projects/prints/"' },
        format: { type: 'string', enum: ['PDF', 'DWF'], description: '输出格式: PDF 或 DWF（默认 PDF）' },
        pageSetup: { type: 'string', description: '使用的页面设置(PageSetup)名称（可选），如 "A3横版"。先用 list_page_setups 查看' },
        namingRule: { type: 'string', description: '命名规则模板，{layout} 和 {date} 为占位符（默认 "{layout}"）。如 "{layout}_{date}"' },
        preview: { type: 'boolean', description: '预览模式: true=只返回文件名列表不实际打印, false=实际打印（可选，默认 false）' }
      },
      required: ['layouts', 'outputDir']
    }
  },
  {
    name: 'plot_device_management',
    description: '打印设备管理。action=list（列出所有可用打印机/绘图仪）、get（查看设备详情）、set（设为默认设备）、test（测试打印一页）。用户说"看看有哪些打印机/设置打印机"时调用',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'get', 'set', 'test'], description: '操作: list=列出所有设备, get=查看指定设备详情, set=设为默认, test=测试打印' },
        name: { type: 'string', description: '打印设备名称（get/set/test 时需要）。如 "DWG To PDF.pc3"、"HP DesignJet Z9"' }
      },
      required: ['action']
    }
  },
  {
    name: 'plot_log',
    description: '查询打印历史记录——按日期范围(fromDate/toDate)和状态(success/error)过滤。返回打印记录列表含时间/布局/文件等信息。用户问"打印记录/打印历史"时调用',
    inputSchema: {
      type: 'object',
      properties: {
        fromDate: { type: 'string', description: '起始日期（ISO 格式，可选），如 "2024-01-01" 或 "2024-01-01T00:00:00Z"' },
        toDate: { type: 'string', description: '结束日期（ISO 格式，可选），如 "2024-12-31"' },
        status: { type: 'string', description: '按状态过滤（可选）: "success"=成功, "error"=失败, "failed"=失败。不传则返回全部' }
      }
    }
  },
  {
    name: 'plot_from_file_list',
    description: '直接从 DWG 文件列表批量打印——每个文件可指定不同布局和输出路径。支持 fileList(数组传参)或 textFile(从文本文件读取)。用户说"批量打印多个DWG"时调用',
    inputSchema: {
      type: 'object',
      properties: {
        fileList: { type: 'array', items: { type: 'object', properties: { dwgPath: { type: 'string' }, layout: { type: 'string' }, outputPath: { type: 'string' } } }, description: '文件列表数组，每项含: dwgPath(DWG路径)、layout(布局名)、outputPath(输出路径)。如 [{dwgPath:"a.dwg",layout:"Model",outputPath:"a.pdf"}]' },
        textFile: { type: 'string', description: '文本文件路径（与 fileList 二选一），每行格式: dwgPath|layout|outputPath。如 "C:/jobs/print-list.txt"' }
      }
    }
  }
];
