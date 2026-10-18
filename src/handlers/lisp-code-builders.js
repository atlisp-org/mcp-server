import { TBL_QUERIES, TBL_KEY_ALIAS } from './resource-defs.js';
import { escapeLispString } from '../handler-utils.js';
import { ENTITY_PROPERTIES_LISP, VLA_HELPER_LISP } from './lisp-constants.js';
import { FRAME_STANDARDS } from './frame-standards.js';
import { frameAliasesLisp } from './frame-aliases.js';

// 表定义在 frame-standards.js（叶子模块），此处再导出，保持 lisp-code-builders 的调用方
// 与单测可以直接从这里取到。
export { FRAME_STANDARDS };

// =============================================================================
// 图框识别（atlisp://dwg/frames / list_frames）
// =============================================================================

/**
 * 冻结的标准图框表见 `frame-standards.js`（FRAME_STANDARDS）：**必须与
 * `packages/at-plot/frame-recognition.lsp` 及 lib 侧 `frame:` 命名空间保持同一份数字**，
 * 三处改动需同步。
 */

// 数值字面量格式化：非法/越界一律回落到默认值，避免把 NaN/Infinity 拼进 LISP。
// 另外排除 |v| < 1e-6 的非零值：JS 的 String() 会输出 "1e-7" 这种指数记法，LISP 读不出来。
function lispNumber(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  if (n !== 0 && Math.abs(n) < 1e-6) return fallback;
  return String(n);
}

function parseLayerList(layer) {
  if (typeof layer !== 'string') return [];
  return layer.split(',').map(s => s.trim()).filter(Boolean);
}

