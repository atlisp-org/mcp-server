import { RESOURCES, TBL_QUERIES, TBL_KEY_ALIAS, STANDARDS_DIR } from './resource-defs.js';
import { clearCache, getCached, setCache } from './resource-cache.js';
import { cad } from '../cad.js';
import { CAD_PLATFORMS, FILE_EXTENSIONS } from '../constants.js';
import { log } from '../logger.js';
import { parseLispList, parseLispRecursive, lispPairsToObject, escapeLispString } from '../handler-utils.js';
import { createError, ERROR_CODES } from '../errors.js';
import config from '../config.js';
import { tools } from '../tools/index.js';
import fs from 'fs';
import path from 'path';

// =============================================================================
// LISP Helper Code (sent once per session via cad-worker.js cache)
// =============================================================================

const ENTITY_PROPERTIES_LISP = `
(defun entity:to-list (val)
  (cond
    ((= (type val) 'VARIANT) (entity:to-list (vlax-variant-value val)))
    ((= (type val) 'SAFEARRAY) (vlax-safearray->list val))
    (T val)))

(defun entity:try-get (obj names / result val)
  (foreach name names
    (if (not (vl-catch-all-error-p
               (setq val (vl-catch-all-apply
                            (function vlax-get-property)
                            (list obj name)))))
      (setq result (cons (cons name (entity:to-list val)) result))))
  (reverse result))

(setq *common-props* '(ObjectName Handle Layer Color Linetype LinetypeScale Lineweight Visibility Material))

(setq *entity-props*
  '((AcDbLine StartPoint EndPoint Angle Delta Length Thickness Normal)
    (AcDbCircle Center Radius Diameter Circumference Area Thickness Normal)
    (AcDbArc Center Radius StartAngle EndAngle TotalAngle ArcLength Area Normal)
    (AcDbPoint Position Thickness Normal)
    (AcDbText TextString Position Height Width ObliqueAngle Rotation StyleName HorizontalAlignment VerticalAlignment Normal Backward UpsideDown)
    (AcDbMText TextString Location Height Width Rotation StyleName AttachmentPoint DrawingDirection LinespacingFactor LinespacingDistance LinespacingStyle FlowDirection)
    (AcDbBlockReference Name InsertionPoint Rotation XScale YScale ZScale Normal)
    (AcDbPolyline Coordinates Closed ConstantWidth Elevation Normal Thickness LinetypeGeneration Area Length)
    (AcDb2dPolyline Coordinates Closed Elevation Normal Thickness LinetypeGeneration Area Length Type Width)
    (AcDb3dPolyline Coordinates Closed Type Normal Length Area)
    (AcDbAlignedDimension DimLinePoint1 DimLinePoint2 ExtLinePoint1 ExtLinePoint2 TextPosition TextRotation Measurement)
    (AcDbRotatedDimension DimLinePoint1 DimLinePoint2 ExtLinePoint1 ExtLinePoint2 TextPosition TextRotation Measurement Rotation)
    (AcDbRadialDimension Center Diameter LeaderLength TextPosition)
    (AcDbDiametricDimension Center Diameter LeaderLength TextPosition)
    (AcDbAngularDimension AngleVertex AngleEndPoint ArcPoint TextPosition Measurement)
    (AcDbHatch PatternName PatternType Area Elevation Normal NumberOfLoops AssociativeHatch HatchObjectType PatternAngle PatternScale PatternSpace ISOPenWidth)
    (AcDbSpline Degree NumberOfControlPoints NumberOfFitPoints ControlPoints FitPoints Knots Weights Area Length Closed Periodic StartTanVector EndTanVector Elevation Normal)
    (AcDbEllipse Center MajorRadius MinorRadius RadiusRatio StartAngle EndAngle Area Circumference Normal)
    (AcDbRegion Area Perimeter Centroid MomentsOfInertia PrincipalMoments PrincipalDirections Normal)
    (AcDb3dSolid Volume Area Centroid MomentsOfInertia PrincipalMoments PrincipalDirections)
    (AcDbRasterImage ImageFile ImageWidth ImageHeight Origin Rotation Width Height ShowImage ClippingEnabled)
    (AcDbLeader Coordinates ArrowheadType ArrowheadSize Color ScaleFactor StyleName TextString TextPosition Type Normal)
    (AcDbViewport Center Width Height ScaleFactor CustomScale StandardScale GridOn SnapOn On DisplayLocked)
    (AcDbTable TableStyleName Position Rows Columns Direction FlowDirection)))

(defun entity:properties (ent / obj object-name result)
  (setq obj (if (= (type ent) 'VLA-OBJECT) ent (vlax-ename->vla-object ent)))
  (setq result (entity:try-get obj *common-props*))
  (setq object-name (cdr (assoc 'ObjectName result)))
  (if object-name
    (setq result (append result (entity:try-get obj (cdr (assoc (read object-name) *entity-props*))))))
  result)
`;

