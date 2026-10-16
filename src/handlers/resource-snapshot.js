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

export async function getDrawingAnalysis(_params = {}) {
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
