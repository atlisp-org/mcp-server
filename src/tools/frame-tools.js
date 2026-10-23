// =============================================================================
// frame-tools.js — 图框识别工具（list_frames）
//
// 与资源 atlisp://dwg/frames 共用 getFrames()（resource-snapshot.js），
// 识别规则由 lisp-code-builders.js 的 buildFramesCode 生成的自包含 LISP 执行。
// 契约字段（source/blockName/attributes/fields/alternatives/sources）由 agent 侧消费，
// **不要改字段名**（可加，不可改名）。
// =============================================================================
import { FRAME_STANDARDS } from '../handlers/frame-standards.js';

const ALTERNATIVE_SCHEMA = {
  type: 'object',
  properties: {
    paperSize: { type: ['string', 'null'], description: '另一种解读的图幅：A4/A3/A2/A1/A0' },
    elongation: { type: 'string', description: '另一种解读的加长标记（标准幅面为空字符串）' },
    scale: { type: ['number', 'null'], description: '另一种解读的比例分母（如 200 表示 1:200）' },
  },
  required: ['paperSize', 'elongation', 'scale'],
};

const FRAME_RECORD_SCHEMA = {
  type: 'object',
  properties: {
    handle: { type: 'string', description: '图框句柄（属性块通道是 INSERT 的句柄）' },
    layer: { type: 'string', description: '图框所在图层' },
    bbox: {
      type: 'array',
      items: { type: 'number' },
      description: '包围盒 [x1,y1,x2,y2]（vla-getboundingbox，WCS；属性块含属性文字的范围）',
    },
    width: { type: 'number', description: '包围盒宽度（图形单位，不含比例换算）' },
    height: { type: 'number', description: '包围盒高度（图形单位）' },
    ratio: { type: 'number', description: '长边/短边，保留 4 位小数' },
    paperSize: { type: ['string', 'null'], description: '图幅：A4/A3/A2/A1/A0' },
    elongation: {
      type: 'string',
      description: '加长标记：标准幅面为空字符串，加长幅面为 +1/4、+1/2、+3/4、+1、+5/4、+3/2',
    },
    scale: { type: ['number', 'null'], description: '出图比例分母（如 100 表示 1:100）' },
    source: {
      type: 'string',
      enum: ['attr-block', 'block', 'polyline'],
      description: '识别通道：attr-block=属性块（图签键值，权威）；block=非属性块（lib 路径用 frame:ref-box + frame:match-all + 图签文字指纹判定）；'
        + 'polyline=闭合矩形多段线（几何推测）',
    },
    blockName: { type: ['string', 'null'], description: '块名（attr-block/block 通道为块名，几何通道为 null）' },
    attributes: {
      type: ['object', 'null'],
      additionalProperties: true,
      description: '属性块原始 tag→value 对象（完整保留，不做猜测；非属性块与几何通道为 null）',
    },
    fields: {
      type: ['object', 'null'],
      additionalProperties: true,
      description: '属性归一化后的语义字段（只含命中项），如 {"title":"...","number":"...","scale":"1:200"}；'
        + 'lib 路径会用图签散文字（frame:title-fields）补属性没给出的键；真实出图比例应以此为准',
    },
    alternatives: {
      type: 'array',
      items: ALTERNATIVE_SCHEMA,
      description: '同一矩形在几何上等价、无法区分时的其它解读（按图幅面积降序，最多 4 项；'
        + '首项已写入 paperSize/elongation/scale，本字段是其余项）',
    },
    inner: { type: 'boolean', description: '是否为被其它图框包含的内框（includeInner=true 时才会出现在结果里）' },
  },
  required: ['handle', 'layer', 'width', 'height', 'ratio', 'paperSize', 'elongation', 'scale', 'source', 'inner'],
};

const UNMATCHED_RECORD_SCHEMA = {
  type: 'object',
  properties: {
    handle: { type: 'string', description: '候选句柄（多段线或属性块）' },
    layer: { type: 'string', description: '候选所在图层' },
    bbox: { type: 'array', items: { type: 'number' }, description: '包围盒 [x1,y1,x2,y2]' },
    width: { type: 'number', description: '包围盒宽度' },
    height: { type: 'number', description: '包围盒高度' },
    ratio: { type: 'number', description: '长边/短边，保留 4 位小数（与比例表比对可看出差多少）' },
    source: { type: 'string', enum: ['attr-block', 'block', 'polyline'], description: '候选来源通道' },
    blockName: { type: ['string', 'null'], description: '块名（多段线为 null）' },
  },
  required: ['handle', 'layer', 'width', 'height', 'ratio'],
};

