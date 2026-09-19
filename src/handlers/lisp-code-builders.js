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

export function buildBlockRefsCode(filterBlockName) {
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
