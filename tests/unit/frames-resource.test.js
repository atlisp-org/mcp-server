// atlisp://dwg/frames 图框识别覆盖：
//   - buildFramesCode：双路径（lib 探测 → frame:* 优先，缺失/出错回落自包含内联实现）、括号平衡、
//     图层过滤、ssget 必带组码过滤、参数回落、includeInner/includeUnmatched 分支、
//     非属性块通道 / 包围盒回退 / 图签散文字补全（仅 lib 路径）
//   - 归一化：规范/历史压平结构、ratio 4 位小数、elongation 空串保留、inner 布尔转换、
//     source 三通道（attr-block/block/polyline）与去重优先级、lib 路径标记
//   - getFrames：分页回填、缓存、CAD 未连接、解析失败
//   - listFrames：content(JSON) + structuredContent 双输出
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cadMock = vi.hoisted(() => ({
  connected: true,
  connect: vi.fn(async () => true),
  getPlatform: vi.fn(() => 'AutoCAD'),
  getVersion: vi.fn(() => '24.1s'),
  sendCommandWithResult: vi.fn(),
}));

vi.mock('../../src/cad.js', () => ({
  cad: cadMock,
  getActiveConnection: () => cadMock,
  resolveCadConnection: () => cadMock,
  onDocumentChanged: vi.fn(),
}));
vi.mock('../../src/logger.js', () => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  closeLog: vi.fn(),
}));

const {
  buildDrawingAnalysisCode,
  buildFramesCode,
  FRAME_STANDARDS,
} = await import('../../src/handlers/lisp-code-builders.js');
const {
  getFrames,
  normalizeFramesPayload,
  normalizeFrameRecord,
  buildFramesOptions,
} = await import('../../src/handlers/resource-snapshot.js');
const { listFrames } = await import('../../src/handlers/frame-handlers.js');
const { readResource } = await import('../../src/handlers/resource-handlers.js');
const { clearCache } = await import('../../src/handlers/resource-cache.js');
const { checkParens } = await import('../../src/lisp-security.js');
const { FRAME_FIELD_ALIASES, frameAliasesLisp } = await import('../../src/handlers/frame-aliases.js');

// 真机（地下车库.dwg，PUB_TITLE 层）实测输出的截断形态：外框 84100x59400 + 加长 126100x59400，
// unmatched 里是「像 +1 加长图但比例差 0.003」的 336400x118800。
const LIVE_LIKE = '(("total" 2) ("offset" 0) ("limit" 500) ("nextOffset" 2)'
  + ' ("frames" ('
  + '(("handle" "51EB") ("layer" "PUB_TITLE") ("bbox" (1561029.16 404844.42 1645129.16 464244.42))'
  + ' ("width" 84100.0) ("height" 59400.0) ("ratio" 1.4158249) ("paperSize" "A1")'
  + ' ("elongation" "") ("scale" 100) ("inner" nil))'
  + '(("handle" "4BD2") ("layer" "PUB_TITLE") ("bbox" (1511008.0 209701.0 1637108.0 269101.0))'
  + ' ("width" 126100.0) ("height" 59400.0) ("ratio" 2.1228956) ("paperSize" "A1")'
  + ' ("elongation" "+1/2") ("scale" 100) ("inner" T))))'
  + ' ("unmatched" ('
  + '(("handle" "4BC7") ("layer" "PUB_TITLE") ("bbox" (1574710.0 -60315.1 1911110.0 58484.9))'
  + ' ("width" 336400.0) ("height" 118800.0) ("ratio" 2.831649)))))';

// 压平结构：value 全为标量时（旧代码用 (cons "k" v) 会把记录压成 ("k" v "k" v ...)），
// 归一化要能按平铺键值对消费，而不是当成 1 条只有 handle 的残缺记录。
const FLATTENED = '(("total" 1)'
  + ' ("frames" ("handle" "51EB" "layer" "PUB_TITLE"'
  + ' "width" 84100.0 "height" 59400.0 "ratio" 1.4158249 "paperSize" "A1"'
  + ' "elongation" "" "scale" 100 "inner" :vlax-true))'
  + ' ("unmatched" nil))';

let sentCodes = [];

beforeEach(() => {
  vi.clearAllMocks();
  clearCache();
  cadMock.connected = true;
  cadMock.connect.mockImplementation(async () => true);
  sentCodes = [];
  cadMock.sendCommandWithResult.mockImplementation(async (code) => {
    sentCodes.push(code);
    return LIVE_LIKE;
  });
});

