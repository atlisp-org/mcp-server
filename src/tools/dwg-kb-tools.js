/**
 * 图纸知识库（atlisp-dwg-kb）工具组 —— 只读查询。
 *
 * 与 CAD 工具的分工：本组只查**已入库的历史图纸**（不碰当前打开的图、不改图），
 * 数据来自独立进程 `atlisp-dwg-kb serve`（默认 127.0.0.1:8322）。
 * 找不到图时先用 dwg_kb_query / dwg_kb_search，再用 open_dwg 在 CAD 里打开。
 */
const LIMIT_DESC = '返回条数（默认 20，上限由服务端 1000 截断）';
const OFFSET_DESC = '分页偏移，从 0 开始；下一页取 offset + 本次返回条数';

export const tools = [
  {
    name: 'dwg_kb_health',
    description:
      '查看图纸知识库服务状态（版本、三元组数、是否加载完成）。当用户说"知识库能用吗/图纸库状态"时调用。返回 reachable/version/triples/rdfLoaded；reachable=false 表示服务没启动。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'dwg_kb_stats',
    description:
      '统计图纸库规模：图纸数、项目数、各专业数量、图层/块总量、版本演进链与图号互引数。当用户说"库里有多少图纸/有哪些专业"时调用。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'dwg_kb_search',
    description:
      '在图纸库的图签与图面文字中做关键词全文搜索，返回命中的文字片段与图纸路径。当用户说"哪些图里有会议室/消防水池"时调用。对比 dwg_kb_query 是自然语言/SPARQL 语义查询，本工具是精确关键词。大库上可能耗时 10–20 秒。',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键词，如 "会议室"、"消防水池"' },
        limit: { type: 'integer', description: LIMIT_DESC },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'dwg_kb_query',
    description:
      '自然语言或 SPARQL 查询图纸库（按专业/项目/版本/关联找图）。当用户说"2020 年以后建施的平面图有哪些/找广诚广场的结构图"时调用。mode=sparql 时 question 必须是 SELECT/ASK/CONSTRUCT/DESCRIBE 语句（只读）。大库上可能耗时几十秒。',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '自然语言问题，或 mode=sparql 时的 SPARQL 语句' },
        mode: { type: 'string', enum: ['nl', 'sparql'], description: '查询模式，默认 nl（自然语言启发式）；sparql 只接受只读查询' },
      },
      required: ['question'],
    },
  },
  {
    name: 'dwg_kb_list_drawings',
    description:
      '按专业/项目/图层分页列出图纸（含 id、名称、专业、项目、磁盘路径、图层）。当用户说"列出建筑专业的图/看看这个项目有哪些图/哪些图用了 WALL 图层"时调用。传 layer 时等价于图层反查（返回值额外带 matched_layers）。可用返回的 id 继续调 dwg_kb_drawing_history / dwg_kb_cross_ref。',
    inputSchema: {
      type: 'object',
      properties: {
        discipline: { type: 'string', description: '专业过滤，如 "Architecture"、"Structure"、"HVAC"、"Electrical"；也可用中文，服务端按层名打分' },
        project: { type: 'string', description: '项目名过滤，如 "广诚商务广场"' },
        layer: { type: 'string', description: '图层名过滤（子串，不区分大小写）；也可直接用 dwg_kb_layer_drawings' },
        limit: { type: 'integer', description: LIMIT_DESC },
        offset: { type: 'integer', description: OFFSET_DESC },
      },
    },
  },
  {
    name: 'dwg_kb_projects',
    description:
      '列出图纸库中的项目（分页）。当用户说"有哪些项目/这个项目有多少张图"时调用。name 支持模糊过滤；拿到项目名后可传给 dwg_kb_list_drawings 的 project 参数继续下钻。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '项目名模糊过滤（可选），如 "广诚"' },
        limit: { type: 'integer', description: LIMIT_DESC },
        offset: { type: 'integer', description: OFFSET_DESC },
      },
    },
  },
  {
    name: 'dwg_kb_layers',
    description:
      '跨图纸统计图层清单（名称与使用次数）。当用户说"库里都用过哪些图层/图层规范统一吗"时调用。只看历史库，不改当前图纸。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: LIMIT_DESC },
        offset: { type: 'integer', description: OFFSET_DESC },
      },
    },
  },
  {
    name: 'dwg_kb_blocks',
    description:
      '跨图纸统计块清单（块名与使用次数）。当用户说"哪些块用得最多/有没有重复块"时调用。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: LIMIT_DESC },
        offset: { type: 'integer', description: OFFSET_DESC },
      },
    },
  },
  {
    name: 'dwg_kb_review_queue',
    description:
      '待复核队列：解析风险高/代理对象多/双轨校验冲突的图纸清单（含严重度与原因）。当用户说"哪些图纸需要人工复核/哪些图有问题"时调用。本工具只列清单，不自动处理。首次调用可能耗时 40–60 秒（扫描整个提取目录）。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: '返回条数（默认 50，只返回队列前 N 条）' },
      },
    },
  },
  {
    name: 'dwg_kb_drawing_history',
    description:
      '查询单张图纸的版本演进链（同一图纸的历史版本、审查轮次）。当用户说"这张图改过几版/上一版是什么"时调用。drawing 传图纸 id 或名称。',
    inputSchema: {
      type: 'object',
      properties: {
        drawing: { type: 'string', description: '图纸 id（如 "10_柱状图_7e3ce8e0a5"）或名称（支持模糊）' },
      },
      required: ['drawing'],
    },
  },
  {
    name: 'dwg_kb_cross_ref',
    description:
      '查询单张图纸被哪些图引用/引用了哪些图（图号互引，如"建施-03"、"3/A-501"）。当用户说"这张图牵扯到哪些图/图号互引关系"时调用。',
    inputSchema: {
      type: 'object',
      properties: {
        drawing: { type: 'string', description: '图纸 id 或名称（支持模糊）' },
      },
      required: ['drawing'],
    },
  },
  {
    name: 'dwg_kb_layer_drawings',
    description:
      '反查「哪些图纸用过某个图层」——图层名到图纸（dwg_kb_layers 是反方向：图层清单+使用次数）。当用户说"哪些图还有 A-OLD 图层/这个图层规范覆盖了哪些图/哪张图用了防火门图层"时调用。默认按子串匹配（不区分大小写），返回 matched_layers 说明实际命中的层名，不做猜测。',
    inputSchema: {
      type: 'object',
      properties: {
        layer: { type: 'string', description: '图层名，如 "A-WALL"、"防火"（子串匹配；长名图层常带 XData 前缀，子串才查得到）' },
        exact: { type: 'boolean', description: 'true = 整名匹配（不区分大小写）；默认 false 子串匹配' },
        discipline: { type: 'string', description: '专业过滤，如 "Architecture"' },
        project: { type: 'string', description: '项目名过滤（模糊）' },
        limit: { type: 'integer', description: LIMIT_DESC },
        offset: { type: 'integer', description: OFFSET_DESC },
      },
      required: ['layer'],
    },
  },
  {
    name: 'dwg_kb_verify_drawing',
    description:
      '对单张历史图纸做双轨校验：VLM 读图声称的房名/图名/专业/图号逐条与 ezdxf 硬数据裁决，冲突标 corrected 并带 evidence。当用户说"这张图审一下/核对图名和图号/这张图有没有问题"时调用。报告会写入知识库并挂到 RDF（cad:has_verification），属于写操作但不改图。大图可能 30–60 秒；超过客户端超时用 background=true 再轮询 dwg_kb_job。',
    inputSchema: {
      type: 'object',
      properties: {
        drawing: { type: 'string', description: '图纸 id 或名称（支持模糊）' },
        question: { type: 'string', description: '可选：只针对某个问题校验，如 "图名与图号是否一致"' },
        background: { type: 'boolean', description: 'true = 异步任务，立即返回 job_id，用 dwg_kb_job 查询进度' },
      },
      required: ['drawing'],
    },
  },
  {
    name: 'dwg_kb_render_drawing',
    description:
      '把历史图纸渲染成 PNG/SVG 并返回落盘路径与 URL（图片不进上下文）。当用户说"把这张历史图调出来看看/看看上一版长什么样"时调用；拿到 path 后可交给多模态分析，或配合 dwg_kb_drawing_history 做版本视觉对比。大图用 background=true。',
    inputSchema: {
      type: 'object',
      properties: {
        drawing: { type: 'string', description: '图纸 id 或名称（支持模糊）' },
        format: { type: 'string', enum: ['png', 'svg'], description: '输出格式，默认 png' },
        background: { type: 'boolean', description: 'true = 异步任务，立即返回 job_id，用 dwg_kb_job 查询进度' },
      },
      required: ['drawing'],
    },
  },
  {
    name: 'dwg_kb_job',
    description:
      '查询 dwg_kb_verify_drawing / dwg_kb_render_drawing 用 background=true 启动的异步任务状态（queued/running/done/error + 结果）。当上一步返回 status=started 时调用。',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: '启动异步任务时返回的 job_id' },
      },
      required: ['job_id'],
    },
  },
  {
    name: 'dwg_kb_project_overview',
    description:
      '项目级概览：图纸总数、专业分布、审查轮次（含轮次日期与每轮图纸数）。当用户说"这个项目有多少张图/审了几轮/项目整体情况"时调用。项目名支持模糊匹配。',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: '项目名（模糊），如 "广诚商务广场"' },
      },
      required: ['project'],
    },
  },
  {
    name: 'dwg_kb_cross_ref_graph',
    description:
      '跨专业关联全景（不是单张图的互引，那是 dwg_kb_cross_ref）：bridges=桥接图清单；matrix=专业协调矩阵（两两引用次数）；shared_layers=被多个专业共用的图层（协调风险点）。当用户说"建筑和暖通哪些图有关联/哪些图层跨专业共用"时调用。',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['shared_layers', 'bridges', 'matrix'],
          description: 'shared_layers（默认）| bridges | matrix',
        },
      },
    },
  },
];