export const tools = [
  {
    name: 'list_frames',
    description: `识别图纸中的标准图框，回答「这张图有几张图纸、图幅与比例各是多少」（与资源 atlisp://dwg/frames 同源）。
CAD 端装好 @lisp lib 时走 lib 路径（判定核心用 frame:*，响应 lib=true），否则自动回落自包含实现（lib=false），语义一致。
原理：三条通道并行识别——
① 属性块通道（优先，source="attr-block"）：INSERT 且带属性（vla-get-HasAttributes）的参照，
bbox 用 vla-getboundingbox（失败时 lib 路径回退 frame:ref-box），比例优先从属性（比例/出图比例/SCALE，如 "1:200"）解析，
图幅优先几何匹配、退化时按块名（A0~A4）兜底；
attributes 是原始 tag→value，fields 是归一化语义字段（title/number/scale/date/designer/checker/project/discipline）。
② 非属性块通道（source="block"，仅 lib 路径）：无属性 INSERT 按块名去重后用 frame:ref-box 包围盒 + frame:match-all 判定，
准入要求短边≥2000 或块内含图签文字（frame:title-block-p），挡住尺寸偶然命中的符号块。
③ 几何通道（source="polyline"）：闭合且 4 顶点的多段线，按宽高比命中加长比例表（${FRAME_STANDARDS.ratios.join('/')}，对应 ${FRAME_STANDARDS.marks.filter(Boolean).join('/')}）、
短边命中「图幅短边(${FRAME_STANDARDS.heights.join(' ')}，A4→A0) × 比例表」→ 得出 paperSize/elongation/scale。
lib 路径还会用 frame:title-fields 把框内散文字配对成图签字段，补 attributes 没给出的键。
同一位置多通道都命中时按 attr-block > block > polyline 保留一条。
几何只能给物理尺寸解读：A1@1:100 与 A3@1:200 是同一个矩形，无法区分，此时首项写 paperSize/scale，其余进 alternatives；
真实出图比例应以图签属性 fields.scale 或图内比例文字为准，不要用 alternatives 去猜。
默认丢弃被其它图框包含的内框（标题栏内框会被自动排除，只留外框）；配不上标准表的候选放在 unmatched
（按面积降序最多 200 条），便于人工复核"很像但没命中"的加长图幅——默认 tolRatio=0.0035 已可识别约 0.1% 偏差的加长图幅（如 336400×118800）。
返回 frames 按面积降序、默认 limit=500（含 total/nextOffset 便于分页），sources 给出三条通道各自的条数。`,
    inputSchema: {
      type: 'object',
      properties: {
        layer: {
          type: 'string',
          description: '限定图框所在图层，如 "PUB_TITLE"；可用英文逗号分隔多个图层（内部按 <OR> 组合），不传则扫描全图',
        },
        minSize: {
          type: 'number',
          description: '最小短边长度（图形单位）：短边小于该值的候选直接忽略，用于过滤图内小矩形噪声（默认 0 = 不过滤）',
        },
        scales: {
          type: 'array',
          items: { type: 'number' },
          description: `比例表（比例分母），默认 ${FRAME_STANDARDS.defaultScales.join('/')}`,
        },
        tolRatio: {
          type: 'number',
          description: `宽高比匹配绝对容差（默认 0.0035，可识别约 0.1% 偏差的加长图幅，如 336400×118800）`,
        },
        includeInner: { type: 'boolean', description: 'true 则保留被包含的内框并标 inner=true（默认 false，只留外框）' },
        limit: { type: 'number', description: 'frames 每页条数（默认 500，0 = 不分页一次返回全部）' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        connected: { type: 'boolean', description: 'CAD 是否已连接' },
        error: { type: 'string', description: '失败原因（仅出错时出现）' },
        lib: { type: 'boolean', description: '本次识别是否走了 CAD 端 @lisp lib（frame:*）；false 表示回落自包含内联实现' },
        total: { type: 'number', description: '识别到的图框总数（不受 offset/limit 影响）' },
        offset: { type: 'number', description: '本次分页起始下标（frames 按面积降序）' },
        limit: { type: 'number', description: '本次分页条数上限（0 表示不分页）' },
        nextOffset: { type: 'number', description: '下一页下标；>= total 表示没有下一页' },
        frameCount: { type: 'number', description: '本次返回的图框条数' },
        unmatchedCount: { type: 'number', description: '本次返回的未匹配候选条数' },
        sources: {
          type: 'object',
          properties: {
            'attr-block': { type: 'number', description: '属性块通道识别到的图框数（本页）' },
            block: { type: 'number', description: '非属性块通道识别到的图框数（本页，仅 lib 路径）' },
            polyline: { type: 'number', description: '几何通道识别到的图框数（本页）' },
          },
          required: ['attr-block', 'block', 'polyline'],
          description: '本页 frames 的来源分布（三项之和 = frameCount）',
        },
        frames: { type: 'array', items: FRAME_RECORD_SCHEMA, description: '标准图框列表（默认只含外框）' },
        unmatched: {
          type: 'array',
          items: UNMATCHED_RECORD_SCHEMA,
          description: '像图框但配不上标准表的候选（按面积降序，最多 200 条）',
        },
      },
      required: ['connected', 'total', 'offset', 'limit', 'nextOffset', 'frameCount', 'unmatchedCount', 'sources', 'frames', 'unmatched'],
    },
  },
];