function parseScaleList(scales) {
  if (scales === undefined || scales === null || scales === '') return FRAME_STANDARDS.defaultScales;
  const raw = Array.isArray(scales) ? scales : String(scales).split(',');
  const out = [];
  for (const item of raw) {
    const n = Number(item);
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out.length > 0 ? out : FRAME_STANDARDS.defaultScales;
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

// 表 → LISP 字面量列表，如 (210 297 420 594 841)
const lispList = (arr) => `(${arr.join(' ')})`;

/**
 * 生成图框识别 LISP（atlisp://dwg/frames / list_frames）。
 *
 * **完全自包含**：只用 AutoLISP 内建 + 本函数内定义的 `@fr:` 辅助函数，
 * 不调用任何 @lisp lib / 包函数（实测目标 CAD 会话未加载 @lisp lib，
 * `require`、`string:parse-by-lst` 等都不存在，调用会直接报错）。
 *
 * 识别有**两条通道**（属性块优先，因为图签属性比几何推测权威）：
 *  - 几何通道（source="polyline"）：闭合 4 顶点矩形多段线；
 *  - 属性块通道（source="attr-block"）：`INSERT` 中 `vla-get-HasAttributes` 为真的参照，
 *    bbox 用 vla-getboundingbox，比例优先从属性 `比例/出图比例/SCALE` 取（解析出分母），
 *    图幅优先几何匹配、退化时按块名关键词（A0~A4）兜底。
 * 同一位置两者都命中时保留属性块那条，几何那条丢弃（见 @fr:covered）。
 *
 * 识别流程：
 *  1. `ssget "_X"` 只按 DXF 组码 0（+ 可选图层）过滤候选——**必须带 (0 . ...) 过滤**，
 *     全量扫 1.7 万实体会撞上 server 的 MAX_ENTITY_LIMIT=20000 上限；
 *     闭合/4 顶点在 LISP 内筛（原因见 @fr:vcount 注释：旧式 POLYLINE 没有组码 90）。
 *  2. 尺寸用 `vla-getboundingbox`（LWPOLYLINE 的组码 10 是逐顶点的，不能用
 *     `(assoc 10)`/`(assoc 11)` 取对角点），并用 `vl-catch-all-apply` 兜住取不到 bbox 的图元。
 *  3. 矩形判定用「4 顶点 + 两条对角线等长」（同 at-plot `@plot:framep` 的思路），
 *     不用「bbox 与顶点跨度一致」：后者会把旋转矩形整条漏掉，前者只是让它配不上标准表后
 *     落进 unmatched 供人工复核。
 *  4. 图幅解读：`s=min(w,h)`、`r=max/s`，`r` 命中比例表（容差 tolRatio）且
 *     `s = heights[j] × scales[k]`（容差 tolLen×s）。**收集全部一致解读**（`@fr:match-all`，
 *     同 lib `frame:match-all` 语义，按图幅面积降序），首项写 paperSize/elongation/scale，
 *     其余进 `alternatives`（最多 4 项）：A1@1:100 与 A3@1:200 是同一个矩形，几何无法区分，
 *     真实出图比例应以图签属性 `fields.scale` 或图内比例文字为准，**不做长边校验去猜**。
 *  5. 内框去重（includeInner=false 时）：中心点落在其它框 bbox 内且面积更小的框被丢弃，
 *     真图实测外框 84100x59400 与内框 80600x57400 同时被选中，只能留外框。
 *  6. 排序 + 分页：frames 按面积降序后再按 offset/limit 切片（大图优先看到），
 *     响应回填 total/offset/limit/nextOffset（与 atlisp://dwg/block-refs 分页约定一致）。
 *
 * @param {object} [options]
 * @param {string} [options.layer] 图层名，支持英文逗号分隔的多图层（内部按 <OR> 组合）
 * @param {number} [options.minSize=0] 最小短边长度，短于此值的候选直接忽略（frames/unmatched 都不含）
 * @param {number[]|string} [options.scales] 比例表，默认 FRAME_STANDARDS.defaultScales
 * @param {number} [options.tolRatio=0.002] 宽高比绝对容差
 * @param {number} [options.tolLen=0.001] 短边相对容差（相对短边长度）
 * @param {number} [options.offset=0] frames 分页起始下标（排序后）
 * @param {number} [options.limit=0] frames 每页条数，0 = 不分页
 * @param {boolean} [options.includeInner=false] true 则保留内框并标 inner=true
 * @param {boolean} [options.includeUnmatched=true] true 则返回配不上标准表的候选
 */
export function buildFramesCode(options = {}) {
  const layers = parseLayerList(options.layer);
  const minSize = lispNumber(options.minSize, FRAME_STANDARDS.defaultMinSize, { min: 0 });
  const tolRatio = lispNumber(options.tolRatio, FRAME_STANDARDS.defaultTolRatio, { min: 0, max: 1 });
  const tolLen = lispNumber(options.tolLen, FRAME_STANDARDS.defaultTolLen, { min: 0, max: 1 });
  const offset = toPositiveInt(options.offset, 0);
  const limit = toPositiveInt(options.limit, 0);
  const scales = parseScaleList(options.scales);
  const includeInner = options.includeInner === true || options.includeInner === 'true';
  const includeUnmatched = options.includeUnmatched !== false && options.includeUnmatched !== 'false';

  // 图层过滤片段被两个通道共用（几何：多段线；属性块：INSERT）。
  // 多图层用 (-4 . "<OR") 组合，而不是 (cons 8 "A,B")：图层名里的逗号/通配符会被 ssget
  // 当模式字符解释，逐个 (cons 8 name) 更不容易误伤。
  const layerFilter = [];
  if (layers.length === 1) {
    layerFilter.push(`(cons 8 "${escapeLispString(layers[0])}")`);
  } else if (layers.length > 1) {
    layerFilter.push('\'(-4 . "<OR")');
    for (const l of layers) layerFilter.push(`(cons 8 "${escapeLispString(l)}")`);
    layerFilter.push('\'(-4 . "OR>")');
  }
  const polyFilter = `(list ${['(cons 0 "LWPOLYLINE,POLYLINE")', ...layerFilter].join(' ')})`;
  const insFilter = `(list ${['(cons 0 "INSERT")', ...layerFilter].join(' ')})`;

  // includeUnmatched=false 时连排序/截断都省掉，只留空数组，响应更小。
  const unmatchedTail = includeUnmatched
    ? `(setq @fr:unmatched (vl-sort @fr:unmatched '(lambda (a b) (if (equal (* (nth 6 a) (nth 7 a)) (* (nth 6 b) (nth 7 b))) (< (nth 12 a) (nth 12 b)) (> (* (nth 6 a) (nth 7 a)) (* (nth 6 b) (nth 7 b)))))))
(if (> (length @fr:unmatched) @fr:max-unmatched)
  (progn
    (setq @fr:cut nil @fr:n 0)
    (foreach @fr:rec @fr:unmatched
      (if (< @fr:n @fr:max-unmatched) (setq @fr:cut (cons @fr:rec @fr:cut) @fr:n (1+ @fr:n))))
    (setq @fr:unmatched (reverse @fr:cut))))`
    : '(setq @fr:unmatched nil)';

  return `(progn
(vl-load-com)
;; 图框标准表（冻结）：与 packages/at-plot/frame-recognition.lsp、lib 侧 frame: 命名空间同源
(setq @fr:heights '${lispList(FRAME_STANDARDS.heights)})
(setq @fr:papers '${lispList(FRAME_STANDARDS.papers.map(p => `"${p}"`))})
(setq @fr:ratios '${lispList(FRAME_STANDARDS.ratios)})
(setq @fr:marks '${lispList(FRAME_STANDARDS.marks.map(m => `"${m}"`))})
(setq @fr:scales '${lispList(scales)})
(setq @fr:tol-ratio ${tolRatio} @fr:tol-len ${tolLen})
(setq @fr:min-size ${minSize})
(setq @fr:offset ${offset} @fr:limit ${limit})
(setq @fr:inner ${includeInner ? '1' : 'nil'} @fr:max-unmatched ${FRAME_STANDARDS.maxUnmatched})
;; 属性块字段别名表：**必须与 lib frame:aliases 同步**（CAD 侧无 lib，写死一份）
(setq @fr:aliases ${frameAliasesLisp()})

;; bbox：LWPOLYLINE/POLYLINE/INSERT 都可用 vla-getboundingbox；个别图元取不到（损坏/空对象）必须兜住。
(defun @fr:bbox-o (obj / r mn mx)
  (setq r (vl-catch-all-apply 'vla-getboundingbox (list obj 'mn 'mx)))
  (if (vl-catch-all-error-p r) nil
    (list (car (vlax-safearray->list mn)) (cadr (vlax-safearray->list mn))
          (car (vlax-safearray->list mx)) (cadr (vlax-safearray->list mx)))))

(defun @fr:bbox (ent / obj)
  (setq obj (vl-catch-all-apply 'vlax-ename->vla-object (list ent)))
  (if (vl-catch-all-error-p obj) nil (@fr:bbox-o obj)))

;; 顶点数：轻量多段线看组码 90；旧式 POLYLINE 没有 90，
;; 靠实体表数 10 组码也不行（旧式多段线顶点是独立实体，entget 只回 1 个 header 组码 10），
;; 所以退回曲线参数端点（闭合多段线的 endParam 即顶点数）。
(defun @fr:vcount (ent ed / n r)
  (setq n (cdr (assoc 90 ed)))
  (if (and n (> n 0)) n
    (progn
      (setq r (vl-catch-all-apply 'vlax-curve-getEndParam (list ent)))
      (if (vl-catch-all-error-p r) 0 (fix r)))))

;; 4 个顶点坐标（只用于矩形判定）。
;; 注意变量名是 @fr:vpts：AutoLISP 里同一符号如果既绑定了列表值、又被当函数名调用，
;; 运行时会直接报「语法错误」（实测 (setq @fr:pts (list ...)) 之后再 (@fr:pts ...) 即触发），
;; 所以顶点列表变量与函数 @fr:pts 必须用不同符号。
(defun @fr:pts (ent ed / r p k)
  (setq r nil)
  (foreach g ed (if (= 10 (car g)) (setq r (cons (cdr g) r))))
  (setq r (reverse r))
  (if (= 4 (length r)) r
    (progn
      (setq r nil k 0)
      (while (< k 4)
        (setq p (vl-catch-all-apply 'vlax-curve-getPointAtParam (list ent k)))
        (if (vl-catch-all-error-p p) (setq r nil k 99) (setq r (cons p r) k (1+ k))))
      (if (= 4 (length r)) (reverse r) nil))))

;; 矩形判定：4 顶点 + 两对角线等长（容差 0.001×对角线），与 at-plot @plot:framep 同思路。
(defun @fr:rect (pts / d02 d13)
  (if (/= 4 (length pts)) nil
    (progn
      (setq d02 (distance (nth 0 pts) (nth 2 pts)) d13 (distance (nth 1 pts) (nth 3 pts)))
      (and (> d02 0) (equal d02 d13 (* 0.001 d02))))))

;; 图幅解读：返回**全部**几何一致解读 (paperSize elongation scale)，按图幅面积降序（大图/小比例在前）。
;; 同一矩形可有多种解读（实测 1:100 的 A1 与 1:200 的 A3 是同一个矩形，84100x59400 vs 84000x59400
;; 只差 0.12%），几何**无法区分**，所以不做「长边校验」去猜（太脆）：首项给 paperSize/scale，
;; 其余进 alternatives，真实比例应以图签属性 fields.scale 或图内比例文字为准。
;; 语义与 lib frame:match-all 一致；这里手写全序排序（vl-sort 会删掉比较器判为相等的元素，
;; 加序号兜底保证备选解读不会被丢弃）。
(defun @fr:match-all (w h / s l r i j k area res idx)
  (setq s (min w h) l (max w h) r (/ l (float s)) res nil idx 0 i 0)
  (while (< i (length @fr:ratios))
    (if (equal r (nth i @fr:ratios) @fr:tol-ratio)
      (progn
        (setq j 0)
        (while (< j (length @fr:scales))
          (setq k 0)
          (while (< k (length @fr:heights))
            (if (equal s (* (nth k @fr:heights) (float (nth j @fr:scales))) (* @fr:tol-len s))
              (setq res (cons (list (nth k @fr:papers) (nth i @fr:marks) (nth j @fr:scales)
                                    (* (nth k @fr:heights) (nth k @fr:heights) (nth i @fr:ratios)) idx)
                              res)))
            (setq k (1+ k)))
          (setq j (1+ j)))))
    (setq i (1+ i)))
  (if res
    (progn
      (setq res (vl-sort res '(lambda (a b) (if (equal (nth 3 a) (nth 3 b)) (< (nth 4 a) (nth 4 b)) (> (nth 3 a) (nth 3 b))))))
      (mapcar '(lambda (x) (list (nth 0 x) (nth 1 x) (nth 2 x))) res))
    nil))

;; 属性读取（纯 ActiveX，自包含）：HasAttributes 为真时用**方法形式**取属性。
;; 注意 (vla-get-Attributes o) 在本环境报「函数错误」，必须 (vlax-invoke o 'GetAttributes)；
;; vlax-invoke 对数组方法直接返回 VLA-OBJECT 列表（不要再套 vlax-variant-value）。
(defun @fr:attrs (o / atts r a tg vl)
  (setq atts (vl-catch-all-apply 'vlax-invoke (list o 'GetAttributes)))
  (if (vl-catch-all-error-p atts) nil
    (progn
      (setq r nil)
      (foreach a atts
        (setq tg (vl-catch-all-apply 'vla-get-TagString (list a))
              vl (vl-catch-all-apply 'vla-get-TextString (list a)))
        ;; 用 (list tag value) 而不是 (cons tag value)：空串值 (cons "A" "") 在 AutoLISP 里
        ;; prin1 成 (A . )（值被吞掉），服务端解析只剩 tag；且 nil 值 (cons "A" nil) 会退化成 ("A")。
        (setq r (cons (list (if (or (vl-catch-all-error-p tg) (null tg)) "" tg)
                            (if (or (vl-catch-all-error-p vl) (null vl)) "" vl)) r)))
      (reverse r))))

;; tag 归一化：大小写统一 + 去首尾空白（与 lib frame:fields 的匹配规则一致）
(defun @fr:ntag (s) (strcase (vl-string-trim " \\t" s)))

;; tag→value 归一化为语义字段 alist（只含命中字段；同字段取第一个非空命中）。
;; 与 lib frame:fields 同语义；别名表 @fr:aliases 与 frame:aliases 必须同步。
(defun @fr:fields (attrs / res a tag val f al s)
  (setq res nil)
  (foreach a attrs
    (setq tag (car a) val (if (listp (cdr a)) (car (cdr a)) (cdr a)))
    (if (and (= 'STR (type tag)) (= 'STR (type val)) (/= "" val))
      (progn
        (setq tag (@fr:ntag tag) s nil)
        (foreach f @fr:aliases
          (if (null s)
            (foreach al (cdr f)
              (if (equal tag (@fr:ntag al)) (setq s (car f))))))
        (if (and s (null (assoc s res)))
          (setq res (append res (list (cons s val))))))))
  res)

;; 比例值解析："1:200" / "1：200"（全角冒号）/ "200" → 200；无法解析返回 nil
(defun @fr:denom (str / pos s i c)
  (if (/= 'STR (type str)) nil
    (progn
      (setq str (vl-string-trim " \\t" str))
      (setq pos (vl-string-search ":" str))
      (if (null pos) (setq pos (vl-string-search "：" str)))
      (if pos (setq str (substr str (+ pos 2))))
      (setq s "" i 1)
      (while (<= i (strlen str))
        (setq c (substr str i 1))
        (if (and (>= (ascii c) 48) (<= (ascii c) 57)) (setq s (strcat s c)))
        (setq i (1+ i)))
      (if (= s "") nil (atoi s)))))

;; 块名兜底判定图幅：找 A0~A4（A 前不能是字母/数字、后一位不能是数字，"SWA12" 不算）
(defun @fr:paper-of-name (nm / up i ch before nxt hit)
  (setq up (strcase nm) i 1 hit nil)
  (while (and (null hit) (<= i (1- (strlen up))))
    (setq ch (substr up i 2))
    (if (member ch '("A0" "A1" "A2" "A3" "A4"))
      (progn
        (setq before (if (> i 1) (substr up (1- i) 1) "")
              nxt (substr up (+ i 2) 1))
        (if (and (or (= before "")
                     (not (or (and (>= (ascii before) 65) (<= (ascii before) 90))
                              (and (>= (ascii before) 48) (<= (ascii before) 57)))))
                 (or (= nxt "")
                     (not (and (>= (ascii nxt) 48) (<= (ascii nxt) 57)))))
          (setq hit (substr up i 2)))))
    (setq i (1+ i)))
  hit)

;; 块名是否「像图框」：几何匹配不上时才用它决定是否值得进 unmatched（否则 473 个属性块
;; AXIS/WINDOW… 全进 unmatched 会把响应撑爆）。
(defun @fr:frame-name-p (nm / up)
  (setq up (strcase nm))
  (or (@fr:paper-of-name nm)
      (not (null (vl-string-search "TK" up)))
      (not (null (vl-string-search "框" nm)))
      (not (null (vl-string-search "图签" nm)))
      (not (null (vl-string-search "TITLE" up)))))

;; 记录字段顺序（nth 下标）：
;;  0 handle 1 layer 2 x1 3 y1 4 x2 5 y2 6 w 7 h
;;  8 paperSize 9 elongation 10 scale 11 inner 12 序号
;;  13 source("polyline"/"attr-block") 14 blockName 15 attributes 16 fields 17 alternatives
(defun @fr:setidx (rec idx val / out k)
  (setq out nil k 0)
  (foreach x rec (setq out (cons (if (= k idx) val x) out) k (1+ k)))
  (reverse out))

;; 内框判定：中心点落在对方 bbox 内且自身面积**严格更小**。
;; 用严格小于而不是「不更大」：两个完全重合的框（同位置同尺寸的重复图框）否则会互相包含、双双消失。
(defun @fr:contained-p (rec all / cx cy cw ch o hit)
  (setq cx (/ (+ (nth 2 rec) (nth 4 rec)) 2.0) cy (/ (+ (nth 3 rec) (nth 5 rec)) 2.0)
        cw (nth 6 rec) ch (nth 7 rec) hit nil)
  (foreach o all
    (if (and (null hit)
             (/= (nth 0 o) (nth 0 rec))
             (>= cx (nth 2 o)) (<= cx (nth 4 o))
             (>= cy (nth 3 o)) (<= cy (nth 5 o))
             (< (* cw ch) (* (nth 6 o) (nth 7 o))))
      (setq hit 1)))
  hit)

;; 属性块优先：同位置（候选中心点落在属性块图框 bbox 内）的几何候选丢弃。
(defun @fr:covered (rec others / cx cy hit)
  (setq cx (/ (+ (nth 2 rec) (nth 4 rec)) 2.0) cy (/ (+ (nth 3 rec) (nth 5 rec)) 2.0) hit nil)
  (foreach o others
    (if (and (null hit) (>= cx (nth 2 o)) (<= cx (nth 4 o)) (>= cy (nth 3 o)) (<= cy (nth 5 o)))
      (setq hit 1)))
  hit)

;; 输出统一用 (list "key" value)：value 是列表时 (cons "k" v) 会被压平成 ("k" a b c)，
;; value 为 nil 时 (cons "k" nil) 退化成 ("k")，服务端按二元对消费会丢字段。
(defun @fr:emit-frame (rec)
  (list
    (list "handle" (nth 0 rec)) (list "layer" (nth 1 rec))
    (list "bbox" (list (nth 2 rec) (nth 3 rec) (nth 4 rec) (nth 5 rec)))
    (list "width" (nth 6 rec)) (list "height" (nth 7 rec))
    (list "ratio" (/ (max (nth 6 rec) (nth 7 rec)) (float (min (nth 6 rec) (nth 7 rec)))))
    (list "paperSize" (nth 8 rec)) (list "elongation" (nth 9 rec))
    (list "scale" (nth 10 rec)) (list "inner" (nth 11 rec))
    (list "source" (nth 13 rec)) (list "blockName" (nth 14 rec))
    (list "attributes" (nth 15 rec)) (list "fields" (nth 16 rec))
    (list "alternatives" (nth 17 rec))))

(defun @fr:emit-unmatched (rec)
  (list
    (list "handle" (nth 0 rec)) (list "layer" (nth 1 rec))
    (list "bbox" (list (nth 2 rec) (nth 3 rec) (nth 4 rec) (nth 5 rec)))
    (list "width" (nth 6 rec)) (list "height" (nth 7 rec))
    (list "ratio" (/ (max (nth 6 rec) (nth 7 rec)) (float (min (nth 6 rec) (nth 7 rec)))))
    (list "source" (nth 13 rec)) (list "blockName" (nth 14 rec))))

;; ---- 1a) 几何通道：闭合 4 顶点矩形多段线 ----
(setq @fr:cands nil)
(setq @fr:ss (ssget "_X" ${polyFilter})
      @fr:cnt (if @fr:ss (sslength @fr:ss) 0) @fr:i 0)
(while (< @fr:i @fr:cnt)
  (setq @fr:ent (ssname @fr:ss @fr:i) @fr:ed (entget @fr:ent))
  (setq @fr:f70 (cdr (assoc 70 @fr:ed)))
  (if (null @fr:f70) (setq @fr:f70 0))
  (if (and (= 1 (logand 1 @fr:f70)) (= 4 (@fr:vcount @fr:ent @fr:ed)))
    (progn
      (setq @fr:bb (@fr:bbox @fr:ent) @fr:vpts (@fr:pts @fr:ent @fr:ed))
      (if (and @fr:bb @fr:vpts (@fr:rect @fr:vpts))
        (progn
          (setq @fr:w (abs (- (caddr @fr:bb) (car @fr:bb))) @fr:h (abs (- (cadddr @fr:bb) (cadr @fr:bb))))
          (if (and (> @fr:w 0) (> @fr:h 0) (>= (min @fr:w @fr:h) @fr:min-size))
            (progn
              (setq @fr:alts (@fr:match-all @fr:w @fr:h))
              (setq @fr:cands (cons (list (cdr (assoc 5 @fr:ed)) (cdr (assoc 8 @fr:ed))
                                         (car @fr:bb) (cadr @fr:bb) (caddr @fr:bb) (cadddr @fr:bb) @fr:w @fr:h
                                         (if @fr:alts (nth 0 (car @fr:alts)) nil)
                                         (if @fr:alts (nth 1 (car @fr:alts)) "")
                                         (if @fr:alts (nth 2 (car @fr:alts)) nil)
                                         nil (length @fr:cands)
                                         "polyline" nil nil nil
                                         (if @fr:alts (cdr @fr:alts) nil))
                                   @fr:cands))))))))
  (setq @fr:i (1+ @fr:i)))

;; ---- 1b) 属性块通道（优先）：INSERT 且 HasAttributes 为真 ----
(setq @fr:ss (ssget "_X" ${insFilter}))
(if @fr:ss
  (progn
    (setq @fr:cnt (sslength @fr:ss) @fr:i 0)
    (while (< @fr:i @fr:cnt)
      (setq @fr:ent (ssname @fr:ss @fr:i) @fr:ed (entget @fr:ent)
            @fr:o (vl-catch-all-apply 'vlax-ename->vla-object (list @fr:ent)))
      (if (and (not (vl-catch-all-error-p @fr:o))
               (= :vlax-true (vl-catch-all-apply 'vla-get-HasAttributes (list @fr:o))))
        (progn
          (setq @fr:bb (@fr:bbox-o @fr:o))
          (if @fr:bb
            (progn
              (setq @fr:w (abs (- (caddr @fr:bb) (car @fr:bb)))
                    @fr:h (abs (- (cadddr @fr:bb) (cadr @fr:bb)))
                    @fr:bn (cdr (assoc 2 @fr:ed))
                    @fr:atts (@fr:attrs @fr:o)
                    @fr:flds (@fr:fields @fr:atts)
                    @fr:sc (@fr:denom (cdr (assoc "scale" @fr:flds)))
                    @fr:alts (@fr:match-all @fr:w @fr:h))
              (if (and (> @fr:w 0) (> @fr:h 0) (>= (min @fr:w @fr:h) @fr:min-size)
                       (or @fr:alts (@fr:frame-name-p @fr:bn)))
                (setq @fr:cands (cons (list (cdr (assoc 5 @fr:ed)) (cdr (assoc 8 @fr:ed))
                                           (car @fr:bb) (cadr @fr:bb) (caddr @fr:bb) (cadddr @fr:bb)
                                           @fr:w @fr:h
                                           ;; 图幅优先几何，几何不中退回块名关键词
                                           (if @fr:alts (nth 0 (car @fr:alts)) (@fr:paper-of-name @fr:bn))
                                           (if @fr:alts (nth 1 (car @fr:alts)) "")
                                           ;; 比例优先从属性取（属性比几何推测权威）
                                           (if @fr:sc @fr:sc (if @fr:alts (nth 2 (car @fr:alts)) nil))
                                           nil (length @fr:cands)
                                           "attr-block" @fr:bn @fr:atts @fr:flds
                                           (if @fr:alts (cdr @fr:alts) nil))
                                     @fr:cands)))))))
      (setq @fr:i (1+ @fr:i)))))

;; ---- 2) 属性块优先去重：同位置的几何候选丢弃（属性块信息更权威）----
(setq @fr:abf nil)
(foreach @fr:rec @fr:cands
  (if (and (equal (nth 13 @fr:rec) "attr-block") (nth 8 @fr:rec) (nth 10 @fr:rec))
    (setq @fr:abf (cons @fr:rec @fr:abf))))
(setq @fr:keep nil)
(foreach @fr:rec @fr:cands
  (if (or (not (equal (nth 13 @fr:rec) "polyline")) (null @fr:abf) (not (@fr:covered @fr:rec @fr:abf)))
    (setq @fr:keep (cons @fr:rec @fr:keep))))
(setq @fr:cands (reverse @fr:keep))

;; ---- 3) 内框标记 + 分组 ----
(setq @fr:all nil)
(foreach @fr:rec @fr:cands
  (setq @fr:all (cons (if (@fr:contained-p @fr:rec @fr:cands) (@fr:setidx @fr:rec 11 1) @fr:rec) @fr:all)))
(setq @fr:frames nil @fr:unmatched nil)
(foreach @fr:rec @fr:all
  (if (or @fr:inner (not (nth 11 @fr:rec)))
    (if (and (nth 8 @fr:rec) (nth 10 @fr:rec))
      (setq @fr:frames (cons @fr:rec @fr:frames))
      (setq @fr:unmatched (cons @fr:rec @fr:unmatched)))))

;; ---- 4) 排序（面积降序）+ unmatched 截断 ----
;; vl-sort 会删掉「比较器判为相等」的元素，所以比较器必须带序号兜底，保证是全序。
(setq @fr:frames (vl-sort @fr:frames '(lambda (a b) (if (equal (* (nth 6 a) (nth 7 a)) (* (nth 6 b) (nth 7 b))) (< (nth 12 a) (nth 12 b)) (> (* (nth 6 a) (nth 7 a)) (* (nth 6 b) (nth 7 b)))))))
(setq @fr:total (length @fr:frames))
${unmatchedTail}

;; ---- 5) 分页切片（在排序后的 frames 上） ----
(setq @fr:page nil @fr:k @fr:offset @fr:n 0)
(while (and (< @fr:k @fr:total) (or (= @fr:limit 0) (< @fr:n @fr:limit)))
  (setq @fr:page (cons (nth @fr:k @fr:frames) @fr:page) @fr:k (1+ @fr:k) @fr:n (1+ @fr:n)))
(setq @fr:page (reverse @fr:page))

(vl-prin1-to-string
  (list (list "total" @fr:total) (list "offset" @fr:offset) (list "limit" @fr:limit)
        (list "nextOffset" (+ @fr:offset (length @fr:page)))
        (list "frames" (mapcar '@fr:emit-frame @fr:page))
        (list "unmatched" (mapcar '@fr:emit-unmatched @fr:unmatched)))))`;
}

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
    /* 天正自定义文字对象：不查它们，天正图纸的图名/说明会整段缺失。 */
    `'(0 . "TCH_TEXT")`,
    `'(0 . "TCH_MTEXT")`,
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
      (setq typ (cdr (assoc 0 ed)) lay (cdr (assoc 8 ed))
            h (cdr (assoc 40 ed)) txt (cdr (assoc 1 ed)))
      (if (null h) (setq h 2.5))
      (if (null ins) (setq ins (list 0.0 0.0 0.0)))
      (setq texts (append texts (list (list
        "text" (if (null txt) "" (vl-prin1-to-string txt))
        "type" (if (null typ) "" typ)
        "layer" (if (null lay) "" lay)
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
  const pageCond = limit > 0 ? `(< (length refs) ${limit})` : '1';
  return `(progn
(vl-load-com)

;; 属性读取：**纯 ActiveX、自包含**。
;; 目标 CAD 会话没有加载 @lisp lib（(member 'require (atoms-family 1)) -> nil），
;; 原实现调 lib 的 block:get-attributes 会直接报错、被 vl-catch-all 吞掉 -> 属性恒为 nil；
;; 且 (vla-get-Attributes o) 在此环境报「函数错误」，必须用方法形式 (vlax-invoke o 'GetAttributes)。
;; 返回 (status . pairs)：0 = 无属性（HasAttributes 为假）；1 = 成功（pairs 为 (tag . value) 列表）；
;;                        2 = 有属性但读取失败（调用方置 attrReadFailed，不再静默吞错）。
(defun @br:attrs (o / atts r a tg vl)
  (if (/= :vlax-true (vl-catch-all-apply 'vla-get-HasAttributes (list o))) (cons 0 nil)
    (progn
      (setq atts (vl-catch-all-apply 'vlax-invoke (list o 'GetAttributes)))
      (if (vl-catch-all-error-p atts) (cons 2 nil)
        (progn
          (setq r nil)
          (foreach a atts
            (setq tg (vl-catch-all-apply 'vla-get-TagString (list a))
                  vl (vl-catch-all-apply 'vla-get-TextString (list a)))
            ;; (list tag value) 而不是 (cons tag value)：空串值 (cons "A" "") prin1 成 (A . )，
            ;; 值会被吞掉、服务端只剩 tag（实测 25 个空值属性就是这样丢的）。
            (setq r (cons (list (if (or (vl-catch-all-error-p tg) (null tg)) "" tg)
                                (if (or (vl-catch-all-error-p vl) (null vl)) "" vl)) r)))
          (cons 1 (reverse r)))))))

;; 动态块特性：同样是 lib 的 block:get-properties 在本会话不存在（原来恒为 nil），一并改成纯 ActiveX。
(defun @br:dynprops (o / props r p nm vl)
  (if (/= :vlax-true (vl-catch-all-apply 'vla-get-IsDynamicBlock (list o))) nil
    (progn
      (setq props (vl-catch-all-apply 'vlax-invoke (list o 'GetDynamicBlockProperties)))
      (if (vl-catch-all-error-p props) nil
        (progn
          (setq r nil)
          (foreach p props
            (setq nm (vl-catch-all-apply 'vla-get-PropertyName (list p))
                  vl (vl-catch-all-apply 'vla-get-Value (list p)))
            (setq r (cons (list (if (or (vl-catch-all-error-p nm) (null nm)) "" nm)
                                (if (vl-catch-all-error-p vl) "" (vl-princ-to-string vl))) r)))
          (reverse r))))))

;; 记录统一用 (list "key" value)：value 为 nil 时 (cons "k" nil) 会退化成 ("k")，
;; 服务端按二元对消费会**整个丢字段**（无属性的块参照正是这种情形）。
(defun @br:props (ent / ed o r af p10 p50 p41 p42 p43)
  (setq ed (entget ent)
        p10 (cdr (assoc 10 ed))
        p50 (cdr (assoc 50 ed))
        p41 (cdr (assoc 41 ed))
        p42 (cdr (assoc 42 ed))
        p43 (cdr (assoc 43 ed))
        o (vl-catch-all-apply 'vlax-ename->vla-object (list ent)))
  (if (vl-catch-all-error-p o) (list (list "handle" (cdr (assoc 5 ed))))
    (progn
      (setq af (@br:attrs o))
      (setq r (list
                (list "handle" (cdr (assoc 5 ed)))
                (list "layer" (cdr (assoc 8 ed)))
                (list "blockName" (cdr (assoc 2 ed)))
                (list "effectiveBlockName" (cdr (assoc 2 ed)))
                (list "insertionPoint" (list (car p10) (cadr p10) (caddr p10)))
                (list "rotation" p50)
                (list "scale" (list p41 p42 p43))
                (list "attributes" (if (= 1 (car af)) (cdr af) nil))
                (list "dynamicProperties" (@br:dynprops o))))
      ;; 属性读取失败要**可见**：附加 attrReadFailed，调用方据此判断（而不是当成"无属性"）
      (if (= 2 (car af)) (setq r (append r (list (list "attrReadFailed" 1)))))
      r)))

(setq ss (ssget "_X" ${filterCode}))
;; 输出统一走 (vl-prin1-to-string ...)：worker 用 (princ r f) 写结果，直接 princ 一个 list
;; 会把字符串的引号去掉（含空串的属性值 "A"="" 会整段消失、块名带空格会被拆成多个原子）。
;; 先 prin1 成字符串再交给 worker，字符串/空串/空格都完整保留。
(vl-prin1-to-string
  (if (null ss)
    (list (list "total" 0) (list "offset" ${offset}) (list "limit" ${limit}) (list "nextOffset" ${offset}) (list "blockRefs" nil))
    (progn
      (setq total (sslength ss) i ${offset} refs nil)
      (while (and (< i total) ${pageCond})
        (setq r (@br:props (ssname ss i)))
        (if r (setq refs (cons r refs)))
        (setq i (1+ i)))
      ;; nextOffset 是本页扫到的实体下标（绝对位置）：offset 是 ssget 选择集下标而不是
      ;; 返回数组下标，个别块参照读不出属性时两者会漂移，调用方按 nextOffset 翻页才不会重复/漏。
      (list (list "total" total) (list "offset" ${offset}) (list "limit" ${limit})
            (list "nextOffset" i) (list "blockRefs" (reverse refs)))))))`;
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
  const normalized = String(type).toLowerCase();
  const wantDetailed = normalized === 'detailed';
  /* facts = summary 的统计 + 图层明细（不含 blockDefs）；给浏览器/agent 一次取齐。 */
  const wantFacts = normalized === 'facts' || wantDetailed;
  // blockUsage 条数上限：summary/facts 50 条，detailed 不截断
  const cap = wantDetailed ? 0 : 50;
  const layersDetail = wantFacts
    ? '(setq layers (cons (list (list "name" ln) (list "color" (if (< lc 0) (- lc) lc)) (list "off" (< lc 0)) (list "frozen" (= 1 (logand 1 lf))) (list "locked" (= 4 (logand 4 lf))) (list "linetype" ll)) layers))'
    : '';
  const layersOut = wantFacts ? '(setq r (cons (list "layers" layers) r))' : '';
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
;; 4) 文字数量 / 字高 / 类型分布 / 图层分布（单次遍历）
(setq tcnt nil tlays nil)
(if (setq ts (ssget "_X" '((0 . "TEXT,MTEXT,ATTRIB,TCH_TEXT,TCH_MTEXT"))))
  (progn
    (setq tc (sslength ts) th nil ti 0)
    (while (< ti tc)
      (setq ed (entget (ssname ts ti)))
      (setq typ (cdr (assoc 0 ed)) lay (cdr (assoc 8 ed)) h (cdr (assoc 40 ed)))
      (if h (setq th (cons h th)))
      (if typ (setq tcnt (if (assoc typ tcnt) (subst (cons typ (1+ (cdr (assoc typ tcnt)))) (assoc typ tcnt) tcnt) (cons (cons typ 1) tcnt))))
      (if lay (setq tlays (if (assoc lay tlays) (subst (cons lay (1+ (cdr (assoc lay tlays)))) (assoc lay tlays) tlays) (cons (cons lay 1) tlays))))
      (setq ti (1+ ti)))
    (setq th (vl-sort th '<))
    (setq r (cons (list "textCount" tc) r))
    (setq r (cons (list "textTypes" tcnt) r))
    (setq r (cons (list "textLayers" tlays) r))
    (setq r (cons (list "textHeights" (list (list "min" (car th)) (list "max" (last th)) (list "median" (nth (fix (/ (length th) 2)) th)))) r)))
  (progn
    (setq r (cons (list "textCount" 0) r))
    (setq r (cons (list "textTypes" nil) r))
    (setq r (cons (list "textLayers" nil) r))
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
