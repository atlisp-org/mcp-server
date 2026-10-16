// =============================================================================
// resource-snapshot.js — CAD 快照与图纸分析资源实现
//
// 从 resource-handlers.js 按域拆出（非 *-handlers.js 命名，不触发 handler-loader
// 自动发现，避免重复注册）。提供：
//   - getCadSnapshot        轻量 CAD 状态快照（listResources/readResource 数据源）
//   - getDwgContext         当前图纸上下文 (atlisp://dwg/context)
//   - getDrawingAnalysis    图纸深度分析 (atlisp://dwg/analysis)
//   - getFrames             图框识别 (atlisp://dwg/frames / list_frames)
//   - checkDrawingStandards 制图规范检查 (atlisp://dwg/standards/check)
// 对外由 resource-handlers.js 的 readResource 调用，不直接注册为 MCP handler。
// =============================================================================
import { cad } from '../cad.js';
import { getCached, setCache } from './resource-cache.js';
import { log } from '../logger.js';
import { parseLispRecursive, escapeLispString } from '../handler-utils.js';
import { createError, ERROR_CODES } from '../errors.js';
import { getDraftingStandards } from './standards-readers.js';
import { buildDrawingAnalysisCode, buildFramesCode, FRAME_STANDARDS } from './lisp-code-builders.js';

// =============================================================================
// Live CAD Snapshot (for listResources enrichment)
// =============================================================================

/**
 * Fetches a lightweight snapshot of current CAD state.
 * Returns a flat object with entity count, layer names, DWG info, etc.
 */
export async function getDwgContext() {
  const snapshot = await getCadSnapshot();
  if (!snapshot || !snapshot.cadConnected) {
    return { connected: false, message: 'CAD 未连接' };
  }
  try {
    const code = `(progn
  (vl-load-com)
  (setq ctx nil)
  (setq ctx (cons (cons "layout" (getvar "ctab")) ctx))
  (setq ctx (cons (cons "ucs" (getvar "ucsname")) ctx))
  (setq ctx (cons (cons "insunits" (getvar "insunits")) ctx))
  (setq ctx (cons (cons "ltscale" (getvar "ltscale")) ctx))
  (setq ctx (cons (cons "limmin" (vl-princ-to-string (getvar "limmin"))) ctx))
  (setq ctx (cons (cons "limmax" (vl-princ-to-string (getvar "limmax"))) ctx))
  (setq ctx (cons (cons "extmin" (vl-princ-to-string (getvar "extmin"))) ctx))
  (setq ctx (cons (cons "extmax" (vl-princ-to-string (getvar "extmax"))) ctx))
  (vl-prin1-to-string ctx))`;
    const resultStr = await cad.sendCommandWithResult(code);
    const parsed = parseLispRecursive(resultStr);
    return {
      connected: true,
      docName: snapshot.dwgName,
      docPath: snapshot.dwgPath,
      platform: snapshot.platform,
      entityCount: snapshot.entityCount,
      layerCount: snapshot.layerCount,
      layerNames: snapshot.layerNames,
      extra: parsed && Array.isArray(parsed) ? Object.fromEntries(parsed) : {},
    };
  } catch {
    return {
      connected: true,
      docName: snapshot.dwgName,
      docPath: snapshot.dwgPath,
      platform: snapshot.platform,
      entityCount: snapshot.entityCount,
      layerCount: snapshot.layerCount,
      layerNames: snapshot.layerNames,
    };
  }
}

// --- atlisp://dwg/analysis 结果归一化 -------------------------------------------------
// LISP 侧的 alist/明细经 parseLispRecursive 后可能是两种形态，都需要兼容：
//   a) 规范结构（新 LISP 用 (list "key" value) 组装）：[[k1, v1], [k2, v2], ...]
//   b) 历史结构（旧 LISP 用 (cons "key" value) 压平）：["k1", v1, "k2", v2, ...]
// 历史结构之所以出现，是因为旧代码用 (cons "key" value) 组装条目，当 value 是列表时
// 条目会退化成 ("key" a b c)，服务端取 pair[1] 只能拿到第 1 个元素（直方图被截断）。
// 这里两种都解析：既产出规范的二元组结构，也能消费历史服务端返回的压平数据。
function normalizeRecord(value) {
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return {};
  if (value.every(el => Array.isArray(el) && el.length >= 2)) {
    const obj = {};
    for (const pair of value) obj[String(pair[0])] = pair[1];
    return obj;
  }
  if (value.every(el => el === null || ['string', 'number', 'boolean'].includes(typeof el))) {
    const obj = {};
    for (let i = 0; i + 1 < value.length; i += 2) obj[String(value[i])] = value[i + 1];
    return obj;
  }
  return null;
}

