// =============================================================================
// resource-readers.js — DWG/CAD 资源读取实现（从 resource-handlers.js 拆出）
//
// 职责：atlisp://dwg/*、atlisp://cad/* 等资源的读取实现（实体/文本/图纸信息/
// 块引用/表数据/CAD 事件）。共享的 LISP 代码构建复用 lisp-code-builders.js，
// 通用工具函数复用 resource-utils.js；包/平台/图纸列表与规范读取分别复用
// metadata-readers.js、standards-readers.js（在此再导出以保持对外接口不变）。
// 非 *-handlers.js 命名，不参与 handler-loader 自动发现。
// =============================================================================
import { cad } from '../cad.js';
import { log } from '../logger.js';
import '../config.js';
import { getCached, setCache } from './resource-cache.js';
import { parseLispList, parseLispRecursive, escapeLispString } from '../handler-utils.js';
import { ensureCad, propertyPairsToObject } from './resource-utils.js';
import {
  buildEntityPropertiesCode,
  buildTextContentCode,
  buildBlockRefsCode,
  buildTablesCode,
  parseTableRecord,
} from './lisp-code-builders.js';

async function getEntityByHandle(handle) {
  await ensureCad();

  const code = `(progn
    (vl-load-com)
        (if (setq ent (handent "${escapeLispString(handle)}"))
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

async function getCadInfo() {
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

async function getEntities(params = {}) {
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

async function getEntitiesSummary(cacheKey) {
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

async function getTextContent(params = {}) {
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
        else if (key === 'position') {
          obj.position = Array.isArray(val) ? val.map(v => typeof v === 'number' ? v : 0) : [];
        }
        else if (key === 'height') obj.height = typeof val === 'number' ? val : 2.5;
        else if (key === 'handle') obj.handle = String(val || '');
      }
      return obj.text ? obj : null;
    }).filter(Boolean);

    setCache(cacheKey, data);
    return data;
  } catch (e) {
    log(`getTextContent error: ${e.message}`);
    throw e;
  }
}

function medianHeight(texts) {
  const heights = texts.filter(t => t.height > 0).map(t => t.height);
  if (heights.length === 0) return 2.5;
  heights.sort((a, b) => a - b);
  const mid = Math.floor(heights.length / 2);
  return heights.length % 2 !== 0 ? heights[mid] : (heights[mid - 1] + heights[mid]) / 2;
}

function shouldContinueLine(prevText, nextText) {
  if (!prevText || !nextText) return false;
  const trimmed = prevText.trimEnd();
  if (trimmed.length === 0) return false;
  const lastChar = trimmed[trimmed.length - 1];
  const sentenceEnd = '.!?。！？';
  if (sentenceEnd.includes(lastChar)) return false;
  return true;
}

async function combineText(params = {}) {
  const content = await getTextContent(params);
  const texts = content.texts || [];
  if (texts.length === 0) return { total: 0, blocks: [], medianHeight: 2.5 };

  const mh = medianHeight(texts);
  const yTolerance = params.yTolerance || mh * 1.2;
  const xGapRatio = mh * 3.0;
  const blockSpacing = mh * 2.5;

  const rows = [];
  for (const item of texts) {
    if (!item.text) continue;
    const [x, y] = item.position || [0, 0];
    let matched = null;
    for (const row of rows) {
      if (Math.abs(row.y - y) <= yTolerance) { matched = row; break; }
    }
    if (matched) {
      matched.items.push({ x, text: item.text, height: item.height || mh });
    } else {
      rows.push({ y, items: [{ x, text: item.text, height: item.height || mh }] });
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

async function getDwgName() {
  await ensureCad();

  try {
    const code = `(vl-princ-to-string (getvar "dwgname"))`;
    const name = await cad.sendCommandWithResult(code);
    return { name: name || null };
  } catch {
    return { name: null };
  }
}

async function getDwgPath() {
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
    try { parsed = JSON.parse(result); } catch (e) { log(`resource-readers: JSON parse error: ${e.message}`); }
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

async function getBlockRefs(params = {}) {
  const cacheKey = `dwg:block-refs:${params.blockName || 'all'}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  await ensureCad();

  try {
    const code = buildBlockRefsCode(params.blockName);
    const resultStr = await cad.sendCommandWithResult(code);

    const parsed = parseLispRecursive(resultStr);
    if (!parsed || !Array.isArray(parsed)) {
      throw new Error(`block-refs: 解析 Lisp 结果失败: raw="${String(resultStr).substring(0, 500)}"`);
    }

    const result = {};
    for (const pair of parsed) {
      if (Array.isArray(pair) && pair.length >= 2) {
        result[String(pair[0])] = pair[1];
      }
    }
    const blockRefs = Array.isArray(result.blockRefs) ? result.blockRefs : [];
    const finalResult = {
      total: typeof result.total === 'number' ? result.total : blockRefs.length,
      blockRefs: blockRefs.map(br => {
        const obj = {};
        if (Array.isArray(br)) {
          br.forEach(pair => {
            if (Array.isArray(pair) && pair.length >= 2) {
              const key = pair[0];
              let val = pair.length === 2 ? pair[1] : pair.slice(1);
              if (key === 'insertionPoint' && Array.isArray(val)) {
                val = val.map(v => typeof v === 'number' ? v : 0);
              } else if (key === 'scale' && Array.isArray(val)) {
                val = val.map(v => typeof v === 'number' ? v : 1);
              } else if (key === 'isDynamic') {
                val = val === true || val === 'true' || val === 1;
              } else if (key === 'attributes' && Array.isArray(val)) {
                const o = {};
                val.forEach(p => { if (Array.isArray(p) && p.length >= 2) o[String(p[0])] = p[1]; });
                val = o;
              } else if (key === 'dynamicProperties' && Array.isArray(val)) {
                const o = {};
                val.forEach(p => { if (Array.isArray(p) && p.length >= 2) o[String(p[0])] = p[1]; });
                val = o;
              }
              obj[key] = val;
            }
          });
        }
        return obj;
      })
    };
    setCache(cacheKey, finalResult);
    return finalResult;
  } catch (e) {
    log(`getBlockRefs error: ${e.message}`);
    throw e;
  }
}

