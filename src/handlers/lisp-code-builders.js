import { TBL_QUERIES, TBL_KEY_ALIAS } from './resource-defs.js';
import { escapeLispString } from '../handler-utils.js';
import { ENTITY_PROPERTIES_LISP, VLA_HELPER_LISP } from './lisp-constants.js';

export function buildEntityPropertiesCode({ type, layer, bbox }) {
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

export function buildTextContentCode({ layer, bbox, offset, limit }) {
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

export function buildBlockRefsCode(filterBlockName, offset = 0, limit = 0) {
  const filterItems = ['(cons 0 "INSERT")'];
  if (filterBlockName) {
    filterItems.push(`(cons 2 "${escapeLispString(filterBlockName)}")`);
  }
  const filterCode = `(list ${filterItems.join(' ')})`;
  // offset/limit 在 CAD 端生效（与 buildTextContentCode 一致）：
  // 大图 2740 个块参照全量 prin1 出来约 543 KB，先在 CAD 内切片只回传所需页，
  // 既省 CAD→worker 的序列化开销，也省 MCP 响应体。
  // limit<=0 表示"不分页"（保留历史行为：一次返回全部），由调用方显式传 limit 触发分页。
  const pageCond = limit > 0 ? `(< (length refs) ${limit})` : 'T';
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
  (list (cons "total" 0) (cons "offset" ${offset}) (cons "limit" ${limit}) (cons "nextOffset" ${offset}) (cons "blockRefs" nil))
  (progn
    (setq total (sslength ss) i ${offset} refs nil)
    (while (and (< i total) ${pageCond})
      (setq r (@br:props (ssname ss i)))
      (if r (setq refs (cons r refs)))
      (setq i (1+ i)))
    ;; nextOffset 是本页扫到的实体下标（绝对位置）：offset 是 ssget 选择集下标而不是
    ;; 返回数组下标，个别块参照读不出属性时两者会漂移，调用方按 nextOffset 翻页才不会重复/漏。
    (list (cons "total" total) (cons "offset" ${offset}) (cons "limit" ${limit})
          (cons "nextOffset" i) (cons "blockRefs" (list (reverse refs)))))))`;
}

/**
 * 生成图纸综合分析 LISP（atlisp://dwg/analysis）。
 *
 * 三个关键点：
 * 1. 所有聚合条目/记录字段统一用 `(list "key" value)` 组装，**不要**用 `(cons "key" value)`：
 *    - value 本身是列表时（如类型直方图），`(cons "k" v)` 会退化成多元素列表 `("k" a b c)`，
 *      服务端按二元对消费时只能取到第 1 个元素，直方图/明细被截断（本次修复的根因）；
 *    - value 是 nil 时，`(cons "k" nil)` 退化成单元素列表 `("k")`，字段会整个丢失
 *      （如 isDynamic=false / 图层不在 layerState 里）。`(list "k" nil)` 则是 `("k" nil)`。
 * 2. 块用量按 INSERT 实体逐一点数，而不是 `(vla-get-Count blockTableRecord)`
 *    —— 后者是块定义内部的实体数（`*Model_Space` 会报 17394），语义完全不同。
 * 3. summary 的 blockUsage 只保留引用数最高的 50 条（大图块种类可能上千）；
 *    detailed 返回全量，便于核对低频块（如只引用 1 次的块）。
 *
 * @param {'summary'|'detailed'} type summary 只回计数/直方图（响应体小）；
 *   detailed 追加图层明细、块定义明细与全量 blockUsage。
 */
export function buildDrawingAnalysisCode(type = 'summary') {
  const wantDetailed = String(type).toLowerCase() === 'detailed';
  // blockUsage 条数上限：summary 50 条，detailed 不截断
  const cap = wantDetailed ? 0 : 50;
  const layersDetail = wantDetailed
    ? '(setq layers (cons (list (list "name" ln) (list "color" (if (< lc 0) (- lc) lc)) (list "off" (< lc 0)) (list "frozen" (= 1 (logand 1 lf))) (list "locked" (= 4 (logand 4 lf))) (list "linetype" ll)) layers))'
    : '';
  const layersOut = wantDetailed ? '(setq r (cons (list "layers" layers) r))' : '';
  const capBlocks = cap > 0
    ? `(if (> (length blocks) ${cap})
  (progn
    (setq capped nil ci 0)
    (while (< ci ${cap}) (setq capped (cons (nth ci blocks) capped) ci (1+ ci)))
    (setq blocks (reverse capped))))`
    : '';
  const blockDefs = wantDetailed
    ? `;; 块定义明细（仅 detailed）：entityCount 才是块定义内部实体数
(setq bdefs nil bdefcount 0)
(vlax-for b bdoc
  (setq bname (@da:vprop b 'Name))
  (if (and bname (/= bname "*Model_Space") (/= bname "*Paper_Space") (= (@da:vprop b 'IsXref) :vlax-false))
    (progn
      (setq bdefs (cons (list (list "name" bname) (list "entityCount" (@da:vprop b 'Count)) (list "isDynamic" (= (@da:vprop b 'IsDynamicBlock) :vlax-true))) bdefs))
      (setq bdefcount (1+ bdefcount)))))
(setq r (cons (list "blockDefCount" bdefcount) r))
(setq r (cons (list "blockDefs" bdefs) r))`
    : '';

  return `(progn
(vl-load-com)
(defun @da:vprop (obj prop / v)
  (setq v (vl-catch-all-apply 'vlax-get-property (list obj prop)))
  (if (vl-catch-all-error-p v) nil v))
(defun @da:isdynamic (bdoc bn / o)
  (setq o (vl-catch-all-apply 'vla-item (list bdoc bn)))
  (if (vl-catch-all-error-p o) nil (= (@da:vprop o 'IsDynamicBlock) :vlax-true)))
;; 记录字段取值的兼容读取：记录条目是 (list "k" v) 时 assoc 得到 ("k" v)，
;; 直接 (cdr ...) 会拿到 (v) 而不是 v，比较/排序时会报「参数类型不正确」。
(defun @da:field (rec key / hit)
  (setq hit (assoc key rec))
  (if (null hit) nil
    (if (listp (cdr hit)) (car (cdr hit)) (cdr hit))))
(setq r nil bdoc (vla-get-blocks (vla-get-activedocument (vlax-get-acad-object))))
;; 1) 实体总数 + 类型直方图（单次遍历）
(if (setq ss (ssget "_X"))
  (progn
    (setq total (sslength ss) i 0 cnt nil)
    (while (< i total)
      (setq typ (cdr (assoc 0 (entget (ssname ss i)))))
      (setq cnt (if (assoc typ cnt) (subst (cons typ (1+ (cdr (assoc typ cnt)))) (assoc typ cnt) cnt) (cons (cons typ 1) cnt)))
      (setq i (1+ i)))
    (setq r (cons (list "entityCount" total) r))
    (setq r (cons (list "entityByType" cnt) r)))
  (progn
    (setq r (cons (list "entityCount" 0) r))
    (setq r (cons (list "entityByType" nil) r))))
;; 2) 块引用次数：按 INSERT 实体真实点数（按引用数降序，summary 截断到 50 条）
(setq bcnt nil breftotal 0)
(if (setq bss (ssget "_X" '((0 . "INSERT"))))
  (progn
    (setq breftotal (sslength bss) bi 0)
    (while (< bi breftotal)
      (setq bn (cdr (assoc 2 (entget (ssname bss bi)))))
      (if bn
        (setq bcnt (if (assoc bn bcnt) (subst (cons bn (1+ (cdr (assoc bn bcnt)))) (assoc bn bcnt) bcnt) (cons (cons bn 1) bcnt))))
      (setq bi (1+ bi)))))
(setq blocks nil)
(foreach bp bcnt
  (setq bn (car bp))
  (if (and (/= bn "*Model_Space") (/= bn "*Paper_Space"))
    (setq blocks (cons (list (list "name" bn) (list "count" (cdr bp)) (list "isDynamic" (@da:isdynamic bdoc bn))) blocks))))
(setq brefcount (length blocks))
(setq blocks (vl-sort blocks '(lambda (a b) (> (@da:field a "count") (@da:field b "count")))))
${capBlocks}
(setq r (cons (list "blockRefCount" breftotal) r))
(setq r (cons (list "blockCount" brefcount) r))
(setq r (cons (list "blockUsage" blocks) r))
;; 3) 图层数量与状态（detailed 时附带图层明细）
(setq lcount 0 loff 0 lfrozen 0 llocked 0 layers nil)
(setq le (tblnext "layer" t))
(while le
  (setq ln (cdr (assoc 2 le)) lc (if (cdr (assoc 62 le)) (cdr (assoc 62 le)) 7)
        lf (if (cdr (assoc 70 le)) (cdr (assoc 70 le)) 0) ll (cdr (assoc 6 le)))
  (if (null ll) (setq ll "Continuous"))
  (setq lcount (1+ lcount))
  (if (< lc 0) (setq loff (1+ loff)))
  (if (= 1 (logand 1 lf)) (setq lfrozen (1+ lfrozen)))
  (if (= 4 (logand 4 lf)) (setq llocked (1+ llocked)))
  ${layersDetail}
  (setq le (tblnext "layer" nil)))
(setq r (cons (list "layerCount" lcount) r))
(setq r (cons (list "layerState" (list (list "off" loff) (list "frozen" lfrozen) (list "locked" llocked))) r))
${layersOut}
;; 4) 文字数量与字高区间
(if (setq ts (ssget "_X" '((0 . "TEXT,MTEXT"))))
  (progn
    (setq tc (sslength ts) th nil ti 0)
    (while (< ti tc)
      (setq h (cdr (assoc 40 (entget (ssname ts ti)))))
      (if h (setq th (cons h th)))
      (setq ti (1+ ti)))
    (setq th (vl-sort th '<))
    (setq r (cons (list "textCount" tc) r))
    (setq r (cons (list "textHeights" (list (list "min" (car th)) (list "max" (last th)) (list "median" (nth (fix (/ (length th) 2)) th)))) r)))
  (progn
    (setq r (cons (list "textCount" 0) r))
    (setq r (cons (list "textHeights" nil) r))))
;; 5) 关键系统变量
(setq r (cons (list "sysvars" (list
  (list "ltscale" (getvar "ltscale"))
  (list "dimscale" (getvar "dimscale"))
  (list "insunits" (getvar "insunits"))
  (list "measurement" (getvar "measurement"))
  (list "celtype" (getvar "celtype"))
  (list "clayer" (getvar "clayer"))
  (list "cecolor" (getvar "cecolor"))
  (list "osmode" (getvar "osmode"))
  (list "snapmode" (getvar "snapmode"))
  (list "gridmode" (getvar "gridmode"))
  (list "orthomode" (getvar "orthomode"))
  (list "plinetype" (getvar "plinetype"))
  (list "fillmode" (getvar "fillmode"))
  (list "pickstyle" (getvar "pickstyle"))
)) r))
${blockDefs}
(vl-prin1-to-string (reverse r)))`;
}

export function buildTablesCode(tblName) {
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

export function parseTableRecord(rec, tableName) {
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