function normalizeRecords(value) {
  if (!Array.isArray(value)) return [];
  const records = value.map(normalizeRecord).filter(v => v && Object.keys(v).length > 0);
  // 历史结构在"只有 1 条记录"时会整体退化成单条平铺键值列表（如
  // ("blockUsage" ("name" "A1" "count" 7))），再兜一次单记录解析。
  if (records.length === 0) {
    const single = normalizeRecord(value);
    if (single && Object.keys(single).length > 0) return [single];
  }
  return records;
}

// 类型直方图：((POLYLINE . 419) ...) → [{type, count}]，按数量降序
function normalizeHistogram(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const pair of value) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    out.push({
      type: String(pair[0]),
      count: typeof pair[1] === 'number' ? pair[1] : parseInt(pair[1], 10) || 0,
    });
  }
  return out.sort((a, b) => b.count - a.count);
}

function toCount(value) {
  if (typeof value === 'number') return value;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? 0 : n;
}

// 历史 LISP 输出的是 :vlax-true/:vlax-false 符号字面量，归一成布尔
function toBool(value) {
  return value === true || value === 'true' || value === 1 || value === ':vlax-true';
}

function normalizeBlockUsage(value) {
  return normalizeRecords(value).map(b => ({
    ...b,
    count: toCount(b.count),
    isDynamic: toBool(b.isDynamic),
  }));
}

function normalizeBlockDefs(value) {
  return normalizeRecords(value).map(b => ({
    ...b,
    entityCount: toCount(b.entityCount),
    isDynamic: toBool(b.isDynamic),
  }));
}

/**
 * 图纸综合分析（atlisp://dwg/analysis）。
 *
 * type=summary（默认）：只回计数/直方图（实体类型统计、图层数量与状态、文字数量与字高区间、
 *   块引用统计 blockUsage 前 50 条、关键系统变量），响应体小，适合 Agent 快速建立图纸画像。
 * type=detailed：在 summary 基础上追加图层明细（layers）、块定义明细（blockDefs），
 *   并且 blockUsage 不再截断（便于核对只引用 1 次的低频块）。
 */
export async function getDrawingAnalysis(params = {}) {
  const snapshot = await getCadSnapshot();
  if (!snapshot || !snapshot.cadConnected) {
    return { connected: false, error: 'CAD 未连接' };
  }

  // 未知取值一律回落 summary，避免调用方拼错参数时拿到 543 KB 级的大响应
  const type = String(params?.type || 'summary').toLowerCase() === 'detailed' ? 'detailed' : 'summary';

  try {
    const resultStr = await cad.sendCommandWithResult(buildDrawingAnalysisCode(type));
    const parsed = parseLispRecursive(resultStr);
    if (!parsed || !Array.isArray(parsed)) {
      return { connected: true, error: '分析结果解析失败' };
    }

    const raw = {};
    for (const pair of parsed) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      // pair.length === 2：规范二元对。大于 2：历史 (cons "key" list) 造成的多元素条目，
      // 把第 2 项起的整体当作值，避免直方图只剩 1 条。
      raw[String(pair[0])] = pair.length === 2 ? pair[1] : pair.slice(1);
    }

    const analysis = {
      connected: true,
      type,
      dwgName: snapshot.dwgName ?? null,
      dwgPath: snapshot.dwgPath ?? null,
      platform: snapshot.platform ?? null,
      entityCount: toCount(raw.entityCount),
      entityByType: normalizeHistogram(raw.entityByType),
      layerCount: toCount(raw.layerCount),
      layerState: normalizeRecord(raw.layerState),
      textCount: toCount(raw.textCount),
      textHeights: normalizeRecord(raw.textHeights),
      blockRefCount: toCount(raw.blockRefCount),
      blockCount: toCount(raw.blockCount),
      blockUsage: normalizeBlockUsage(raw.blockUsage),
      sysvars: normalizeRecord(raw.sysvars) || {},
    };

    if (type === 'detailed') {
      analysis.layers = normalizeRecords(raw.layers);
      analysis.blockDefCount = toCount(raw.blockDefCount);
      analysis.blockDefs = normalizeBlockDefs(raw.blockDefs);
    }

    return analysis;
  } catch (e) {
    log(`getDrawingAnalysis error: ${e.message}`);
    return { connected: true, error: e.message };
  }
}