async function getTables(params = {}) {
  const tblName = params.tbl || params.type || 'all';
  const cacheKey = `dwg:tbl:${tblName}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  await ensureCad();

  try {
    const code = buildTablesCode(tblName);
    const resultStr = await cad.sendCommandWithResult(code);

    if (!resultStr || resultStr === '' || resultStr === 'nil') {
      return { table: tblName, data: [] };
    }

    const parsed = parseLispRecursive(resultStr);
    if (!parsed || !Array.isArray(parsed)) {
      return { table: tblName, total: 0, data: [] };
    }


    let result;
    if (parsed.length >= 3 && parsed[0] && String(parsed[0][0]).toUpperCase() === 'TABLE') {
      const tableName = String(parsed[0][1]).toLowerCase();
      let total = 0;
      let tblData = [];
      for (const item of parsed) {
        if (Array.isArray(item) && item.length >= 2) {
          const key = String(item[0]).toUpperCase();
          if (key === 'TOTAL') total = typeof item[1] === 'number' ? item[1] : 0;
          else if (key === 'DATA') {
            if (Array.isArray(item[1]) && item[1].length > 0) {
              tblData = item[1];
            }
          }
        }
      }
      if (tblData.length === 0 && parsed.length > 2) {
        tblData = parsed.slice(2);
      }
      result = {
        table: tableName,
        total: total,
        data: tblData.map(r => parseTableRecord(r, tableName)).filter(Boolean)
      };
    } else {
      const allData = {};
      parsed.forEach(item => {
        if (!Array.isArray(item) || item.length < 2) return;
        let tableKey = null;
        const entry = { total: 0, data: [] };
        if (Array.isArray(item[0]) && item[0].length >= 2 && String(item[0][0]).toLowerCase() === 'table') {
          tableKey = String(item[0][1]).toLowerCase();
          for (let i = 1; i < item.length; i++) {
            const sub = item[i];
            if (!Array.isArray(sub) || sub.length < 2) continue;
            const subKey = String(sub[0]).toUpperCase();
            if (subKey === 'TOTAL') entry.total = typeof sub[1] === 'number' ? sub[1] : 0;
            else if (subKey === 'DATA') {
              const raw = Array.isArray(sub[1]) ? sub[1] : sub.slice(1);
              entry.data = raw.map(r => parseTableRecord(r, tableKey)).filter(Boolean);
            }
          }
        } else {
          tableKey = String(item[0]).toLowerCase();
          for (let i = 1; i < item.length; i++) {
            const sub = item[i];
            if (!Array.isArray(sub) || sub.length < 2) continue;
            const subKey = String(sub[0]).toUpperCase();
            if (subKey === 'TOTAL') {
              entry.total = typeof sub[1] === 'number' ? sub[1] : 0;
            } else if (subKey === 'DATA') {
              const raw = Array.isArray(sub[1]) ? sub[1] : sub.slice(1);
              entry.data = raw.map(r => parseTableRecord(r, tableKey)).filter(Boolean);
            }
          }
        }
        if (tableKey) allData[tableKey] = entry;
      });
      result = allData;
    }

    setCache(cacheKey, result);
    return result;
  } catch (e) {
    log(`getTables error: ${e.message}`);
    return { table: tblName, data: [] };
  }
}

async function getCadEvents(_params) {
  await ensureCad();
  try {
    const result = await cad.sendCommandWithResult('(progn (setq cnt 0) (if (setq ss (ssget "_X")) (setq cnt (sslength ss))) (list (cons "entityCount" cnt) (cons "dwgName" (getvar "dwgname")) (cons "dwgPath" (getvar "dwgprefix"))))');
    const data = {};
    try {
      const parsed = JSON.parse(result);
      if (Array.isArray(parsed)) {
        for (const pair of parsed) {
          if (Array.isArray(pair) && pair.length >= 2) data[String(pair[0])] = pair[1];
        }
      }
    } catch { data.raw = result; }
    return { entityCount: data.entityCount || 0, dwgName: data.dwgName || '', dwgPath: data.dwgPath || '', timestamp: new Date().toISOString() };
  } catch (e) {
    return { entityCount: 0, dwgName: '', dwgPath: '', error: e.message };
  }
}

// 包/平台/图纸列表元数据（实现复用 metadata-readers.js，接口保持不变）
export { getPackages, getPlatforms, getDwgList } from './metadata-readers.js';
// 制图/编码规范读取（实现复用 standards-readers.js，接口保持不变）
export { getDraftingStandards, getCodingStandards } from './standards-readers.js';

export {
  getEntityByHandle,
  getCadInfo,
  getEntities,
  getTextContent,
  combineText,
  getDwgName,
  getDwgPath,
  getBlockRefs,
  getTables,
  getCadEvents,
};