const VLA_HELPER_LISP = `(defun @:get-props (obj prop-names / result p p-sym val)
  (setq result nil)
  (foreach p prop-names
    (setq p-sym (read p))
    (if (vlax-property-available-p obj p-sym)
      (progn
        (setq val (vl-catch-all-apply 'vlax-get (list obj p-sym)))
        (if (not (vl-catch-all-error-p val))
          (progn
             (cond
              ((= (type val) 'VLA-OBJECT) (setq val (strcat "@" (vla-get-objectname val))))
              ((or (= (type val) 'STR) (= (type val) 'SAFEARRAY) (listp val)) (setq val (vl-prin1-to-string val))))
            (setq result (cons (cons p val) result)))))))
  (reverse result))`;

// =============================================================================
// Utility Functions
// =============================================================================

function parseEntity(arr) {
  if (!Array.isArray(arr) || arr.length < 5) return null;
  const [type, handle, layer, color, linetype, ...rest] = arr;
  const entity = {
    type: String(type).toUpperCase().replace(/^"|"$/g, ''),
    handle: String(handle),
    layer: String(layer),
    color,
    linetype: String(linetype)
  };
  const entType = typeof entity.type === 'string' ? entity.type.toUpperCase() : entity.type;
  if (/^(TEXT|MTEXT|ATTRIB|TCH_TEXT)$/.test(entType) && rest[0] != null) {
    entity.text = String(rest[0]);
  }
  if (/^(LINE|LWPOLYLINE|POLYLINE|ARC|CIRCLE|SPLINE|ELLIPSE|XLINE|RAY)$/.test(entType)
    && Array.isArray(rest[0])) {
    entity.points = rest[0].map(pt => {
      if (Array.isArray(pt) && pt.length >= 2)
        return { x: Number(pt[0]), y: Number(pt[1]), z: Number(pt[2] || 0) };
      return null;
    }).filter(Boolean);
  }
  if (entType === 'INSERT' && rest[0] != null) {
    entity.blockName = String(rest[0]);
  }
  return entity;
}

function parseVlaEntity(obj) {
  if (!obj || typeof obj !== 'object') return null;
  return {
    type: obj.type || null,
    handle: obj.handle || null,
    layer: obj.layer || '0',
    color: obj.color !== undefined ? obj.color : 256,
    linetype: obj.linetype || 'ByLayer'
  };
}

function propertyPairsToObject(pairs) {
  if (!Array.isArray(pairs)) return null;
  const obj = {};
  for (const pair of pairs) {
    if (Array.isArray(pair) && pair.length >= 2) {
      obj[String(pair[0])] = pair[1] !== null && pair[1] !== undefined ? pair[1] : null;
    }
  }
  return obj;
}

async function ensureCad() {
  if (!cad.connected) await cad.connect();
  if (!cad.connected) throw createError(ERROR_CODES.CAD_NOT_CONNECTED);
}

// =============================================================================
// LISP Code Builders
// =============================================================================

function buildEntityPropertiesCode({ type, layer, bbox }) {
  const items = [];
  if (type) items.push(`(cons 0 "${escapeLispString(type)}")`);
  if (layer) items.push(`(cons 8 "${escapeLispString(layer)}")`);
  if (bbox) {
    const parts = bbox.split(',').map(s => parseFloat(s.trim()));
    if (parts.length === 4) {
      const [x1, y1, x2, y2] = parts;
      items.push(
        `'(-4 . "<AND")`,
        `'(-4 . ">=,>=,*") (list 10 ${x1} ${y1} 0.0)`,
        `'(-4 . "<=,<=,*") (list 10 ${x2} ${y2} 0.0)`,
        `'(-4 . "AND>")`
      );
    }
  }
  const filterExpr = items.length ? `(list ${items.join(' ')})` : 'nil';
  const ssgetExpr = items.length ? `(ssget "_X" ${filterExpr})` : '(ssget "_X")';

  return `(progn
(vl-load-com)
${ENTITY_PROPERTIES_LISP}
(setq @e:total (if (setq @e:ss ${ssgetExpr}) (sslength @e:ss) 0)
      @e:ents nil @e:i 0)
(while (and @e:ss (< @e:i @e:total) (< (length @e:ents) 3000))
  (setq @e:ents (cons (entity:properties (ssname @e:ss @e:i)) @e:ents)
        @e:i (1+ @e:i)))
(vl-prin1-to-string (list @e:total (reverse @e:ents))))`;
}