// --- atlisp://dwg/frames 图框识别归一化 ------------------------------------------------
// LISP 侧（buildFramesCode）返回 (("total" n) ("frames" ((("handle" h) ...) ...)) ...)，
// 经 parseLispRecursive 后是 [[k, v], ...]；这里按契约字段名归一化并做类型收敛：
//   frame     → handle/layer/bbox/width/height/ratio/paperSize/elongation/scale/inner
//   unmatched → handle/layer/bbox/width/height/ratio
// 契约由 agent 侧按字段名消费，**不要改字段名**（可加，不可改名）。

// frames 分页默认值：图框通常只有几十个，500 实际等于全量；与契约示例中的 limit=500 一致。
const FRAMES_DEFAULT_LIMIT = 500;

// 几何歧义解读上限：A1@1:100 与 A3@1:200 是同一个矩形，几何无法区分；把其余解读一并返回，
// 但最多 4 项（再多已无实际意义，且撑大响应）。
const FRAME_MAX_ALTERNATIVES = 4;

// 比例统一保留 4 位小数（真机实测 r=2.1228956… → 2.1229，与人工核对值一致）。
function roundRatio(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

function toNumber(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeBbox(value) {
  if (!Array.isArray(value) || value.length < 4) return null;
  return value.slice(0, 4).map(v => toNumber(v, 0));
}

// 记录取值：兼容 LISP 原始二元组数组（[["handle","A1"], ...]，单测/直连用）
// 与 normalizeRecords() 已转好的普通对象（正常管道走这条；normalizeRecords 会先把
// 每条记录转成对象，所以这里不能只认数组形态，否则 frames/unmatched 会被整段过滤掉）。
function recordToObject(value) {
  if (Array.isArray(value)) return normalizeRecord(value);
  if (value && typeof value === 'object') return value;
  return null;
}

/**
 * 单条 frame 记录归一化（导出供单测直接验证，避免测试只能依赖整链路）。
 * paperSize/scale 理论上必有（只有命中标准表才会进 frames），缺失时给 null 而不是丢掉字段，
 * 保证 structuredContent 与 outputSchema 声明的必填字段一致。
 *
 * source/blockName/attributes/fields/alternatives 是属性块通道新增字段（契约，勿改名）：
 *  - source: "attr-block"（属性块）| "polyline"（几何）
 *  - blockName: 属性块块名（几何通道为 null）
 *  - attributes: 原始 tag→value 对象（完整保留，不做猜测）
 *  - fields: 归一化语义字段（只含命中项，别名表见 frame-aliases.js）
 *  - alternatives: 其余几何一致解读（最多 4 项；几何给的是物理尺寸解读，真实比例以 fields.scale 为准）
 */
export function normalizeFrameRecord(value) {
  const obj = recordToObject(value);
  if (!obj) return null;
  return {
    handle: obj.handle === null || obj.handle === undefined ? '' : String(obj.handle),
    layer: obj.layer === null || obj.layer === undefined ? '' : String(obj.layer),
    bbox: normalizeBbox(obj.bbox),
    width: toNumber(obj.width),
    height: toNumber(obj.height),
    ratio: roundRatio(obj.ratio),
    paperSize: obj.paperSize === null || obj.paperSize === undefined ? null : String(obj.paperSize),
    // 标准图幅（不加长）的 elongation 是空字符串，**保留空串**，不要转成 null
    elongation: obj.elongation === null || obj.elongation === undefined ? '' : String(obj.elongation),
    scale: obj.scale === null || obj.scale === undefined ? null : toCount(obj.scale),
    source: normalizeSource(obj.source),
    blockName: obj.blockName === null || obj.blockName === undefined ? null : String(obj.blockName),
    attributes: normalizeAttrMap(obj.attributes),
    fields: normalizeAttrMap(obj.fields),
    alternatives: normalizeAlternatives(obj.alternatives),
    inner: toBool(obj.inner),
  };
}

// 来源归一：只认 "attr-block"，其余（含历史记录缺字段）都当几何通道 "polyline"
function normalizeSource(value) {
  return String(value ?? '') === 'attr-block' ? 'attr-block' : 'polyline';
}

// tag→value alist（或 fields 的 语义字段→值 alist）→ 普通对象；空 → null
function normalizeAttrMap(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  // 单个 (tag . value) 对会被解析成 ["tag", "value"]，与「只有 1 条的 alist」同形，
  // 这里都兜住（服务端对 1 条记录会退化成二元组）。
  const pairs = (value.length === 2 && !Array.isArray(value[0])) ? [value] : value;
  const obj = {};
  for (const pair of pairs) {
    if (Array.isArray(pair) && pair.length >= 2 && pair[0] !== null && pair[0] !== undefined) {
      obj[String(pair[0])] = pair[1];
    }
  }
  return Object.keys(obj).length > 0 ? obj : null;
}

// 几何歧义解读 [(paperSize, elongation, scale)] → 对象数组，最多 4 项
function normalizeAlternatives(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (!Array.isArray(item) || item.length < 3) continue;
    out.push({
      paperSize: item[0] === null || item[0] === undefined ? null : String(item[0]),
      elongation: item[1] === null || item[1] === undefined ? '' : String(item[1]),
      scale: item[2] === null || item[2] === undefined ? null : toCount(item[2]),
    });
    if (out.length >= FRAME_MAX_ALTERNATIVES) break;
  }
  return out;
}

export function normalizeUnmatchedRecord(value) {
  const obj = recordToObject(value);
  if (!obj) return null;
  return {
    handle: obj.handle === null || obj.handle === undefined ? '' : String(obj.handle),
    layer: obj.layer === null || obj.layer === undefined ? '' : String(obj.layer),
    bbox: normalizeBbox(obj.bbox),
    width: toNumber(obj.width),
    height: toNumber(obj.height),
    ratio: roundRatio(obj.ratio),
    // 未命中候选也标来源，便于人工复核「是属性块还是多段线」
    source: normalizeSource(obj.source),
    blockName: obj.blockName === null || obj.blockName === undefined ? null : String(obj.blockName),
  };
}

// LISP 返回的顶层 alist：[[k, v], ...]；同时兼容历史压平结构 ["k", v, "k", v, ...]。
function payloadToObject(parsed) {
  const obj = {};
  for (const pair of parsed) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    // pair.length > 2 说明 value 是列表且被 (cons "k" list) 压平过（历史写法），
    // 第 2 项起整体才是值，否则 frames/unmatched 数组会被截成第 1 条。
    obj[String(pair[0])] = pair.length === 2 ? pair[1] : pair.slice(1);
  }
  return obj;
}

