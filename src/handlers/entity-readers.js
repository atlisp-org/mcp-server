import { cad } from '../cad.js';
import { getCached, setCache } from './resource-cache.js';
import { log } from '../logger.js';
import { parseLispList, parseLispRecursive } from '../handler-utils.js';
import { cleanCadText } from '../text-clean.js';
import { ensureCad, propertyPairsToObject } from './resource-utils.js';
import { buildEntityPropertiesCode, buildTextContentCode } from './lisp-code-builders.js';

export async function getEntityByHandle(handle) {
  await ensureCad();
  const code = `(progn
    (vl-load-com)
        (if (setq ent (handent "${handle}"))
      (progn
        (setq ed (entget ent))
        (list
          "type" (cdr (assoc 0 ed))
          "handle" (cdr (assoc 5 ed))
          "layer" (cdr (assoc 8 ed))
          "color" (if (assoc 62 ed) (cdr (assoc 62 ed)) 256)
          "linetype" (if (assoc 6 ed) (cdr (assoc 6 ed)) "ByLayer")
          "elevation" (if (assoc 38 ed) (cdr (assoc 38 ed)) 0.0)
        )
      )
      nil
    )
  )`;
  try {
    const result = await cad.sendCommandWithResult(code);
    if (!result || result === 'nil') return { error: `未找到实体: ${handle}` };
    try {
      return JSON.parse(result);
    } catch {
      return { raw: result };
    }
  } catch (e) {
    return { error: e.message };
  }
}

export async function getCadInfo() {
  const cached = getCached('cad:info');
  if (cached) return cached;

  if (!cad.connected) {
    await cad.connect();
  }

  if (!cad.connected) {
    return { connected: false, platform: null, version: null, busy: false };
  }

  let busy = false;
  try {
    busy = await cad.isBusy();
  } catch (e) {
    log(`Error checking CAD busy status: ${e.message}`);
  }

  const result = {
    connected: true,
    platform: cad.getPlatform(),
    version: cad.getVersion(),
    busy
  };
  setCache('cad:info', result);
  return result;
}

export async function getEntitiesSummary(cacheKey) {
  const summaryCode = `(progn
    (vl-load-com)
    (setq ss (ssget "_X"))
    (if ss
      (progn
        (setq total (sslength ss) i 0 typeCounts (list))
        (while (< i total)
          (setq ent (ssname ss i) ed (entget ent) typ (cdr (assoc 0 ed)))
          (setq typeCounts (cons typ typeCounts) i (1+ i)))
        (setq counts nil)
        (foreach item typeCounts
          (if (assoc item counts)
            (setq counts (subst (cons item (1+ (cdr (assoc item counts)))) (assoc item counts) counts))
            (setq counts (cons (cons item 1) counts))))
        (cons (list "total" total) (reverse counts))
      )
      (list (list "total" 0))
    )
  )`;

  try {
    const resultStr = await cad.sendCommandWithResult(summaryCode);

    if (!resultStr || resultStr === '' || resultStr === 'nil') {
      return { total: 0, summary: [] };
    }

    const parsed = parseLispRecursive(resultStr);
    if (!parsed || !Array.isArray(parsed)) {
      return { total: 0, summary: [] };
    }

    let total = 0;
    const summary = [];

    for (const item of parsed) {
      if (Array.isArray(item) && item.length >= 2) {
        const key = String(item[0]);
        const val = item[1];
        if (key === 'total') {
          total = typeof val === 'number' ? val : 0;
        } else {
          summary.push({ type: key, count: typeof val === 'number' ? val : 0 });
        }
      }
    }

    summary.sort((a, b) => b.count - a.count);

    const result = { total, summary };
    log(`getEntitiesSummary: total=${total}, types=${summary.length}`);
    setCache(cacheKey, result);
    return result;
  } catch (e) {
    log(`getEntitiesSummary error: ${e.message}`);
    return { total: 0, summary: [] };
  }
}