describe('buildFramesCode', () => {
  it('双路径：探测 lib（字符串比对）后优先调 frame:*，缺失/出错回落自包含内联实现', () => {
    const code = buildFramesCode({ layer: 'PUB_TITLE' });
    expect(code.startsWith('(progn')).toBe(true);
    expect(code).toContain('(vl-load-com)');
    expect(code).toContain('(defun @fr:bbox');
    expect(code).toContain('(defun @fr:match-all');
    // lib 探测：atoms-family 的 format=1 返回**字符串**，必须按字符串比对（符号比对恒 nil）
    expect(code).toContain('(member "FRAME:MATCH-ALL" (atoms-family 1))');
    expect(code).toContain('(member "FRAME:REF-BOX" (atoms-family 1))');
    expect(code).toContain('(member "FRAME:TITLE-FIELDS" (atoms-family 1))');
    // 不调 frame:ref-p：旧版实现误用 AutoLISP 不存在的 let（真机报 no function definition）
    expect(code).not.toContain("'frame:ref-p");
    // 优先 lib：match-all/fields 分发到 frame:*，出错/缺失回落 *-raw 内联实现
    expect(code).toContain("'frame:match-all");
    expect(code).toContain('(@fr:match-all-raw w h)');
    expect(code).toContain("'frame:fields");
    expect(code).toContain('(@fr:fields-raw attrs)');
    // 回落路径的自包含约束：不出现 require / 字符串解析等硬依赖（lib 调用都在 @fr:lib 守卫内）
    for (const hardDep of ['(require', 'string:parse-by-lst', 'pickset:', 'entity:getdxf', 'layer:', 'ui:']) {
      expect(code).not.toContain(hardDep);
    }
  });

  it('lib 路径增强：非属性块通道 / 包围盒回退 / 图签散文字补全（全部受 @fr:lib 守卫）', () => {
    const code = buildFramesCode({ layer: 'PUB_TITLE' });
    // 1c 非属性块通道：块名去重 + 包围盒/match-all 判定 + 准入（短边>=2000 或图签文字指纹）
    expect(code).toContain('"block" @fr:bn');
    expect(code).toContain("'frame:ref-box");
    expect(code).toContain("'frame:title-block-p");
    expect(code).toContain('(>= (min @fr:w @fr:h) 2000)');
    expect(code).toContain('(not (wcmatch @fr:bn');
    expect(code.indexOf('"block" @fr:bn')).toBeGreaterThan(code.indexOf('(if @fr:lib'));
    // 包围盒回退：vla-getboundingbox 失败时用 frame:ref-box（BCS→WCS）
    expect(code).toContain('(defun @fr:bbox-ref');
    expect(code).toContain("'frame:ref-box");
    // 图签散文字补全：frame:title-fields 配对 + 属性优先合并（只补缺失键）
    expect(code).toContain("'frame:title-fields");
    expect(code).toContain('(defun @fr:title-text-fields');
    expect(code).toContain('(defun @fr:merge-fields');
    expect(code).toContain('(@fr:setidx @fr:rec 16');
  });

  it('括号平衡（CAD 侧按括号数解析，缺一个就是"括号错误"）', () => {
    for (const opts of [{}, { layer: 'A,B' }, { includeInner: true }, { includeUnmatched: false }]) {
      expect(checkParens(buildFramesCode(opts)).valid).toBe(true);
    }
  });

  it('候选必须带组码 0 过滤（全量 ssget 会撞 MAX_ENTITY_LIMIT=20000）', () => {
    const code = buildFramesCode({});
    expect(code).toContain('(ssget "_X" (list (cons 0 "LWPOLYLINE,POLYLINE")))');
    expect(code).not.toContain('(ssget "_X")\n');
    // 闭合/4 顶点在 LISP 内筛（旧式 POLYLINE 没有组码 90，不能全靠 ssget 过滤）
    expect(code).toContain('(defun @fr:vcount');
    expect(code).toContain('(logand 1 @fr:f70)');
  });

  it('尺寸用 vla-getboundingbox + vl-catch-all-apply，不用 (assoc 10) 取对角点', () => {
    const code = buildFramesCode({});
    expect(code).toContain("'vla-getboundingbox");
    expect(code).toContain('vl-catch-all-error-p');
    expect(code).not.toContain('(assoc 11');
    // 顶点列表变量不能与函数 @fr:pts 同名（同名会触发 AutoLISP「语法错误」）
    expect(code).toContain('(setq @fr:bb (@fr:bbox @fr:ent) @fr:vpts (@fr:pts @fr:ent @fr:ed))');
  });

  it('单图层用 (cons 8)，多图层用 (-4 . "<OR") 组合', () => {
    expect(buildFramesCode({ layer: 'PUB_TITLE' })).toContain('(cons 8 "PUB_TITLE")');
    const multi = buildFramesCode({ layer: 'PUB_TITLE, 图框 ' });
    expect(multi).toContain('\'(-4 . "<OR")');
    expect(multi).toContain('(cons 8 "PUB_TITLE")');
    expect(multi).toContain('(cons 8 "图框")');
    expect(multi).toContain('\'(-4 . "OR>")');
    expect(buildFramesCode({})).not.toContain('(cons 8');
  });

  it('冻结标准表原样写入（与 at-plot / lib 侧 frame: 同源）', () => {
    const code = buildFramesCode({});
    expect(code).toContain("(setq @fr:heights '(210 297 420 594 841))");
    expect(code).toContain("(setq @fr:ratios '(1.41429 1.76786 2.12143 2.475 2.82857 3.18214 3.53571))");
    expect(code).toContain('(setq @fr:marks \'("" "+1/4" "+1/2" "+3/4" "+1" "+5/4" "+3/2"))');
    expect(code).toContain('(setq @fr:scales \'(1 5 10 20 25 30 40 50 70 100 120 150 200 250 300 400 500 1000))');
    expect(code).toContain('(setq @fr:tol-ratio 0.002 @fr:tol-len 0.001)');
  });

  it('自定义比例表替换默认表；非法值回落默认值', () => {
    expect(buildFramesCode({ scales: [1, 50, 100] })).toContain("(setq @fr:scales '(1 50 100))");
    expect(buildFramesCode({ scales: '20,30' })).toContain("(setq @fr:scales '(20 30))");
    expect(buildFramesCode({ scales: [] })).toContain("(setq @fr:scales '(1 5 10 20");
    // NaN/负数/指数记法都不能拼进 LISP（否则 CAD 侧读到的字面量非法）；0 是合法的（精确匹配）
    const bad = buildFramesCode({ minSize: -5, tolRatio: 'abc', tolLen: -1, offset: -3, limit: NaN });
    expect(bad).toContain('(setq @fr:min-size 0)');
    expect(bad).toContain('(setq @fr:tol-ratio 0.002 @fr:tol-len 0.001)');
    expect(bad).toContain('(setq @fr:offset 0 @fr:limit 0)');
    expect(bad).not.toContain('NaN');
    // tolLen=0 表示精确匹配，应原样写入；但 1e-7 这种会输出指数记法的值必须回落
    expect(buildFramesCode({ tolLen: 0 })).toContain('@fr:tol-len 0)');
    expect(buildFramesCode({ tolRatio: 1e-7 })).toContain('@fr:tol-ratio 0.002');
  });

  it('includeInner / includeUnmatched 控制内框保留与 unmatched 收集', () => {
    expect(buildFramesCode({})).toContain('(setq @fr:inner nil');
    expect(buildFramesCode({ includeInner: true })).toContain('(setq @fr:inner 1');
    expect(buildFramesCode({})).toContain('(list "unmatched" (mapcar \'@fr:emit-unmatched');
    expect(buildFramesCode({ includeUnmatched: false })).toContain('(setq @fr:unmatched nil)');
  });

  it('属性块通道：扫 INSERT + HasAttributes + 纯 ActiveX 读属性 + 别名表写死', () => {
    const code = buildFramesCode({});
    // 第二通道扫 INSERT（几何通道扫多段线）
    expect(code).toContain('(ssget "_X" (list (cons 0 "INSERT")))');
    expect(code).toContain("'vla-get-HasAttributes");
    // vla-get-Attributes 在本环境报「函数错误」，必须用方法形式
    expect(code).toContain("(vl-catch-all-apply 'vlax-invoke (list o 'GetAttributes))");
    // 字段别名表必须内联（CAD 侧无 lib，不能调 frame:aliases）
    expect(code).toContain('(setq @fr:aliases');
    expect(code).toContain('("title" "图名"');
    expect(code).toContain('("discipline" "专业" "DISCIPLINE")');
    // 属性块记录带 source/blockName/attributes/fields/alternatives
    expect(code).toContain('(list "source" (nth 13 rec))');
    expect(code).toContain('(list "blockName" (nth 14 rec))');
    expect(code).toContain('(list "attributes" (nth 15 rec))');
    expect(code).toContain('(list "fields" (nth 16 rec))');
    expect(code).toContain('(list "alternatives" (nth 17 rec))');
    // 通道优先级：属性块图框覆盖处的几何候选丢弃
    expect(code).toContain('(defun @fr:covered');
    expect(code).toContain('"attr-block"');
  });

  it('图层过滤同时作用于两个通道；比例从属性解析、块名兜底', () => {
    const code = buildFramesCode({ layer: 'PUB_TITLE' });
    expect(code).toContain('(ssget "_X" (list (cons 0 "INSERT") (cons 8 "PUB_TITLE")))');
    expect(code).toContain('(ssget "_X" (list (cons 0 "LWPOLYLINE,POLYLINE") (cons 8 "PUB_TITLE")))');
    // 比例解析（全角冒号也支持）与块名兜底
    expect(code).toContain('(defun @fr:denom');
    expect(code).toContain('(defun @fr:paper-of-name');
    expect(code).toContain("(vl-string-search \"：\" str)");
  });

  it('几何歧义：收集全部解读（alternatives），不做长边校验去猜', () => {
    const code = buildFramesCode({});
    expect(code).toContain('(defun @fr:match-all');
    // 全序排序 + 加序号兜底（vl-sort 会删掉比较器判为相等的元素）
    expect(code).toContain('(if (equal (nth 3 a) (nth 3 b)) (< (nth 4 a) (nth 4 b)) (> (nth 3 a) (nth 3 b)))');
    // 首项进 paperSize/scale，其余进 alternatives
    expect(code).toContain('(if @fr:alts (cdr @fr:alts) nil)');
  });

  it('不把 T 当作值使用（会话里 T 可能是 nil / 被污染成字符串）', () => {
    // 实测某 CAD 会话 T 被绑定成 nil（null T → T），此时 (setq hit T) 会静默失效：
    // 内框去重与属性块优先都会失效，且 while 的恒真条件会变成恒假。统一用字面量 1。
    for (const opts of [{}, { includeInner: true }]) {
      const code = buildFramesCode(opts);
      expect(code).not.toMatch(/\(setq hit T\)/);
      expect(code).not.toContain('@fr:setidx @fr:rec 11 T');
    }
    expect(buildFramesCode({ includeInner: true })).toContain('(setq @fr:inner 1');
  });

  it('分页参数写入 LISP，切片发生在排序之后', () => {
    const code = buildFramesCode({ offset: 2, limit: 1 });
    expect(code).toContain('(setq @fr:offset 2 @fr:limit 1)');
    const sortIdx = code.indexOf("(vl-sort @fr:frames");
    const sliceIdx = code.indexOf('(while (and (< @fr:k @fr:total)');
    expect(sortIdx).toBeGreaterThan(0);
    expect(sliceIdx).toBeGreaterThan(sortIdx);
  });
});

