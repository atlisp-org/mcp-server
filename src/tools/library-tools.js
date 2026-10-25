// =============================================================================
// library-tools.js — @lisp 在线图库（atlisp.cn/dw/library，2.4 万个专业符号）
//
// 为什么值得单独一组工具：AI 画图能画线、画矩形，但画不出「一扇 900 宽的
// 平开门」「一棵银杏」「一个法兰止回阀」。图库把这件事补上——检索 → 插入，
// 符号是真实设计院在用的，不是模型臆造的几何。
//
// 数据源：`server/scripts/library/build_index.py` 生成的
// `~/www/dw/library/index/library-index.json`（本地可读，不依赖网络）。
// 插入时才下载 dwg（走 atlisp.cn 静态目录），并自动修正：
//   * 插入基点偏移（图库里 13.7% 的符号基点离几何很远，直接插会跑到屏幕外）
//   * 单位换算（48.8% 的符号 $INSUNITS=0，按当前图纸单位兜底）
// =============================================================================

export const tools = [
  {
    name: 'library_search',
    description:
      '搜索 @lisp 在线图库（24699 个专业符号：建筑/结构/给排水/暖通/电气/室内/园林/绿化/机械/图框/图例）。支持中文名称、拼音、拼音首字母（如 "dsm" → 单扇门）、规格（"M6x40"）。当用户要"放个门/窗/家具/苗木/阀门/标准件/图框"或问"图库里有没有…"时调用。只读，不修改图纸。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键字：中文名/拼音/拼音首字母/规格。例："平开门"、"dsm"、"M6x40"、"银杏"' },
        category: { type: 'string', description: '限定专业或子目录，如 "室内"、"电气/元件库"、"图框库"。可选。' },
        limit: { type: 'number', description: '返回条数，默认 20，最大 100' },
      },
      required: ['query'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: '命中总数（可能大于返回条数）' },
        items: {
          type: 'array',
          description: '符号列表',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '符号 id，插入时传给 library_insert' },
              name: { type: 'string' },
              category: { type: 'string' },
              std: { type: 'string', description: '关联标准号（如有）' },
              size: { type: 'array', items: { type: 'number' }, description: '包围盒尺寸 [宽,高]（符号单位）' },
              units: { type: 'number', description: '$INSUNITS（0=未定义）' },
              png: { type: 'string', description: '缩略图 URL，可用视觉核对' },
            },
          },
        },
      },
      required: ['count', 'items'],
    },
  },
  {
    name: 'library_insert',
    description:
      '从 @lisp 图库把符号插入当前图纸。会下载 dwg、自动修正插入基点偏移、按图纸单位换算比例。当用户说"插个门/放棵树/加个标准件/套图框"且已通过 library_search 选好符号时调用。idempotent——每次调用插入一个新的块参照。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '符号 id（library_search 返回的 id 原样传入）' },
        point: { type: 'string', description: '插入点，如 "1000,2000" 或 "1000,2000,0"' },
        scale: { type: 'number', description: '额外缩放，默认 1（会再乘单位换算系数）' },
        rotation: { type: 'number', description: '旋转角度（度），默认 0' },
        align: {
          type: 'string',
          enum: ['auto', 'base', 'center', 'bottom-left'],
          description: '对齐方式。auto（默认）=基点偏移过大时自动用几何中心对齐，否则尊重图库原始基点；base=完全按图库基点；center=几何中心对准插入点；bottom-left=左下角对准插入点（图框常用）',
        },
      },
      required: ['id', 'point'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        handle: { type: 'string', description: '新块参照的句柄' },
        blockName: { type: 'string', description: '块名' },
        scale: { type: 'number', description: '实际使用的缩放（含单位换算）' },
        corrected: { type: 'boolean', description: '是否修正了基点偏移' },
      },
      required: ['blockName'],
    },
  },
  {
    name: 'library_categories',
    description: '列出 @lisp 图库的专业与子目录及符号数量。当用户问"图库里有什么/有哪些专业/某专业有多少符号"时调用。只读。',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: '只看某个专业的子目录，如 "电气"。可选。' },
      },
    },
  },
  {
    name: 'library_info',
    description: '查一个图库符号的详细信息（尺寸、单位、基点偏移、标准号、缩略图、是否含代理对象）。当需要确认"这个符号多大/什么单位/能不能用"时调用。只读。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '符号 id（library_search 返回的 id，原样传入）' },
      },
      required: ['id'],
    },
  },
];