/**
 * 把 LISP 输出（parseLispRecursive 产物）归一化成契约响应。
 * 导出以便单测覆盖「规范结构 / 压平结构 / 空结果 / 缺字段」四类输入。
 *
 * @param {unknown} parsed parseLispRecursive 的结果
 * @param {{offset:number, limit:number}} options 生效的 offset/limit（LISP 已切片，这里只回填）
 */
export function normalizeFramesPayload(parsed, options = {}) {
  const offset = toCount(options.offset);
  const limit = toCount(options.limit);
  const raw = Array.isArray(parsed) ? payloadToObject(parsed) : {};
  const frames = normalizeRecords(raw.frames).map(normalizeFrameRecord).filter(Boolean);
  const unmatched = normalizeRecords(raw.unmatched).map(normalizeUnmatchedRecord).filter(Boolean);
  // total 是**全量** frame 数（不受 offset/limit 影响，LISP 侧切片前统计），
  // 便于调用方断言分页收敛；LISP 缺字段时退回本页条数。
  const total = raw.total === undefined ? frames.length : toCount(raw.total);
  // sources 统计**本页** frames 的来源分布（与 frameCount 同口径）；
  // 属性块通道优先，二者之和恒等于 frames.length。
  const sources = { 'attr-block': 0, polyline: 0 };
  for (const f of frames) sources[f.source] += 1;
  return {
    total,
    offset,
    limit,
    // nextOffset 是下一页的绝对下标（= offset + 本页条数）；>= total 表示没有下一页
    nextOffset: raw.nextOffset === undefined ? offset + frames.length : toCount(raw.nextOffset),
    frameCount: frames.length,
    unmatchedCount: unmatched.length,
    sources,
    frames,
    unmatched,
  };
}