describe('归一化（normalizeFramesPayload / normalizeFrameRecord）', () => {
  it('单条 frame：字段齐全、ratio 保留 4 位小数、inner 布尔化、elongation 空串保留', () => {
    const frame = normalizeFrameRecord([
      ['handle', '51EB'], ['layer', 'PUB_TITLE'], ['bbox', [1, 2, 84101, 59402]],
      ['width', 84100], ['height', 59400], ['ratio', 1.4158249],
      ['paperSize', 'A1'], ['elongation', ''], ['scale', 100], ['inner', null],
    ]);
    expect(frame).toEqual({
      handle: '51EB', layer: 'PUB_TITLE', bbox: [1, 2, 84101, 59402],
      width: 84100, height: 59400, ratio: 1.4158,
      paperSize: 'A1', elongation: '', scale: 100,
      source: 'polyline', blockName: null, attributes: null, fields: null, alternatives: [],
      inner: false,
    });
  });

  it('属性块 frame：source/blockName/attributes/fields/alternatives 归一化', () => {
    const frame = normalizeFrameRecord([
      ['handle', 'A1B2'], ['layer', 'PUB_TITLE'], ['bbox', [0, 0, 84000, 59400]],
      ['width', 84000], ['height', 59400], ['ratio', 1.4141],
      ['paperSize', 'A3'], ['elongation', ''], ['scale', 200],
      ['inner', null], ['source', 'attr-block'], ['blockName', 'TK_A3'],
      ['attributes', [['图名', '车库顶层平面图'], ['图号', '建施-09'], ['比例', '1:200'], ['未知', 'x']]],
      ['fields', [['title', '车库顶层平面图'], ['number', '建施-09'], ['scale', '1:200']]],
      ['alternatives', [['A1', '', 100], ['A2', '', 150]]],
    ]);
    expect(frame).toMatchObject({
      source: 'attr-block', blockName: 'TK_A3', paperSize: 'A3', scale: 200,
      attributes: { 图名: '车库顶层平面图', 图号: '建施-09', 比例: '1:200', 未知: 'x' },
      fields: { title: '车库顶层平面图', number: '建施-09', scale: '1:200' },
      alternatives: [
        { paperSize: 'A1', elongation: '', scale: 100 },
        { paperSize: 'A2', elongation: '', scale: 150 },
      ],
    });
    // 未知 tag 完整保留在 attributes 里，但不会进 fields
    expect(frame.fields.未知).toBeUndefined();
  });

  it('alternatives 最多保留 4 项；单条 (tag . value) 也兜住', () => {
    const frame = normalizeFrameRecord([
      ['handle', 'H'], ['width', 1], ['height', 1], ['ratio', 1],
      ['paperSize', 'A1'], ['elongation', ''], ['scale', 100], ['source', 'polyline'],
      ['alternatives', [['A3', '', 200], ['A2', '', 300], ['A4', '', 400], ['A0', '', 500], ['A1', '', 600]]],
      ['attributes', ['图名', '单条']],
    ]);
    expect(frame.alternatives).toHaveLength(4);
    expect(frame.alternatives[0]).toEqual({ paperSize: 'A3', elongation: '', scale: 200 });
    expect(frame.attributes).toEqual({ 图名: '单条' });
  });

  it('parseLispRecursive 产物 → 契约响应（total/offset/limit/nextOffset/counts/sources）', async () => {
    const { parseLispRecursive } = await import('../../src/handler-utils.js');
    const parsed = parseLispRecursive(LIVE_LIKE);
    const res = normalizeFramesPayload(parsed, { offset: 0, limit: 500 });
    expect(res.total).toBe(2);
    expect(res.offset).toBe(0);
    expect(res.limit).toBe(500);
    expect(res.nextOffset).toBe(2);
    expect(res.frameCount).toBe(2);
    expect(res.unmatchedCount).toBe(1);
    expect(res.sources).toEqual({ 'attr-block': 0, block: 0, polyline: 2 });
    expect(res.frames[0]).toMatchObject({
      handle: '51EB', layer: 'PUB_TITLE', width: 84100, height: 59400,
      ratio: 1.4158, paperSize: 'A1', elongation: '', scale: 100, inner: false,
      source: 'polyline',
    });
    expect(res.frames[1]).toMatchObject({ handle: '4BD2', elongation: '+1/2', ratio: 2.1229, inner: true });
    expect(res.unmatched[0]).toEqual({
      handle: '4BC7', layer: 'PUB_TITLE',
      bbox: [1574710, -60315.1, 1911110, 58484.9],
      width: 336400, height: 118800, ratio: 2.8316,
      source: 'polyline', blockName: null,
    });
    // unmatched 记录不应带 paperSize/scale（契约里没有）
    expect(res.unmatched[0].paperSize).toBeUndefined();
  });

  it('mixed 通道：sources 统计 attr-block/polyline，属性块记录带 attributes/fields', async () => {
    const { parseLispRecursive } = await import('../../src/handler-utils.js');
    const payload = '(("total" 3) ("frames" ('
      + '(("handle" "P1") ("width" 84100.0) ("height" 59400.0) ("ratio" 1.4158)'
      + ' ("paperSize" "A1") ("elongation" "") ("scale" 100) ("inner" nil) ("source" "polyline")'
      + ' ("blockName" nil) ("attributes" nil) ("fields" nil) ("alternatives" (("A3" "" 200))))'
      + '(("handle" "P2") ("width" 59400.0) ("height" 42000.0) ("ratio" 1.4143)'
      + ' ("paperSize" "A2") ("elongation" "") ("scale" 100) ("inner" nil) ("source" "polyline"))'
      + '(("handle" "A9") ("width" 84000.0) ("height" 59400.0) ("ratio" 1.4141)'
      + ' ("paperSize" "A3") ("elongation" "") ("scale" 200) ("inner" nil) ("source" "attr-block")'
      + ' ("blockName" "TK_A3") ("attributes" (("图名" . "车库顶层平面图") ("比例" . "1:200")))'
      + ' ("fields" (("title" . "车库顶层平面图") ("scale" . "1:200"))))))'
      + ' ("unmatched" nil))';
    const res = normalizeFramesPayload(parseLispRecursive(payload), { offset: 0, limit: 500 });
    expect(res.frameCount).toBe(3);
    expect(res.sources).toEqual({ 'attr-block': 1, block: 0, polyline: 2 });
    const ab = res.frames.find(f => f.source === 'attr-block');
    expect(ab).toMatchObject({
      handle: 'A9', blockName: 'TK_A3',
      attributes: { 图名: '车库顶层平面图', 比例: '1:200' },
      fields: { title: '车库顶层平面图', scale: '1:200' },
    });
    // 几何通道的 alternatives 也要归一化成对象数组
    expect(res.frames[0].alternatives).toEqual([{ paperSize: 'A3', elongation: '', scale: 200 }]);
    // 没有 attributes 的几何图框：attributes/fields 为 null，alternatives 为空数组
    expect(res.frames[1]).toMatchObject({ attributes: null, fields: null, alternatives: [] });
  });

  it('inner: T / :vlax-true 都归一成 true', () => {
    const parsed = [
      ['frames', [[['handle', 'A'], ['inner', true]], [['handle', 'B'], ['inner', ':vlax-true']]]],
    ];
    const res = normalizeFramesPayload(parsed);
    expect(res.frames.map(f => f.inner)).toEqual([true, true]);
  });

  it('压平结构也能消费（frames 是 "k", v, "k", v 平铺）', async () => {
    const { parseLispRecursive } = await import('../../src/handler-utils.js');
    const res = normalizeFramesPayload(parseLispRecursive(FLATTENED), { offset: 0, limit: 500 });
    expect(res.total).toBe(1);
    expect(res.frames).toHaveLength(1);
    expect(res.frames[0]).toMatchObject({ handle: '51EB', paperSize: 'A1', scale: 100, inner: true, ratio: 1.4158 });
    expect(res.unmatched).toEqual([]);
  });

  it('全量响应按 bbox 去重：属性块优先，deduped 计数', () => {
    const parsed = [
      ['total', 2],
      [
        'frames',
        [
          [
            ['handle', 'G1'],
            ['bbox', [0, 0, 100, 100]],
            ['source', 'polyline'],
            ['paperSize', 'A2'],
            ['scale', 100],
            ['width', 100],
            ['height', 100],
          ],
          [
            ['handle', 'A1'],
            ['bbox', [0, 0, 100, 100]],
            ['source', 'attr-block'],
            ['paperSize', 'A2'],
            ['scale', 100],
            ['width', 100],
            ['height', 100],
          ],
        ],
      ],
      ['unmatched', []],
    ];
    const res = normalizeFramesPayload(parsed, { offset: 0, limit: 500 });

    expect(res.frameCount).toBe(1);
    expect(res.deduped).toBe(1);
    expect(res.total).toBe(1);
    expect(res.totalRaw).toBe(2);
    expect(res.frames[0].source).toBe('attr-block');
    expect(res.sources).toEqual({ 'attr-block': 1, block: 0, polyline: 0 });
  });

  it('source="block"（lib 路径非属性块）：归一化并计入 sources.block', () => {
    const res = normalizeFramesPayload([
      ['total', 1],
      ['frames', [[
        ['handle', 'B1'], ['layer', 'PUB_TITLE'], ['bbox', [0, 0, 84000, 59400]],
        ['width', 84000], ['height', 59400], ['ratio', 1.4141],
        ['paperSize', 'A1'], ['elongation', ''], ['scale', 100], ['inner', null],
        ['source', 'block'], ['blockName', 'TK_A1'], ['attributes', null],
        ['fields', [['title', '总平面图']]], ['alternatives', []],
      ]]],
      ['unmatched', null],
    ], { offset: 0, limit: 500 });
    expect(res.frames[0]).toMatchObject({
      source: 'block', blockName: 'TK_A1', attributes: null, fields: { title: '总平面图' },
    });
    expect(res.sources).toEqual({ 'attr-block': 0, block: 1, polyline: 0 });
  });

  it('全量去重优先级：attr-block > block > polyline', () => {
    const rec = (handle, source) => [
      ['handle', handle], ['bbox', [0, 0, 100, 100]], ['source', source],
      ['width', 100], ['height', 100], ['paperSize', 'A2'], ['scale', 100],
    ];
    const res = normalizeFramesPayload([
      ['total', 3],
      ['frames', [rec('P', 'polyline'), rec('B', 'block'), rec('A', 'attr-block')]],
      ['unmatched', null],
    ], { offset: 0, limit: 500 });
    expect(res.frameCount).toBe(1);
    expect(res.frames[0].handle).toBe('A');
    const res2 = normalizeFramesPayload([
      ['total', 2],
      ['frames', [rec('P', 'polyline'), rec('B', 'block')]],
      ['unmatched', null],
    ], { offset: 0, limit: 500 });
    expect(res2.frames[0].handle).toBe('B');
  });

  it('lib 标记透传：LISP 返回 1 → true；缺失 → false', () => {
    expect(normalizeFramesPayload([['lib', 1], ['total', 0], ['frames', null], ['unmatched', null]]).lib).toBe(true);
    expect(normalizeFramesPayload([['total', 0], ['frames', null], ['unmatched', null]]).lib).toBe(false);
  });

  it('空结果/缺字段不炸：frames=null → 空数组，计数为 0', () => {
    const res = normalizeFramesPayload([['total', 0], ['frames', null], ['unmatched', null]], { offset: 0, limit: 500 });
    expect(res).toMatchObject({
      total: 0, frameCount: 0, unmatchedCount: 0,
      sources: { 'attr-block': 0, block: 0, polyline: 0 }, frames: [], unmatched: [],
    });
    expect(normalizeFramesPayload(null)).toMatchObject({ total: 0, frames: [], unmatched: [] });
    expect(normalizeFrameRecord(null)).toBeNull();
  });
});