function buildTextContentCode({ layer, bbox, offset, limit }) {
  const items = [
    `'(-4 . "<OR")`,
    `'(0 . "TEXT")`,
    `'(0 . "MTEXT")`,
    `'(0 . "ATTRIB")`,
    `'(-4 . "OR>")`,
  ];
  if (layer) items.push(`(cons 8 "${escapeLispString(layer)}")`);
  if (bbox) {
    const parts = bbox.split(',').map(s => parseFloat(s.trim()));
    if (parts.length === 4) {
      const [x1, y1, x2, y2] = parts;
      items.push(
        `'(-4 . "<AND")`,
        `'(-4 . ">=,>=,*") (list 10 ${x1} ${y1} 0.0)`,
        `'(-4 . "<=,<=,*") (list 10 ${x2} ${y2} 0.0)`,
        `'(-4 . "AND>")`
      );
    }
  }
  const filterExpr = `(list ${items.join(' ')})`;

  return `(progn
(vl-load-com)
(setq ss (ssget "_X" ${filterExpr}))
(if (null ss)
  (list "total" 0 "offset" ${offset} "limit" ${limit} "texts" nil)
  (progn
    (setq total (sslength ss) i ${offset} texts nil)
    (while (and (< i total) (< (length texts) ${limit}))
      (setq ent (ssname ss i) ed (entget ent) ins (cdr (assoc 10 ed)))
      (setq typ (cdr (assoc 0 ed)) h (cdr (assoc 40 ed)))
      (if (null h) (setq h 2.5))
      (setq texts (append texts (list (list
        "text" (vl-prin1-to-string (cdr (assoc 1 ed)))
        "position" (list (car ins) (cadr ins) (caddr ins))
        "height" h
        "handle" (cdr (assoc 5 ed))
      ))) i (1+ i)))
    (list "total" total "offset" ${offset} "limit" ${limit} "texts" texts))))
`;
}

function buildBlockRefsCode(filterBlockName) {
  const filterItems = ['(cons 0 "INSERT")'];
  if (filterBlockName) {
    filterItems.push(`(cons 2 "${escapeLispString(filterBlockName)}")`);
  }
  const filterCode = `(list ${filterItems.join(' ')})`;
  return `(progn
(vl-load-com)

(defun @br:try-fn (fn arg / r)
  (setq r (vl-catch-all-apply (function (lambda () (apply fn (list arg))))))
  (if (vl-catch-all-error-p r) nil r))

(defun @br:props (ent / ed r p2 p10 p50 p41 p42 p43)
  (setq ed (entget ent)
        p10 (cdr (assoc 10 ed))
        p50 (cdr (assoc 50 ed))
        p41 (cdr (assoc 41 ed))
        p42 (cdr (assoc 42 ed))
        p43 (cdr (assoc 43 ed)))
  (setq r (vl-catch-all-apply
            (function (lambda ()
              (list
                (cons "handle" (cdr (assoc 5 ed)))
                (cons "layer" (cdr (assoc 8 ed)))
                (cons "blockName" (cdr (assoc 2 ed)))
                (cons "effectiveBlockName" (cdr (assoc 2 ed)))
                (cons "insertionPoint" (list (car p10) (cadr p10) (caddr p10)))
                (cons "rotation" p50)
                (cons "scale" (list p41 p42 p43))
                (cons "attributes" (@br:try-fn 'block:get-attributes ent))
                (cons "dynamicProperties" (@br:try-fn 'block:get-properties ent)))))))
  (if (vl-catch-all-error-p r) (list (cons "handle" (cdr (assoc 5 ed)))) r))

(setq ss (ssget "_X" ${filterCode}))
(if (null ss)
  (list (cons "total" 0) (cons "blockRefs" nil))
  (progn
    (setq total (sslength ss) i 0 refs nil)
    (while (< i total)
      (setq r (@br:props (ssname ss i)))
      (if r (setq refs (cons r refs)))
      (setq i (1+ i)))
    (list (cons "total" total) (cons "blockRefs" (list (reverse refs)))))))`;
}