export async function getEntities(params = {}) {
  const cacheKey = `dwg:entities:${JSON.stringify(params)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  await ensureCad();

  const hasFilter = params.type || params.layer || params.bbox;

  if (!hasFilter) {
    return await getEntitiesSummary(cacheKey);
  }

  try {
    const code = buildEntityPropertiesCode({
      type: params.type || null,
      layer: params.layer || null,
      bbox: params.bbox || null,
    });
    const resultStr = await cad.sendCommandWithResult(code);

    if (!resultStr || resultStr === '' || resultStr === 'nil') {
      return { total: 0, entities: [] };
    }

    let total = 0;
    let entities = [];

    const parsed = parseLispRecursive(resultStr);
    if (parsed && Array.isArray(parsed) && parsed.length >= 2) {
      total = typeof parsed[0] === 'number' ? parsed[0] : 0;
      const rawEntities = Array.isArray(parsed[1]) ? parsed[1] : [];
      entities = rawEntities.map(propertyPairsToObject).filter(Boolean);
    }

    const result = { total, entities };

    log(`getEntities: total=${total}, returned=${entities.length}`);
    setCache(cacheKey, result);
    return result;
  } catch (e) {
    log(`getEntities error: ${e.message}`);
    return { total: 0, entities: [] };
  }
}

export async function getTextContent(params = {}) {
  const cacheKey = `dwg:text-content:${JSON.stringify(params)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  await ensureCad();

  const offset = Math.max(0, parseInt(params.offset) || 0);
  const limit = Math.min(Math.max(1, parseInt(params.limit) || 5000), 5000);

  try {
    const code = buildTextContentCode({ layer: params.layer, bbox: params.bbox, offset, limit });
    const resultStr = await cad.sendCommandWithResult(code);

    log(`[DEBUG text-content] resultStr length=${resultStr?.length} first300=${resultStr?.substring(0, 300)}`);

    const parsed = parseLispRecursive(resultStr);
    if (!parsed || !Array.isArray(parsed)) {
      throw new Error(`text-content: 解析 Lisp 结果失败: raw="${String(resultStr).substring(0, 500)}"`);
    }

    const data = {};
    let rawTexts = [];
    for (let i = 0; i < parsed.length - 1; i += 2) {
      const key = parsed[i];
      const val = parsed[i + 1];
      if (typeof key === 'string' || typeof key === 'number') {
        if (key === 'texts' && Array.isArray(val)) {
          rawTexts = val;
        } else {
          data[String(key)] = val;
        }
      }
    }
    data.texts = rawTexts.map(item => {
      if (!Array.isArray(item)) return null;
      const obj = {};
      for (let i = 0; i < item.length - 1; i += 2) {
        const key = item[i];
        const val = item[i + 1];
        if (key === 'text') obj.text = String(val || '');
        else if (key === 'type') obj.type = String(val || '');
        else if (key === 'layer') obj.layer = String(val || '');
        else if (key === 'position') {
          obj.position = Array.isArray(val) ? val.map(v => typeof v === 'number' ? v : 0) : [];
        }
        else if (key === 'height') obj.height = typeof val === 'number' ? val : 2.5;
        else if (key === 'handle') obj.handle = String(val || '');
      }
      obj.plainText = cleanCadText(obj.text);
      return (obj.text || obj.plainText) ? obj : null;
    }).filter(Boolean);

    setCache(cacheKey, data);
    return data;
  } catch (e) {
    log(`getTextContent error: ${e.message}`);
    throw e;
  }
}

export function medianHeight(texts) {
  const heights = texts.filter(t => t.height > 0).map(t => t.height);
  if (heights.length === 0) return 2.5;
  heights.sort((a, b) => a - b);
  const mid = Math.floor(heights.length / 2);
  return heights.length % 2 !== 0 ? heights[mid] : (heights[mid - 1] + heights[mid]) / 2;
}

export function shouldContinueLine(prevText, nextText) {
  if (!prevText || !nextText) return false;
  const trimmed = prevText.trimEnd();
  if (trimmed.length === 0) return false;
  const lastChar = trimmed[trimmed.length - 1];
  const sentenceEnd = '.!?。！？';
  if (sentenceEnd.includes(lastChar)) return false;
  return true;
}

export async function combineText(params = {}) {
  const content = await getTextContent(params);
  const texts = content.texts || [];
  if (texts.length === 0) return { total: 0, blocks: [], medianHeight: 2.5 };

  const mh = medianHeight(texts);
  const yTolerance = params.yTolerance || mh * 1.2;
  const xGapRatio = mh * 3.0;
  const blockSpacing = mh * 2.5;

  const rows = [];
  for (const item of texts) {
    const itemText = item.plainText || item.text;
    if (!itemText) continue;
    const [x, y] = item.position || [0, 0];
    let matched = null;
    for (const row of rows) {
      if (Math.abs(row.y - y) <= yTolerance) { matched = row; break; }
    }
    if (matched) {
      matched.items.push({ x, text: itemText, height: item.height || mh });
    } else {
      rows.push({ y, items: [{ x, text: itemText, height: item.height || mh }] });
    }
  }

  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    row.lines = [];
    let cur = [];
    for (const item of row.items) {
      if (cur.length === 0) { cur.push(item); continue; }
      const prev = cur[cur.length - 1];
      if (item.x - prev.x > xGapRatio) {
        row.lines.push(cur.map(t => t.text).join(''));
        cur = [item];
      } else {
        cur.push(item);
      }
    }
    if (cur.length > 0) row.lines.push(cur.map(t => t.text).join(''));
  }

  rows.sort((a, b) => a.y - b.y);
  const rawBlocks = [];
  let curBlock = null;
  for (const row of rows) {
    if (!curBlock) {
      curBlock = { rows: [row] };
    } else {
      const last = curBlock.rows[curBlock.rows.length - 1];
      if (row.y - last.y > blockSpacing) {
        rawBlocks.push(curBlock);
        curBlock = { rows: [row] };
      } else {
        curBlock.rows.push(row);
      }
    }
  }
  if (curBlock) rawBlocks.push(curBlock);

  const blocks = rawBlocks.map(block => {
    const orderedRows = [...block.rows].reverse();
    const lines = [];
    for (let i = 0; i < orderedRows.length; i++) {
      const rowText = orderedRows[i].lines.join(' ');
      if (i === 0) {
        lines.push(rowText);
      } else {
        const prevLine = lines[lines.length - 1];
        if (shouldContinueLine(prevLine, rowText)) {
          lines[lines.length - 1] = prevLine + rowText;
        } else {
          lines.push(rowText);
        }
      }
    }
    return {
      text: lines.join('\n'),
      y: orderedRows[0].y,
      rowCount: orderedRows.length,
      lines
    };
  });

  blocks.sort((a, b) => b.y - a.y);
  return { total: blocks.length, blocks, medianHeight: mh };
}

export async function getDwgName() {
  await ensureCad();
  try {
    const code = `(vl-princ-to-string (getvar "dwgname"))`;
    const name = await cad.sendCommandWithResult(code);
    return { name: name || null };
  } catch {
    return { name: null };
  }
}

export async function getDwgPath() {
  await ensureCad();
  try {
    const code = `(progn
      (setq prefix (vl-princ-to-string (getvar "dwgprefix")))
      (setq name (vl-princ-to-string (getvar "dwgname")))
      (list (strcat prefix name) name)
    )`;
    const result = await cad.sendCommandWithResult(code);

    if (!result || result === "nil" || result === "") {
      return { path: null, name: null };
    }

    let parsed = null;
    try { parsed = JSON.parse(result); } catch (e) { log(`resource-handlers: JSON parse error: ${e.message}`); }
    if (!parsed) {
      const listResult = parseLispList(result);
      if (listResult && listResult.length >= 2) parsed = listResult;
    }

    if (parsed && Array.isArray(parsed) && parsed.length >= 2) {
      return { path: String(parsed[0]), name: String(parsed[1]) };
    }

    return { path: result, name: result };
  } catch {
    return { path: null, name: null };
  }
}