describe('buildFramesOptions（query 字符串与 JSON 入参统一收敛）', () => {
  it('number/boolean 参数从字符串解析，limit 默认 500', () => {
    const opts = buildFramesOptions({ minSize: '1000', includeInner: 'true', includeUnmatched: 'false', limit: '2', offset: '1' });
    expect(opts).toMatchObject({
      minSize: 1000, includeInner: true, includeUnmatched: false, limit: 2, offset: 1, layer: '',
    });
    expect(buildFramesOptions({}).limit).toBe(500);
    expect(buildFramesOptions({ limit: 0 }).limit).toBe(0);
    expect(buildFramesOptions({ includeInner: 'no' }).includeInner).toBe(false);
  });
});

describe('getFrames', () => {
  it('返回契约字段并透传 LISP 的分页信息', async () => {
    const res = await getFrames({ layer: 'PUB_TITLE' });
    expect(res.connected).toBe(true);
    expect(res).toMatchObject({ total: 2, offset: 0, limit: 500, nextOffset: 2, frameCount: 2, unmatchedCount: 1 });
    expect(res.sources).toEqual({ 'attr-block': 0, block: 0, polyline: 2 });
    expect(sentCodes[0]).toContain('(cons 8 "PUB_TITLE")');
    // 内框去重、unmatched 上限、比例/短边容差都写进了 LISP
    expect(sentCodes[0]).toContain('(defun @fr:contained-p');
    expect(sentCodes[0]).toContain('@fr:max-unmatched 200)');
  });

  it('CAD 未连接时返回 connected:false 且契约字段仍齐全', async () => {
    cadMock.connected = false;
    cadMock.connect.mockImplementation(async () => false);
    const res = await getFrames({});
    expect(res.connected).toBe(false);
    expect(res.frames).toEqual([]);
    expect(res.unmatched).toEqual([]);
    expect(res.frameCount).toBe(0);
  });

  it('解析失败时带 error 返回而不是抛错', async () => {
    cadMock.sendCommandWithResult.mockImplementation(async () => 'garbage');
    const res = await getFrames({});
    expect(res.connected).toBe(true);
    expect(res.error).toBeTruthy();
    expect(res.frames).toEqual([]);
  });

  it('缓存命中不再访问 CAD；不同参数不共享缓存', async () => {
    await getFrames({ layer: 'PUB_TITLE' });
    await getFrames({ layer: 'PUB_TITLE' });
    expect(cadMock.sendCommandWithResult).toHaveBeenCalledTimes(1);
    await getFrames({ layer: 'PUB_TITLE', includeInner: true });
    await getFrames({ layer: 'PUB_TITLE', limit: 1 });
    expect(cadMock.sendCommandWithResult).toHaveBeenCalledTimes(3);
  });

  it('资源入口（readResource）走的是同一实现，query 字符串参数生效', async () => {
    const res = await readResource('atlisp://dwg/frames?layer=PUB_TITLE&includeInner=true&limit=1');
    expect(res.frameCount).toBe(2);
    expect(res.limit).toBe(1);
    expect(sentCodes.at(-1)).toContain('(setq @fr:inner 1');
    expect(sentCodes.at(-1)).toContain('(cons 8 "PUB_TITLE")');
  });
});