function buildTablesCode(tblName) {
  const raw = tblName.toLowerCase();
  const key = TBL_KEY_ALIAS[raw] || raw;
  const query = TBL_QUERIES[key];
  const isVlaTable = key !== 'layer';
  if (query) {
    if (isVlaTable) {
      return `(progn (vl-load-com) ${VLA_HELPER_LISP} ${query.lisp})`;
    }
    return `(progn (vl-load-com) ${query.lisp})`;
  }
  const parts = Object.values(TBL_QUERIES).map(q => `(vl-catch-all-apply '(lambda () ${q.lisp}))`);
  return `(progn (vl-load-com) ${VLA_HELPER_LISP} (list ${parts.join(' ')}))`;
}

function parseTableRecord(rec, tableName) {
  if (!rec || !Array.isArray(rec)) return null;
  const obj = {};
  const isLayer = tableName === 'layer';
  for (const pair of rec) {
    if (Array.isArray(pair) && pair.length >= 2) {
      const key = String(pair[0]);
      const val = pair[1];
      const isDxfCode = typeof pair[0] === 'number';
      if (isDxfCode) {
        if (key === '2') obj.name = String(val);
        else if (key === '62') obj.color = typeof val === 'number' ? val : 7;
        else if (key === '6') obj.linetype = String(val);
        else if (key === '70') {
          obj.flags = typeof val === 'number' ? val : 0;
          if (isLayer) {
            obj.frozen = (val & 1) !== 0;
            obj.locked = (val & 4) !== 0;
          }
        }
        else if (key === '60') obj.on = val === 0;
        else if (key === '1') obj.font = String(val);
        else if (key === '40') obj.height = typeof val === 'number' ? val : 0;
        else if (key === '41') obj.width = typeof val === 'number' ? val : 1;
        else if (key === '42') obj.oblique = typeof val === 'number' ? val : 0;
        else if (key === '3') obj.bigfont = String(val);
        else if (key === '50') obj.flags = typeof val === 'number' ? val : 0;
      } else {
        if (key === 'Name') obj.name = val;
        obj[key] = val;
      }
    }
  }
  return obj.name ? obj : null;
}

// =============================================================================
// Resource Reader Functions
// =============================================================================

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
      const localH = prev.height || mh;
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
  } catch (e) {
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
    try { parsed = JSON.parse(result); } catch (e) { log(`resource-handlers: JSON parse error: ${e.message}`); }
    if (!parsed) {
      const listResult = parseLispList(result);
      if (listResult && listResult.length >= 2) parsed = listResult;
    }

    if (parsed && Array.isArray(parsed) && parsed.length >= 2) {
      return { path: String(parsed[0]), name: String(parsed[1]) };
    }

    return { path: result, name: result };
  } catch (e) {
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

async function getPackages(filterName = null) {
  const cacheKey = filterName ? `packages:${filterName}` : 'packages:all';
  const cached = getCached(cacheKey);
  if (cached) return cached;

  await ensureCad();

  try {
    const code = `(mapcar 'cdr @::*local-pkgs*)`;
    const result = await cad.sendCommandWithResult(code);

    if (!result || result === '' || result === 'nil') {
      return [];
    }

    let raw = [];
    try {
      raw = JSON.parse(result);
    } catch {
      raw = parseLispList(result) || [];
    }
    if (!Array.isArray(raw)) raw = [];

    const packages = raw.map(item => {
      if (Array.isArray(item)) {
        const pkg = { name: '', version: '0.0.0', description: '', loaded: true };
        for (const entry of item) {
          if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
            const [[key, val]] = Object.entries(entry);
            const k = String(key);
            const v = String(val);
            if (k === ':NAME') pkg.name = v;
            else if (k === ':VERSION') pkg.version = v;
            else if (k === ':DESCRIPTION') pkg.description = v;
            else if (k === ':FULL-NAME') pkg.fullName = v;
            else if (k === ':AUTHOR') pkg.author = v;
            else if (k === ':CATEGORY') pkg.category = v;
            else if (k === ':URL') pkg.url = v;
          }
        }
        return pkg;
      }
      if (typeof item === 'string' || typeof item === 'number') {
        return { name: String(item), version: '0.0.0', loaded: true };
      }
      if (item && typeof item === 'object') {
        const pkg = { name: '', version: '0.0.0', description: '', loaded: true };
        const nameVal = item.name || item.Name || item.NAME || item[':NAME'];
        if (nameVal) pkg.name = String(nameVal);
        const verVal = item.version || item.Version || item.VERSION || item[':VERSION'];
        if (verVal) pkg.version = String(verVal);
        const descVal = item.description || item.Description || item.DESCRIPTION || item[':DESCRIPTION'];
        if (descVal) pkg.description = String(descVal);
        if (item.fullName || item.full_name) pkg.fullName = String(item.fullName || item.full_name);
        if (item.author || item.Author) pkg.author = String(item.author || item.Author);
        if (item.category || item.Category) pkg.category = String(item.category || item.Category);
        if (item.url || item.Url || item.URL) pkg.url = String(item.url || item.Url || item.URL);
        return pkg;
      }
      return null;
    }).filter(Boolean);

    if (filterName) {
      const filtered = packages.filter(p => p.name === filterName);
      setCache(cacheKey, filtered);
      return filtered;
    }
    setCache(cacheKey, packages);
    return packages;
  } catch (e) {
    return [];
  }
}