const EMPTY_FRAMES = {
  total: 0,
  frameCount: 0,
  unmatchedCount: 0,
  sources: { 'attr-block': 0, polyline: 0 },
  frames: [],
  unmatched: [],
};

function coerceBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 't', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'f', 'off'].includes(s)) return false;
  return fallback;
}

function coerceNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// 资源 URI 的 query 值是字符串、工具入参是 JSON 原生类型，统一在这里收敛，
// 保证 atlisp://dwg/frames?... 与 list_frames 走同一套语义。
export function buildFramesOptions(params = {}) {
  const hasScales = Array.isArray(params.scales)
    || (typeof params.scales === 'string' && params.scales !== '');
  const scales = hasScales ? params.scales : undefined;
  return {
    layer: typeof params.layer === 'string' ? params.layer : '',
    minSize: coerceNumber(params.minSize, FRAME_STANDARDS.defaultMinSize),
    scales,
    tolRatio: coerceNumber(params.tolRatio, FRAME_STANDARDS.defaultTolRatio),
    tolLen: coerceNumber(params.tolLen, FRAME_STANDARDS.defaultTolLen),
    offset: Math.max(0, Math.floor(coerceNumber(params.offset, 0))),
    // 默认 500：图框数量通常只有几十个，等于全量返回；传 0 表示显式不分页
    limit: Math.max(0, Math.floor(coerceNumber(params.limit, FRAMES_DEFAULT_LIMIT))),
    includeInner: coerceBool(params.includeInner, false),
    includeUnmatched: coerceBool(params.includeUnmatched, true),
  };
}

/**
 * 图框识别（atlisp://dwg/frames / list_frames）。
 *
 * 识别规则见 buildFramesCode 的注释：闭合 4 顶点矩形 + 宽高比命中加长比例表 +
 * 短边命中「图幅短边 × 比例表」→ paperSize/elongation/scale；
 * 默认丢弃被其它候选包含的内框（includeInner=true 保留并标 inner=true）；
 * 配不上标准表的候选进 unmatched（按面积降序，最多 FRAME_STANDARDS.maxUnmatched 条）。
 */
