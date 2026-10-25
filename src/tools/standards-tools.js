// 行业取值与 standards-readers.js 的 INDUSTRY_FILE_MAP 保持一致。写成 enum 是为了
// 让模型直接看到合法取值——传 "建筑行业" 之类的别名会被后端静默回落成通用规范。
const INDUSTRY_VALUES = [
  '通用', '建筑', '结构', '机械', '电气', '暖通给排水',
  '土木道桥', '测绘', '室内装饰', '景观园林',
];
const INDUSTRY_DESC = `行业规范，默认"通用"。可选：${INDUSTRY_VALUES.join(' / ')}。不同行业有不同的规则与图层前缀。`;

export const tools = [
  {
    name: 'check_drawing_standards',
    description: '检查当前图纸是否符合制图规范。增强版支持按类别检查图层/颜色/线型/线宽/文字样式/标注样式。返回不合规项列表。当用户说"检查图纸规范/图纸是否符合标准"时调用。',
    inputSchema: {
      type: 'object',
      properties: {
        industry: { type: 'string', description: '行业规范: "通用"(默认)/"建筑"/"结构"/"机械"/"电气"/"暖通给排水"/"土木道桥"/"测绘"/"室内装饰"/"景观园林"。不同行业有不同的规范要求。' },
        categories: { type: 'array', items: { type: 'string', enum: ['layers', 'colors', 'linetypes', 'lineweights', 'textstyles', 'dimstyles', 'file_naming'] }, description: '要检查的类别，默认全部检查。可指定子集如 ["layers","colors"]。' },
        strict: { type: 'boolean', description: '严格模式：true=所有警告都视为错误，false=仅检查必需项（默认）' }
      }
    }
  },
  {
    name: 'apply_standards_template',
    description: '一键应用标准模板：根据行业规范创建所有必需图层、设置颜色/线型/线宽、创建标准文字样式和标注样式。当用户说"应用建筑模板/按规范设置图层"时调用。destructive——会修改图纸结构。',
    inputSchema: {
      type: 'object',
      properties: {
        industry: { type: 'string', enum: INDUSTRY_VALUES, description: '要应用的行业模板，必填。可选：' + INDUSTRY_VALUES.join(' / ') + '。会按该行业规范创建必需图层与样式。' },
        overwrite: { type: 'boolean', description: '是否覆盖已有同名图层/样式，默认false（跳过已存在的）' }
      },
      required: ['industry']
    }
  },
  {
    name: 'list_standards',
    description: '列出所有可用的行业规范文件。当用户说"有哪些行业规范/可用的规范"时调用。返回规范名称、版本、支持行业。',
    inputSchema: {
      type: 'object',
      properties: {
        industry: { type: 'string', enum: INDUSTRY_VALUES, description: '可选：筛选指定行业（如 "建筑"）；不传则列出全部规范文件' }
      }
    }
  },
  {
    name: 'load_standards',
    description: '加载指定行业规范并返回其内容。当用户说"查看建筑规范/加载机械标准"时调用。返回规范的完整规则定义。',
    inputSchema: {
      type: 'object',
      properties: {
        industry: { type: 'string', enum: INDUSTRY_VALUES, description: INDUSTRY_DESC }
      },
      required: ['industry']
    }
  },
  {
    name: 'save_standards',
    description: '保存自定义规范文件。当用户说"保存当前规范/创建自定义规范"时调用。可基于现有规范修改后保存。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '规范名称，如 "my-company-standards"' },
        standards: { type: 'object', description: '规范内容对象，结构同 drafting.json' },
        overwrite: { type: 'boolean', description: '是否覆盖同名文件，默认false' }
      },
      required: ['name', 'standards']
    }
  },
  {
    name: 'compare_standards',
    description: '比较两个规范文件的差异。当用户说"对比建筑和结构规范/比较新旧标准"时调用。返回差异报告。',
    inputSchema: {
      type: 'object',
      properties: {
        standard1: { type: 'string', enum: INDUSTRY_VALUES, description: '第一个行业规范（基准），如 "建筑"' },
        standard2: { type: 'string', enum: INDUSTRY_VALUES, description: '第二个行业规范（对比），如 "结构"' }
      },
      required: ['standard1', 'standard2']
    }
  },
  {
    name: 'check_layer_naming',
    description: '检查图层命名是否符合规范前缀规则。如建筑规范要求 "A-" 前缀，结构要求 "S-" 前缀。当用户说"检查图层命名/图层名是否规范"时调用。',
    inputSchema: {
      type: 'object',
      properties: {
        industry: { type: 'string', enum: INDUSTRY_VALUES, description: INDUSTRY_DESC }
      }
    }
  },
  {
    name: 'check_color_conformity',
    description: '检查图层颜色是否符合ACI规范（1-9号颜色分配规则）。当用户说"检查颜色规范/颜色是否合规"时调用。',
    inputSchema: {
      type: 'object',
      properties: {
        industry: { type: 'string', enum: INDUSTRY_VALUES, description: INDUSTRY_DESC }
      }
    }
  },
  {
    name: 'check_linetype_conformity',
    description: '检查图层线型是否符合规范（如墙体用Continuous，轴线用CENTER）。当用户说"检查线型规范/线型是否合规"时调用。',
    inputSchema: {
      type: 'object',
      properties: {
        industry: { type: 'string', enum: INDUSTRY_VALUES, description: INDUSTRY_DESC }
      }
    }
  },
  {
    name: 'check_lineweight_conformity',
    description: '检查图层线宽是否符合规范（0.00-0.70mm分级）。当用户说"检查线宽规范/线宽是否合规"时调用。',
    inputSchema: {
      type: 'object',
      properties: {
        industry: { type: 'string', enum: INDUSTRY_VALUES, description: INDUSTRY_DESC }
      }
    }
  },
  {
    name: 'check_text_style_conformity',
    description: '检查文字样式是否符合规范（字体、字高、宽度因子）。当用户说"检查文字样式/文字是否规范"时调用。',
    inputSchema: {
      type: 'object',
      properties: {
        industry: { type: 'string', enum: INDUSTRY_VALUES, description: INDUSTRY_DESC }
      }
    }
  },
  {
    name: 'check_dim_style_conformity',
    description: '检查标注样式是否符合规范（箭头、字高、精度）。当用户说"检查标注样式/标注是否规范"时调用。',
    inputSchema: {
      type: 'object',
      properties: {
        industry: { type: 'string', enum: INDUSTRY_VALUES, description: INDUSTRY_DESC }
      }
    }
  },
  {
    name: 'check_file_naming',
    description: '检查DWG文件名是否符合命名规范（项目编码-专业代码-图纸类型-序号）。当用户说"检查文件名/文件命名是否规范"时调用。',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'generate_compliance_report',
    description: '生成完整的规范合规报告，包含所有检查项的详细结果。当用户说"生成规范报告/出合规报告"时调用。支持JSON/HTML格式。',
    inputSchema: {
      type: 'object',
      properties: {
        industry: { type: 'string', enum: INDUSTRY_VALUES, description: INDUSTRY_DESC },
        format: { type: 'string', enum: ['json', 'html', 'text'], description: '报告输出格式，默认 json；html 便于人工阅读，text 便于贴进邮件' },
        outputFile: { type: 'string', description: '输出文件路径（可选，不指定则返回内容）' }
      }
    }
  }
];