function getPlatforms() {
  return CAD_PLATFORMS.map(name => ({
    name,
    extensions: FILE_EXTENSIONS[name] || []
  }));
}

async function getDwgList() {
  const cacheKey = 'cad:dwgs';
  const cached = getCached(cacheKey);
  if (cached) return cached;

  await ensureCad();

  try {
    const code = `(progn
      (vl-load-com)
      (setq result nil)
      (vlax-for doc (vla-get-Documents (vla-get-Application (vlax-get-acad-object)))
        (setq result (cons (list (vla-get-Name doc) (vla-get-FullName doc)) result))
      )
      (reverse result)
    )`;
    const result = await cad.sendCommandWithResult(code);

    if (!result || result === "" || result === "nil") {
      return [];
    }

    let parsed = [];
    try {
      parsed = JSON.parse(result);
    } catch (e) {
      const listResult = parseLispRecursive(result);
      if (Array.isArray(listResult)) {
        parsed = listResult;
      }
    }

    if (!Array.isArray(parsed)) parsed = [];

    const dwgList = parsed.map(item => {
      if (Array.isArray(item) && item.length >= 2) {
        return { name: String(item[0]), path: String(item[1]) };
      }
      return null;
    }).filter(Boolean);

    setCache(cacheKey, dwgList);
    return dwgList;
  } catch (e) {
    return [];
  }
}

function loadStandardsFile(filename) {
  const filePath = path.join(STANDARDS_DIR, filename);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    log(`Error loading standards file ${filename}: ${e.message}`);
    return null;
  }
}

const standardsCache = new Map();

function getCachedStandards(key) {
  const entry = standardsCache.get(key);
  if (entry && Date.now() - entry.timestamp < 30000) return entry.data;
  standardsCache.delete(key);
  return null;
}

function setCachedStandards(key, data) {
  standardsCache.set(key, { data, timestamp: Date.now() });
}

function getDraftingStandards() {
  const cached = getCachedStandards('drafting');
  if (cached) return cached;
  const data = loadStandardsFile('drafting.json');
  if (data) setCachedStandards('drafting', data);
  return data || { error: '制图规范文件加载失败' };
}

function getCodingStandards() {
  const cached = getCachedStandards('coding');
  if (cached) return cached;
  const data = loadStandardsFile('coding.json');
  if (data) setCachedStandards('coding', data);
  return data || { error: '编码规范文件加载失败' };
}

async function getCadEvents(params) {
  await ensureCad();
  try {
    const code = `(progn (setq cnt 0) (if (setq ss (ssget "_X")) (setq cnt (sslength ss))) (list (cons "entityCount" cnt) (cons "dwgName" (getvar "dwgname")) (cons "dwgPath" (getvar "dwgprefix"))))`;
    const result = await cad.sendCommandWithResult(code);
    const data = {};
    try {
      const parsed = JSON.parse(result);
      if (Array.isArray(parsed)) {
        for (const pair of parsed) {
          if (Array.isArray(pair) && pair.length >= 2) data[String(pair[0])] = pair[1];
        }
      }
    } catch { data.raw = result; }
    return {
      entityCount: data.entityCount || 0,
      dwgName: data.dwgName || '',
      dwgPath: data.dwgPath || '',
      timestamp: new Date().toISOString()
    };
  } catch (e) {
    return { entityCount: 0, dwgName: '', dwgPath: '', error: e.message };
  }
}

// =============================================================================
// Live CAD Snapshot (for listResources enrichment)
// =============================================================================

/**
 * Fetches a lightweight snapshot of current CAD state.
 * Returns a flat object with entity count, layer names, DWG info, etc.
 */