export async function getFrames(params = {}) {
  const options = buildFramesOptions(params);
  // 缓存键必须覆盖所有影响 LISP 的选项，否则换个图层/参数会命中上一份结果的缓存
  const cacheKey = `dwg:frames:${options.layer}:${options.minSize}:${options.tolRatio}:${options.tolLen}`
    + `:${options.offset}:${options.limit}:${options.includeInner ? 1 : 0}:${options.includeUnmatched ? 1 : 0}`
    + `:${Array.isArray(options.scales) ? options.scales.join(',') : 'default'}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  if (!cad.connected) {
    await cad.connect();
  }
  if (!cad.connected) {
    return { connected: false, error: 'CAD 未连接', ...EMPTY_FRAMES, offset: options.offset, limit: options.limit, nextOffset: options.offset };
  }

  try {
    const resultStr = await cad.sendCommandWithResult(buildFramesCode(options));
    const parsed = parseLispRecursive(resultStr);
    if (!parsed || !Array.isArray(parsed)) {
      throw createError(ERROR_CODES.OPERATION_FAILED, {
        reason: '图框识别结果解析失败',
        raw: String(resultStr).substring(0, 500),
      });
    }
    const result = { connected: true, ...normalizeFramesPayload(parsed, options) };
    setCache(cacheKey, result);
    return result;
  } catch (e) {
    log(`getFrames error: ${e.message}`);
    return {
      connected: true,
      error: e.message,
      ...EMPTY_FRAMES,
      offset: options.offset,
      limit: options.limit,
      nextOffset: options.offset,
    };
  }
}

export async function checkDrawingStandards() {
  const standards = getDraftingStandards();
  if (!standards || standards.error) {
    return { ok: false, error: standards?.error || '制图规范未加载' };
  }
  try {
    const issues = [];
    for (const rule of standards.layers || []) {
      const code = `(tblsearch "LAYER" "${escapeLispString(rule.name || rule.pattern)}")`;
      const exists = await cad.sendCommandWithResult(code);
      if (rule.required && (!exists || exists === 'nil' || exists === '')) {
        issues.push({ type: 'missing_layer', message: `缺少必需图层: ${rule.name}` });
      }
    }
    return { ok: issues.length === 0, issues };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function getCadSnapshot() {
  const cached = getCached('cad:snapshot');
  if (cached) return cached;

  if (!cad.connected) {
    await cad.connect();
  }
  if (!cad.connected) {
    return {
      cadConnected: false,
      dwgName: null,
      dwgPath: null,
      entityCount: 0,
      layerCount: 0,
      platform: null,
    };
  }

  try {
    const code = `(progn
  (vl-load-com)
  (setq sn nil)
  (setq sn (cons (cons "dwgName" (vl-princ-to-string (getvar "dwgname"))) sn))
  (setq sn (cons (cons "dwgPath" (vl-princ-to-string (strcat (getvar "dwgprefix") (getvar "dwgname")))) sn))
  (if (setq ss (ssget "_X"))
    (setq sn (cons (cons "entityCount" (sslength ss)) sn))
    (setq sn (cons (cons "entityCount" 0) sn)))
  (setq lcount 0 lnames nil)
  (setq le (tblnext "layer" t))
  (while le
    (setq ln (cdr (assoc 2 le)))
    (if (/= ln "0") (setq lnames (cons ln lnames)))
    (setq lcount (1+ lcount))
    (setq le (tblnext "layer" nil)))
  (setq sn (cons (cons "layerCount" lcount) sn))
  (setq sn (cons (cons "layerNames" lnames) sn))
  (vl-prin1-to-string sn))`;

    const resultStr = await cad.sendCommandWithResult(code);
    const parsed = parseLispRecursive(resultStr);

    if (!parsed || !Array.isArray(parsed)) {
      return {
        cadConnected: true,
        dwgName: null,
        dwgPath: null,
        entityCount: 0,
        layerCount: 0,
        platform: cad.getPlatform(),
      };
    }

    const snapshot = {};
    for (const pair of parsed) {
      if (Array.isArray(pair) && pair.length >= 2) {
        const key = String(pair[0]);
        const val = pair[1];
        if (key === 'layerNames' && Array.isArray(val)) {
          snapshot[key] = val.map(v => String(v));
        } else if (key === 'entityCount' || key === 'layerCount') {
          snapshot[key] = typeof val === 'number' ? val : parseInt(val, 10) || 0;
        } else {
          snapshot[key] = val !== null && val !== undefined ? String(val) : null;
        }
      }
    }

    snapshot.cadConnected = true;
    snapshot.platform = cad.getPlatform();

    setCache('cad:snapshot', snapshot);
    return snapshot;
  } catch (e) {
    log(`getCadSnapshot error: ${e.message}`);
    return {
      cadConnected: true,
      dwgName: null,
      dwgPath: null,
      entityCount: 0,
      layerCount: 0,
      platform: cad.getPlatform(),
      error: e.message,
    };
  }
}
