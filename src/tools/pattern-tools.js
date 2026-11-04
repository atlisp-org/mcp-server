// =============================================================================
// pattern-tools.js — 填充图案（@lisp 图案库 835 个 .pat / 855 个图案）
//
// 与图库同一套思路：**素材在服务端**，CAD 端按需下载单个 .pat（通常几 KB），
// 并把它所在目录加进支持路径，`-BHATCH` 才能按名字找到自定义图案。
//
// 检索不放这里：与 agent 同机时由 agent 的 `pattern_search` 读本地索引；
// 这个工具只负责「确保图案可用 + 填充」。
// =============================================================================
export const tools = [
  {
    name: 'pattern_search',
    description:
      '搜索 @lisp 填充图案库（855 个图案：ACAD 标准图案 + 石材/砖/木纹/混凝土/地质等自定义 .pat）。'
      + '支持英文名（AR-CONC）、中文名（木地板）、拼音首字母（mdb）、类别（木材/石材/地质/岩土）。'
      + '返回类别、基间距（pitch）与参考比例；填充时 scale 可省略（hatch_with_pattern 按边界自动取）。'
      + '索引仅 153KB，自动下载缓存。只读。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键字：图案名/中文说明/拼音首字母/类别' },
        category: {
          type: 'string',
          description: '限定类别，如 "木材"、"石材"、"地质/岩土"、"砖/砌体"、"铺装/地面"',
        },
        limit: { type: 'number', description: '返回条数，默认 20' },
      },
      required: [],
    },
  },
  {
    name: 'hatch_with_pattern',
    description:
      '用指定图案填充当前选择集（支持 @lisp 图案库 855 个自定义图案，如 "2x12木地板"、"AR-CONC"）。'
      + '会自动从服务器下载对应 .pat 并加入 CAD 支持路径，再执行填充。'
      + '**scale 可省略**：同时给 pitch（pattern_search 返回的基间距）时，按填充边界最小边长的'
      + '约 1/15 反推比例，避免「填成实心/看不见」；显式传 scale 则以传入值为准。'
      + '当用户说"填充这个区域/用木纹填充/换成混凝土图案"时调用。idempotent——每次创建一个新填充。',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '图案名（pattern_search 返回的名字），如 "AR-CONC"、"2x12木地板"' },
        scale: {
          type: 'number',
          description: '填充比例（图案疏密）。可省略：传 pitch 时按边界自动取；省略且无 pitch 时为 1。',
        },
        pitch: {
          type: 'number',
          description: '图案基间距（pattern_search 返回的 pitch，图案自身坐标单位）。用于按边界自动定比例。',
        },
        angle: { type: 'number', description: '填充角度（度），默认 0' },
        file: {
          type: 'string',
          description: '图案所在的 .pat 文件名（可选）。图案名与文件名可能不同（如 AR-CONC 在 ACAD.PAT 里），由 agent 自动带入。',
        },
      },
      required: ['pattern'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '实际使用的图案名' },
        file: { type: 'string', description: '使用的 .pat 文件' },
        scale: { type: 'number', description: '实际使用的填充比例（autoScale 时为 CAD 端算出的值）' },
        autoScale: { type: 'boolean', description: '是否按填充边界自动取的比例' },
        fetched: { type: 'boolean', description: '是否本次下载了 .pat' },
        handle: { type: 'string', description: '新填充实体句柄（如能取到）' },
      },
      required: ['pattern'],
    },
  },
];