async function getDwgContext() {
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

async function getDrawingAnalysis(params = {}) {
  const snapshot = await getCadSnapshot();
  if (!snapshot || !snapshot.cadConnected) {
    return { connected: false, error: 'CAD 未连接' };
  }

  try {
    const detailedCode = `(progn
  (vl-load-com)
  (setq r nil)
  ;; entity counts by type
  (if (setq ss (ssget "_X"))
    (progn
      (setq total (sslength ss) i 0 cnt nil)
      (while (< i total)
        (setq typ (cdr (assoc 0 (entget (ssname ss i)))))
        (setq cnt (if (assoc typ cnt) (subst (cons typ (1+ (cdr (assoc typ cnt)))) (assoc typ cnt) cnt) (cons (cons typ 1) cnt)))
        (setq i (1+ i)))
      (setq r (cons (cons "entityCount" total) r))
      (setq r (cons (cons "entityByType" cnt) r)))
    (setq r (cons (cons "entityCount" 0) r)))
  ;; block usage
  (setq blocks nil)
  (vlax-for b (vla-get-blocks (vla-get-activedocument (vlax-get-acad-object)))
    (if (and (= (vla-get-IsXref b) :vlax-false) (/= (vla-get-Name b) "*Model_Space") (/= (vla-get-Name b) "*Paper_Space"))
      (setq blocks (cons (list "name" (vla-get-Name b) "count" (vla-get-Count b) "isDynamic" (vla-get-IsDynamicBlock b)) blocks))))
  (setq r (cons (cons "blockUsage" blocks) r))
  ;; layer summary
  (setq layers nil le (tblnext "layer" t))
  (while le
    (setq ln (cdr (assoc 2 le)) lc (cdr (assoc 62 le)) ll (cdr (assoc 6 le)))
    (setq layers (cons (list "name" ln "color" (if (< lc 0) (- lc) lc) "off" (< lc 0) "linetype" ll) layers))
    (setq le (tblnext "layer" nil)))
  (setq r (cons (cons "layers" layers) r))
  ;; text stats
  (if (setq ts (ssget "_X" '((0 . "TEXT,MTEXT"))))
    (progn
      (setq tc (sslength ts) th nil ti 0)
      (while (< ti tc)
        (setq h (cdr (assoc 40 (entget (ssname ts ti)))))
        (if h (setq th (cons h th)))
        (setq ti (1+ ti)))
      (setq th (vl-sort th '<))
      (setq r (cons (cons "textCount" tc) r))
      (setq r (cons (cons "textHeights" (list "min" (car th) "max" (last th) "median" (nth (fix (/ (length th) 2)) th))) r)))
    (setq r (cons (cons "textCount" 0) r)))
  ;; system variables
  (setq r (cons (cons "sysvars" (list
    (cons "ltscale" (getvar "ltscale"))
    (cons "dimscale" (getvar "dimscale"))
    (cons "insunits" (getvar "insunits"))
    (cons "measurement" (getvar "measurement"))
    (cons "celtype" (getvar "celtype"))
    (cons "clayer" (getvar "clayer"))
    (cons "cecolor" (getvar "cecolor"))
    (cons "osmode" (getvar "osmode"))
    (cons "snapmode" (getvar "snapmode"))
    (cons "gridmode" (getvar "gridmode"))
    (cons "orthomode" (getvar "orthomode"))
    (cons "plinetype" (getvar "plinetype"))
    (cons "fillmode" (getvar "fillmode"))
    (cons "pickstyle" (getvar "pickstyle"))
  )) r))
  (vl-prin1-to-string (reverse r)))`;

    const resultStr = await cad.sendCommandWithResult(detailedCode);
    const parsed = parseLispRecursive(resultStr);
    if (!parsed || !Array.isArray(parsed)) {
      return { connected: true, error: '分析结果解析失败' };
    }
    const analysis = {};
    for (const pair of parsed) {
      if (Array.isArray(pair) && pair.length >= 2) {
        analysis[String(pair[0])] = pair[1];
      }
    }
    return { connected: true, ...analysis };
  } catch (e) {
    log(`getDrawingAnalysis error: ${e.message}`);
    return { connected: true, error: e.message };
  }
}

function getToolCategories() {
  const cats = {};
  for (const t of tools) {
    const cat = t.annotations?.category || '其他';
    if (!cats[cat]) cats[cat] = { count: 0, tools: [] };
    cats[cat].count++;
    cats[cat].tools.push(t.name);
  }
  return Object.entries(cats).map(([category, info]) => ({
    category, count: info.count, tools: info.tools,
  })).sort((a, b) => b.count - a.count);
}

async function checkDrawingStandards() {
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

function getToolRelationships() {
  return {
    selection: {
      tools: ['select_entities', 'select_all', 'select_last', 'select_by_color', 'find_entities_in_window', 'find_entities_near_point'],
      next: ['batch_delete', 'batch_move', 'batch_copy', 'batch_set_layer', 'batch_set_color', 'batch_set_linetype', 'batch_rotate', 'batch_scale', 'batch_mirror', 'batch_explode', 'batch_match_properties'],
    },
    drawing: {
      tools: ['draw_line', 'draw_circle', 'draw_arc', 'draw_rectangle', 'draw_polygon', 'draw_polyline', 'draw_spline', 'draw_text', 'draw_mtext', 'draw_ellipse'],
      next: ['get_entity', 'set_entity', 'batch_match_properties', 'copy_entity', 'move_entity', 'rotate_entity', 'scale_entity'],
    },
    editing: {
      tools: ['trim_entity', 'extend_entity', 'fillet', 'chamfer', 'break_entity', 'join_entities', 'stretch', 'offset_entity', 'mirror_entity'],
      next: ['get_entity', 'set_entity'],
    },
    batch_ops: {
      tools: ['batch_copy', 'batch_move', 'batch_delete', 'batch_set_layer', 'batch_set_color', 'batch_explode', 'batch_rotate', 'batch_scale'],
      previous: ['select_entities', 'select_all'],
      next: ['save_dwg'],
    },
    export: {
      tools: ['export_pdf', 'export_dxf', 'export_dwf', 'export_svg', 'export_stl', 'export_bmp'],
      previous: ['open_dwg', 'new_document', 'save_dwg'],
      next: [],
    },
    layers: {
      tools: ['create_layer', 'set_layer', 'layer_isolate', 'layer_freeze_all', 'layer_thaw_all', 'layer_lock_all', 'layer_unlock_all', 'layer_merge'],
      next: ['set_current_layer', 'batch_set_layer'],
    },
    blocks: {
      tools: ['get_blocks', 'insert_block', 'explode_block', 'get_block_attributes', 'set_block_attribute', 'get_dynamic_block_properties'],
      previous: ['select_entities'],
      next: ['save_dwg'],
    },
    analysis: {
      tools: ['analyze_lisp_code', 'stream_entities', 'stream_text', 'stream_block_refs', 'get_entity_info', 'get_bounding_box', 'measure_distance', 'measure_area'],
      previous: [],
      next: [],
    },
  };
}

async function getCadSnapshot() {
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

// =============================================================================
// URI Parsing Helpers
// =============================================================================

function parseQuery(uri) {
  const qIdx = uri.indexOf('?');
  if (qIdx === -1) return { base: uri, params: {} };
  const base = uri.substring(0, qIdx);
  const params = {};
  uri.substring(qIdx + 1).split('&').forEach(p => {
    const eqIdx = p.indexOf('=');
    const k = eqIdx === -1 ? p : p.substring(0, eqIdx);
    const v = eqIdx === -1 ? '' : p.substring(eqIdx + 1);
    if (k) params[k] = decodeURIComponent(v);
  });
  return { base, params };
}

function parseTemplateUri(uri) {
  const entityMatch = uri.match(/^atlisp:\/\/dwg\/entity\/([^?]+)$/);
  if (entityMatch) return { type: 'entity', handle: entityMatch[1] };

  const tblMatch = uri.match(/^atlisp:\/\/dwg\/tbl\/([^?]+)$/);
  if (tblMatch) return { type: 'tbl', tblName: tblMatch[1] };

  const blockRefMatch = uri.match(/^atlisp:\/\/dwg\/block-refs\/([^?]+)$/);
  if (blockRefMatch) return { type: 'block-refs', blockName: blockRefMatch[1] };

  return null;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Returns the current state of resources with live CAD data embedded.
 * Queries CAD for entity counts, layer names, DWG info, etc. and enriches
 * resource descriptors with actual data in description and annotations fields.
 */
export async function listResources(subscribedUris = []) {
  let snapshot = null;

  // Attempt to get a live CAD snapshot (fast, non-blocking on failure)
  try {
    const isConnected = cad.connected;
    if (isConnected) {
      snapshot = await getCadSnapshot();
    }
  } catch {
    snapshot = null;
  }

  const hasLive = snapshot && snapshot.cadConnected;

  return RESOURCES.map(r => {
    const entry = {
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
      subscribed: subscribedUris.includes(r.uri),
    };

    if (hasLive) {
      switch (r.uri) {
        case 'atlisp://cad/info':
          entry.description = `CAD 连接信息 (${snapshot.platform || '未知平台'}${snapshot.dwgName ? ', ' + snapshot.dwgName : ''})`;
          break;
        case 'atlisp://dwg/entities':
          entry.description = `图元列表。${snapshot.entityCount} 个实体，${snapshot.layerCount} 个图层。支持 ?type=LINE&layer=0&bbox=0,0,100,100`;
          break;
        case 'atlisp://dwg/name':
          entry.description = `当前 DWG 文件名: ${snapshot.dwgName || '(未命名)'}`;
          break;
        case 'atlisp://dwg/path':
          entry.description = snapshot.dwgPath ? `文件完整路径: ${snapshot.dwgPath}` : '文件完整路径';
          break;
        case 'atlisp://dwg/tbl':
          entry.description = `CAD 表数据 (${snapshot.layerCount} 个图层)。支持路径方式 atlisp://dwg/tbl/layer`;
          break;
        case 'atlisp://dwg/context':
          entry.description = `当前图纸上下文: ${snapshot.dwgName || '(未命名)'}，${snapshot.entityCount} 实体，${snapshot.layerCount} 图层`;
          break;
        default: break;
      }
    }

    return entry;
  });
}

/**
 * Reads a resource by URI.
 * Supports both static URIs and template URIs with path parameters.
 */
export async function readResource(uri) {
  const templateMatch = parseTemplateUri(uri);
  if (templateMatch) {
    if (templateMatch.type === 'entity') {
      return await getEntityByHandle(templateMatch.handle);
    }
    if (templateMatch.type === 'tbl') {
      return await getTables({ tbl: templateMatch.tblName });
    }
    if (templateMatch.type === 'block-refs') {
      const { blockName } = templateMatch;
      const queryIdx = uri.indexOf('?');
      const queryParams = {};
      if (queryIdx !== -1) {
        uri.substring(queryIdx + 1).split('&').forEach(p => {
          const eqIdx = p.indexOf('=');
          const k = eqIdx === -1 ? p : p.substring(0, eqIdx);
          const v = eqIdx === -1 ? '' : p.substring(eqIdx + 1);
          if (k) queryParams[k] = decodeURIComponent(v);
        });
      }
      const refs = await getBlockRefs({ blockName });
      const offset = parseInt(queryParams.offset, 10) || 0;
      const limit = parseInt(queryParams.limit, 10) || 0;
      if (limit > 0 && Array.isArray(refs)) return refs.slice(offset, offset + limit);
      return refs;
    }
  }

  const { base, params } = parseQuery(uri);

  switch (base) {
    case 'atlisp://cad/info':
      return await getCadInfo();
    case 'atlisp://dwg/entities': {
      const entityData = await getEntities(params);
      // Support pagination via offset/limit params
      const offset = parseInt(params.offset, 10) || 0;
      const limit = parseInt(params.limit, 10) || 0;
      if (limit > 0 && Array.isArray(entityData)) {
        return entityData.slice(offset, offset + limit);
      }
      return entityData;
    }
    case 'atlisp://dwg/text-content':
      return await getTextContent(params);
    case 'atlisp://dwg/text-combined':
      return await combineText(params);
    case 'atlisp://dwg/name':
      return await getDwgName();
    case 'atlisp://dwg/path':
      return await getDwgPath();
    case 'atlisp://dwg/block-refs':
      return await getBlockRefs(params);
    case 'atlisp://dwg/tbl':
      return await getTables(params);
    case 'atlisp://cad/dwgs':
      return await getDwgList();
    case 'atlisp://packages':
      return await getPackages(params.name);
    case 'atlisp://platforms':
      return getPlatforms();
    case 'atlisp://standards/drafting':
      return getDraftingStandards();
    case 'atlisp://standards/coding':
      return getCodingStandards();
    case 'atlisp://cad/events':
      return await getCadEvents(params);
    case 'atlisp://dwg/context':
      return await getDwgContext();
    case 'atlisp://tools/relationships':
      return getToolRelationships();
    case 'atlisp://dwg/analysis':
      return await getDrawingAnalysis(params);
    case 'atlisp://tools/categories':
      return getToolCategories();
    case 'atlisp://dwg/standards/check':
      return await checkDrawingStandards();
    default:
      throw new Error(`资源不存在: ${uri}`);
  }
}

export { RESOURCES, clearCache };