describe('listFrames handler', () => {
  it('成功：content 是 JSON 文本 + structuredContent 是同一对象', async () => {
    const res = await listFrames({ layer: 'PUB_TITLE' });
    expect(res.isError).toBeUndefined();
    expect(res.content[0].type).toBe('text');
    const text = JSON.parse(res.content[0].text);
    expect(text.total).toBe(2);
    expect(res.structuredContent).toEqual(text);
    expect(res.structuredContent.frames[0].paperSize).toBe('A1');
  });

  it('CAD 未连接 / 识别失败：isError 且不带 structuredContent', async () => {
    cadMock.connected = false;
    cadMock.connect.mockImplementation(async () => false);
    const disconnected = await listFrames({});
    expect(disconnected.isError).toBe(true);
    expect(disconnected.content[0].text).toContain('未连接 CAD');
    expect(disconnected.structuredContent).toBeUndefined();
  });
});

describe('FRAME_STANDARDS 冻结表', () => {
  it('与 at-plot frame-recognition.lsp / lib 侧 frame: 同源（改动需三处同步）', () => {
    expect(FRAME_STANDARDS.heights).toEqual([210, 297, 420, 594, 841]);
    expect(FRAME_STANDARDS.papers).toEqual(['A4', 'A3', 'A2', 'A1', 'A0']);
    expect(FRAME_STANDARDS.ratios).toHaveLength(7);
    expect(FRAME_STANDARDS.marks).toEqual(['', '+1/4', '+1/2', '+3/4', '+1', '+5/4', '+3/2']);
    expect(FRAME_STANDARDS.defaultScales).toHaveLength(18);
    expect(FRAME_STANDARDS.defaultTolRatio).toBe(0.002);
    expect(FRAME_STANDARDS.defaultTolLen).toBe(0.001);
  });
});

