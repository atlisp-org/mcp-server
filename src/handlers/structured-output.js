/**
 * 结构化输出辅助（MCP 2025-06-18 规范：工具 outputSchema + 结果 structuredContent）。
 *
 * 约定：
 * - build* 只用于「成功」结果（isError 结果不带 structuredContent，SDK/客户端会跳过校验）；
 * - 所有 build* 始终返回普通对象，保证声明了 outputSchema 的工具成功时一定有合法 structuredContent；
 * - 解析失败时回退为带 raw 字段的对象（raw 在对应 outputSchema 中声明为可选属性）。
 */
import { parseLispRecursive, lispPairsToObject } from '../handler-utils.js';

/** @param {unknown} v @param {string} [def] */
function toStr(v, def = '') {
  return v === null || v === undefined ? def : String(v);
}

/** @param {unknown} v @param {number} [def] */
function toNum(v, def = 0) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v === null || v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

/** @param {unknown} v */
function toBool(v) {
  return v === true || v === 1 || v === '1' || v === 'T' || v === 't' || v === 'true';
}

/**
 * 解析文本中的列表：Lisp 打印形式 ("a" "b") 或 JSON 数组 ["a","b"]。
 * 非列表文本返回 null。
 * @param {unknown} text
 * @returns {unknown[]|null}
 */
export function parseListText(text) {
  if (typeof text !== 'string') return null;
  let t = text.trim();
  if (!t) return null;
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    // 可能是 Lisp 字符串包裹的列表打印结果，如 "("Model")" 形式
    const inner = t.slice(1, -1).trim();
    if (!inner.startsWith('(') && !inner.startsWith('[')) return null;
    t = inner;
  }
  if (t.startsWith('[')) {
    try {
      const v = JSON.parse(t);
      return Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  }
  if (!t.startsWith('(')) return null;
  const parsed = parseLispRecursive(t);
  return Array.isArray(parsed) ? parsed : null;
}

/**
 * 解析 key/value 列表为对象，兼容两种打印形式：
 * - 扁平: ("type" "LINE" "handle" "1F")
 * - 嵌套: (("type" "LINE") ("handle" "1F"))
 * 也兼容 (list "type" "LINE" ...) 形式。
 * @param {unknown} text
 * @returns {Record<string, unknown>|null}
 */
export function parsePairsText(text) {
  const arr = parseListText(text);
  if (!arr) return null;
  const items = arr.length > 0 && arr[0] === 'list' ? arr.slice(1) : arr;
  if (items.length === 0) return {};
  const nested = items.every(x => Array.isArray(x) && x.length >= 2);
  if (nested) {
    const obj = {};
    for (const pair of items) obj[String(pair[0])] = pair[1];
    return obj;
  }
  return lispPairsToObject(items);
}

/**
 * 实体基本属性（get_entity）：type/handle/layer/color/linetype/elevation。
 * @param {unknown} text
 */
export function entityBasicStructured(text) {
  const p = parsePairsText(text);
  const obj = p || {};
  const out = {
    type: toStr(obj.type),
    handle: toStr(obj.handle),
    layer: toStr(obj.layer),
    color: toNum(obj.color, 256),
    linetype: toStr(obj.linetype, 'ByLayer'),
    elevation: toNum(obj.elevation, 0),
  };
  if (!p && toStr(text)) out.raw = toStr(text);
  return out;
}

/**
 * 实体详细属性（get_entity_info）：基本属性 + 图层冻结/锁定状态。
 * @param {unknown} text
 */
export function entityDetailStructured(text) {
  const p = parsePairsText(text) || {};
  return {
    ...entityBasicStructured(text),
    layerFrozen: toBool(p.layerFrozen),
    layerLocked: toBool(p.layerLocked),
  };
}

/**
 * 字符串列表类结果（块列表/UCS/布局/句柄数组等）→ { count, [key]: string[], raw? }
 * @param {unknown} text
 * @param {string} key 结果对象中列表字段名
 * @param {Record<string, unknown>} [extra] 额外字段，如 { groupName: 'G1' }
 */
export function stringListStructured(text, key, extra = {}) {
  const arr = parseListText(text);
  if (!Array.isArray(arr)) {
    const out = { ...extra, count: 0, [key]: [] };
    const raw = toStr(text);
    if (raw) out.raw = raw;
    return out;
  }
  const list = arr.map(v => (v === null || v === undefined ? '' : String(v)));
  return { ...extra, count: list.length, [key]: list };
}

/**
 * 测量类结果（"Distance: 100.0" 形式的字符串列表）→ { distance, angleDeg, ... } 或 { raw }
 * @param {unknown} text
 * @param {Record<string, string>} keyMap 小写标签 → 输出字段名
 */
export function measureStructured(text, keyMap) {
  const arr = parseListText(text);
  const out = {};
  if (Array.isArray(arr)) {
    for (const line of arr) {
      const m = /^([^:]+):\s*(-?\d+(?:\.\d+)?)/.exec(String(line).trim());
      if (!m) continue;
      const field = keyMap[m[1].trim().toLowerCase()];
      if (field) out[field] = Number(m[2]);
    }
  }
  if (Object.keys(out).length === 0 && toStr(text)) out.raw = toStr(text);
  return out;
}

/**
 * 已是 JSON 文本的结果 → 解析为对象，失败回退 { raw }。
 * @param {unknown} text
 * @returns {Record<string, unknown>}
 */
export function jsonStructured(text) {
  try {
    const v = JSON.parse(toStr(text));
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch { /* 落到 raw 回退 */ }
  return { raw: toStr(text) };
}
