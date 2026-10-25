import { cad } from '../cad.js';
import { getCached, setCache } from './resource-cache.js';
import { log } from '../logger.js';
import { parseLispRecursive, escapeLispString } from '../handler-utils.js';
import { ensureCad } from './resource-utils.js';
import { tools } from '../tools/index.js';
import { computeEffectivePriority, prioRank } from '../tools/params-utils.js';
import { getAuditStats } from '../audit-log.js';
import { getDraftingStandards } from './standards-readers.js';

export async function getCadEvents(_params) {
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

// getDrawingAnalysis 的唯一实现在 resource-snapshot.js（资源与 handler 共用，
// 避免两处 LISP/解析逻辑漂移）。此处仅再导出，供 handler 自动发现使用。
export { getDrawingAnalysis } from './resource-snapshot.js';

export function getToolCategories() {
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

export function getToolIndustries(name) {
  const usage = (() => { try { return getAuditStats()?.tools || {}; } catch { return {}; } })();
  const byIndustry = {};
  for (const t of tools) {
    const inds = t.annotations?.industry || ['通用'];
    for (const ind of inds) {
      if (!byIndustry[ind]) byIndustry[ind] = { count: 0, tools: [] };
      byIndustry[ind].count++;
      const usageCount = usage[t.name] ?? 0;
      byIndustry[ind].tools.push({
        name: t.name,
        priority: t.annotations?.priority || 'common',
        effectivePriority: computeEffectivePriority(t.annotations?.priority || 'common', usageCount).priority,
        hot: computeEffectivePriority(t.annotations?.priority || 'common', usageCount).hot,
        description: (t.description || '').split('\n')[0].replace(/【类别】.*$/, '').trim(),
        usageCount,
      });
    }
  }
  const entries = Object.entries(byIndustry).map(([industry, info]) => ({ industry, ...info }))
    .sort((a, b) => b.count - a.count);
  if (!name) return entries;
  const hit = entries.find(e => e.industry === name);
  if (!hit) return { error: `未找到行业: ${name}` };
  hit.tools.sort((x, y) => {
    const pr = prioRank(x.effectivePriority) - prioRank(y.effectivePriority);
    if (pr !== 0) return pr;
    return (y.usageCount ?? 0) - (x.usageCount ?? 0);
  });
  return hit;
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

/**
 * 只读重复实体检查：同类型 + 同图层 + 同几何签名。
 *
 * 以往这类需求每次都让模型现写 LISP，容差和判定口径都不统一（记忆里一周问了
 * 5 次）。这里把签名/分组做成确定性实现，只返回清单，不删除任何东西。
 */
export async function cadDuplicates(params = {}) {
  await ensureCad();
  const types = Array.isArray(params.types)
    ? params.types.map((t) => String(t).trim().toUpperCase()).filter(Boolean)
    : [];
  const tolerance = Number.isFinite(Number(params.tolerance)) && Number(params.tolerance) > 0
    ? Number(params.tolerance)
    : 1e-6;
  const maxGroups = Math.min(500, Math.max(1, Number(params.maxGroups) || 50));

  const typeFilter = types.length
    ? `(list '(-4 . "<OR") ${types.map((t) => `(cons 0 "${escapeLispString(t)}")`).join(' ')} '(-4 . "OR>"))`
    : null;
  const selection = typeFilter ? `(ssget "_X" ${typeFilter})` : '(ssget "_X")';

  const code = `(progn
  (vl-load-com)
  (setq tol ${tolerance})
  (defun @dup:norm (v)
    (if (numberp v) (* tol (fix (+ 0.5 (/ v tol)))) v))
  (defun @dup:key (e / ed k)
    (setq ed (entget e))
    (setq k (list (cdr (assoc 0 ed)) (cdr (assoc 8 ed))))
    (foreach pair ed
      (if (member (car pair) '(10 11 40 50 51 1 2 41 42 43 70 90))
        (setq k (append k (list (@dup:norm (cdr pair)))))))
    (vl-princ-to-string k))
  (setq ss ${selection} groups nil n 0)
  (if ss
    (progn
      (setq i (sslength ss))
      (repeat i
        (setq i (1- i))
        (setq e (ssname ss i))
        (setq k (@dup:key e))
        (setq h (cdr (assoc 5 (entget e))))
        (if (setq g (assoc k groups))
          (setq groups (subst (cons k (cons h (cdr g))) g groups))
          (setq groups (cons (list k h) groups))))))
  (setq out "" n 0)
  (foreach g groups
    (if (and (> (length g) 2) (< n ${maxGroups}))
      (progn
        (setq n (1+ n))
        (setq out (strcat out "\\n" (car g) " => " (vl-princ-to-string (cdr g)))))))
  (strcat "重复实体组: " (itoa n) "（最多显示 ${maxGroups} 组；tol=${tolerance}）" out)
)`;

  try {
    const result = await cad.sendCommandWithResult(code);
    const text = String(result ?? '').replace(/^"|"$/g, '');
    return { content: [{ type: 'text', text: text || '检查完成，无输出' }] };
  } catch (e) {
    return { content: [{ type: 'text', text: `检查重复实体失败: ${e.message}` }], isError: true };
  }
}

export function getToolRelationships() {
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