describe('图框字段别名表（与 lib frame:aliases 必须同步）', () => {
  const libAliasesSource = (() => {
    try {
      const here = path.dirname(fileURLToPath(import.meta.url));
      return fs.readFileSync(path.resolve(here, '../../../lib/src/frame/aliases.lsp'), 'utf8');
    } catch { return null; }
  })();

  it('结构固定：8 组语义字段（顺序即匹配优先级）', () => {
    expect(Object.keys(FRAME_FIELD_ALIASES)).toEqual([
      'title', 'number', 'scale', 'date', 'designer', 'checker', 'project', 'discipline',
    ]);
    expect(FRAME_FIELD_ALIASES.title).toEqual(['图名', '图纸名称', '图纸名', '图幅名称', 'TITLE', 'DWGNAME', 'SHEETTITLE']);
    expect(FRAME_FIELD_ALIASES.number).toContain('DWGNO.');
    expect(FRAME_FIELD_ALIASES.scale).toEqual(['比例', '出图比例', 'SCALE']);
  });

  it('frameAliasesLisp 生成合法 LISP 字面量', () => {
    const lisp = frameAliasesLisp();
    expect(lisp.startsWith("'((")).toBe(true);
    expect(lisp).toContain('("title" "图名"');
    expect(checkParens(`(setq @fr:aliases ${lisp})`).valid).toBe(true);
  });

  it('与 lib/src/frame/aliases.lsp 的 tag 集合完全一致（跨仓守卫）', () => {
    if (!libAliasesSource) return; // lib 未 checkout 时跳过（CI 可能只包含 mcp-server）
    for (const [field, tags] of Object.entries(FRAME_FIELD_ALIASES)) {
      for (const tag of tags) expect(libAliasesSource).toContain(`"${tag}"`);
      expect(libAliasesSource).toContain(`"${field}"`);
    }
  });
});
