// =============================================================================
// resource-snapshot.js — CAD 快照与图纸分析资源实现
//
// 从 resource-handlers.js 按域拆出（非 *-handlers.js 命名，不触发 handler-loader
// 自动发现，避免重复注册）。提供：
//   - getCadSnapshot        轻量 CAD 状态快照（listResources/readResource 数据源）
//   - getDwgContext         当前图纸上下文 (atlisp://dwg/context)
//   - getDrawingAnalysis    图纸深度分析 (atlisp://dwg/analysis)
//   - checkDrawingStandards 制图规范检查 (atlisp://dwg/standards/check)
// 对外由 resource-handlers.js 的 readResource 调用，不直接注册为 MCP handler。
// =============================================================================
import { cad } from '../cad.js';
import { getCached, setCache } from './resource-cache.js';
import { log } from '../logger.js';
import { parseLispRecursive, escapeLispString } from '../handler-utils.js';
import { getDraftingStandards } from './standards-readers.js';
import { buildDrawingAnalysisCode } from './lisp-code-builders.js';

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
