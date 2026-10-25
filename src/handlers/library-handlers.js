// @ts-check
/**
 * library-handlers.js — @lisp 在线图库工具（library_search / library_insert /
 * library_categories / library_info）。
 *
 * 三条约定（与 dwg-kb-handlers 保持一致）：
 *  1. **索引缺失不算崩溃**：图库索引没生成时返回 `{count:0, hint}`，并告诉用户
 *     怎么生成（server/scripts/library/build_index.py），否则模型会把「没索引」
 *     读成「图库里没有这个东西」。
 *  2. **插入前不碰 CAD**：检索纯本地，只有 library_insert 才连 CAD。
 *  3. **基点/单位在 CAD 端算**：单位换算依赖当前图纸的 $INSUNITS，Node 端拿不到，
 *     所以生成的 LISP 自带换算表；Node 只决定用哪种对齐策略。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { cad } from '../cad.js';
import { mcpError, escapeLispString } from '../handler-utils.js';
import { error as logError } from '../logger.js';

/** 图库根目录（索引与 dwg 都在这里）。 */
function libraryRoot() {
  return (
    process.env.ATLISP_LIBRARY_ROOT ||
    path.join(os.homedir(), 'www', 'dw', 'library')
  );
}

/** 图库站点基址（下载 dwg / png 用）。 */
function libraryBase() {
  return String(process.env.ATLISP_LIBRARY_BASE || 'https://atlisp.cn').replace(/\/+$/, '');
}

let _index = null;
let _indexMtime = 0;

/**
 * 懒加载索引。索引文件 15MB，只在第一次搜索时读，之后常驻；mtime 变了自动重载。
 */
function loadIndex() {
  const file = process.env.ATLISP_LIBRARY_INDEX || path.join(libraryRoot(), 'index', 'library-index.json');
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return { items: [], generated: '', file, missing: true };
  }
  if (_index && stat.mtimeMs === _indexMtime) return _index;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    _index = raw;
    _indexMtime = stat.mtimeMs;
    return raw;
  } catch (e) {
    logError(`library index parse failed: ${e.message}`);
    return { items: [], generated: '', file, broken: true };
  }
}

function pngUrl(id) {
  return `${libraryBase()}/dw/library/${encodeURI(id)}.png`;
}

/** 匹配打分：名称精确 > 前缀 > 包含 > 拼音首字母 > 拼音 > 路径。 */
function scoreOf(item, q) {
  const name = String(item.name || '').toLowerCase();
  const pyi = String(item.pyi || '');
  const id = String(item.id || '').toLowerCase();
  const ql = q.toLowerCase();
  if (name === ql) return 1000;
  if (name.startsWith(ql)) return 800;
  if (name.includes(ql)) return 500;
  if (pyi && pyi.startsWith(ql)) return 400;
  if (pyi && pyi.includes(ql)) return 300;
  if (id.includes(ql)) return 100;
  return 0;
}

function slim(item) {
  return {
    id: item.id,
    name: item.name,
    category: item.disc,
    std: item.std || '',
    size: item.bbox || [0, 0],
    units: item.units || 0,
    png: pngUrl(item.id),
  };
}

export async function librarySearch(args = {}) {
  const query = String(args.query || '').trim();
  if (!query) return mcpError('query 不能为空');
  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
  const category = String(args.category || '').trim();

  const index = loadIndex();
  if (index.missing) {
    return mcpError(
      `图库索引不存在：${index.file}\n生成方法：python3 server/scripts/library/build_index.py`,
    );
  }
  if (index.broken) return mcpError(`图库索引损坏：${index.file}`);

  const hits = [];
  for (const item of index.items) {
    if (category && !String(item.id).startsWith(category)) continue;
    const s = scoreOf(item, query);
    if (s > 0) hits.push([s, item]);
  }
  hits.sort((a, b) => b[0] - a[0] || String(a[1].name).localeCompare(String(b[1].name)));
  const items = hits.slice(0, limit).map(([, item]) => slim(item));

  const payload = {
    count: hits.length,
    returned: items.length,
    generated: index.generated,
    items,
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

export async function libraryCategories(args = {}) {
  const index = loadIndex();
  if (index.missing) {
    return mcpError(`图库索引不存在：${index.file}`);
  }
  const only = String(args.category || '').trim();
  const map = new Map();
  for (const item of index.items) {
    const disc = item.disc || '(root)';
    const sub = item.sub || '(根)';
    if (!map.has(disc)) map.set(disc, { count: 0, subs: new Map() });
    const entry = map.get(disc);
    entry.count += 1;
    entry.subs.set(sub, (entry.subs.get(sub) || 0) + 1);
  }
  const discs = [...map.entries()]
    .filter(([name]) => !only || name === only)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([name, v]) => ({
      name,
      count: v.count,
      subs: [...v.subs.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([sub, count]) => ({ name: sub, count })),
    }));
  const payload = { total: index.items.length, discs };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

export async function libraryInfo(args = {}) {
  const id = String(args.id || '').trim();
  if (!id) return mcpError('id 不能为空');
  const index = loadIndex();
  const item = index.items.find((x) => x.id === id);
  if (!item) return mcpError(`图库里没有这个符号：${id}`);
  const payload = {
    ...slim(item),
    insbase: item.insbase || [0, 0],
    offset: item.off || [0, 0],
    entities: item.ents || 0,
    layers: item.layers || 0,
    proxy: item.proxy || 0,
    warn: item.warn || [],
    pinyin: item.py || '',
    dwg_url: `${libraryBase()}/dw/library/${encodeURI(id)}.dwg`,
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

/** 下载 dwg 到本地缓存（按 id 分目录），返回文件路径。 */
async function downloadDwg(id) {
  const safe = id.replace(/[/\\<>":;?*|,=`]/g, '_');
  const dir = path.join(os.homedir(), '.atlisp', 'mcp-library', path.dirname(safe));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${path.basename(safe)}.dwg`);
  const url = `${libraryBase()}/dw/library/${encodeURI(id)}.dwg`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 atlisp-mcp' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100 || buf.subarray(0, 2).toString('latin1') !== 'AC') {
    throw new Error(`下载内容不是 dwg（${buf.length} 字节），可能被站点拦截`);
  }
  fs.writeFileSync(file, buf);
  return { file, url };
}

export async function libraryInsert(args = {}) {
  const id = String(args.id || '').trim();
  if (!id) return mcpError('id 不能为空');
  const point = args.point;
  const coords = Array.isArray(point)
    ? point
    : String(point || '')
        .split(',')
        .map((s) => parseFloat(s.trim()));
  if (coords.length < 2 || coords.some((v) => !Number.isFinite(v))) {
    return mcpError('插入点格式错误，需要 "x,y" 或 "x,y,z"');
  }
  const [x, y, z = 0] = coords;
  const scale = Number(args.scale) || 1;
  const rotationDeg = Number(args.rotation) || 0;
  const align = String(args.align || 'auto');

  const index = loadIndex();
  const item = index.items.find((i) => i.id === id);
  if (!item && index.missing) return mcpError(`图库索引不存在：${index.file}`);

  let downloaded;
  try {
    downloaded = await downloadDwg(id);
  } catch (e) {
    return mcpError(`图库符号下载失败：${e.message}`);
  }

  const dryRun = process.env.LIBRARY_INSERT_DRY_RUN === '1';
  if (!dryRun) {
    if (!cad.connected) await cad.connect();
    if (!cad.connected) return mcpError('未连接 CAD');
  }

  // 基点偏移（符号单位）。align=auto 时只在偏移超过符号尺寸时修正——
  // 图库里很多符号的基点是**有意**放在铰点/角点上的，不能一律居中。
  const off = (item && item.off) || [0, 0];
  const bbox = (item && item.bbox) || [0, 0];
  const size = Math.max(Math.abs(bbox[0] || 0), Math.abs(bbox[1] || 0), 1e-9);
  const offLen = Math.hypot(off[0] || 0, off[1] || 0);
  let useOffset = false;
  if (align === 'center' || align === 'bottom-left') useOffset = true;
  else if (align === 'auto' && offLen > size) useOffset = true;

  const rot = (rotationDeg * Math.PI) / 180;
  const symUnits = (item && item.units) || 0;
  const blockName = path.basename(downloaded.file, '.dwg');
  const offx = Number(off[0]) || 0;
  const offy = Number(off[1]) || 0;

  // 对齐策略在 CAD 端最终决定：单位换算依赖图纸 $INSUNITS，只有 CAD 知道。
  // auto = 基点偏移超过符号尺寸时按中心对齐（图库里 13.7% 属于这种），
  // 否则尊重原始基点（门的铰点、图框的角点都是有意为之）。
  const code = [
    '(progn',
    '  (vl-load-com)',
    `  (setq path "${escapeLispString(downloaded.file)}")`,
    `  (setq su ${symUnits} du (getvar "INSUNITS")`,
    '        su* (cond ((= su 1) 25.4) ((= su 4) 1.0) ((= su 5) 10.0) ((= su 6) 1000.0)',
    '                  ((= su 10) 914.4) (t nil))',
    '        du* (cond ((= du 1) 25.4) ((= du 4) 1.0) ((= du 5) 10.0) ((= du 6) 1000.0)',
    '                  ((= du 10) 914.4) (t nil)))',
    '  (setq uf (if (and su* du* (/= su* du*)) (/ su* du*) 1.0))',
    `  (setq s (* ${scale} uf) r ${rot})`,
    `  (setq offx ${offx} offy ${offy} offlen (sqrt (+ (* offx offx) (* offy offy)))`,
    `        size (max ${Number(bbox[0]) || 0} ${Number(bbox[1]) || 0} 1e-9))`,
    `  (setq mode "${align}")`,
    '  (if (= mode "auto") (setq mode (if (> offlen size) "center" "base")))',
    '  (setq ms (vla-get-modelspace (vla-get-activedocument (vlax-get-acad-object))))',
    '  ;; findfile 会把路径规范化成系统分隔符——直接把带 / 的路径丢给',
    '  ;; vla-insertblock 会报「Automation 错误。未找到主键」（实测）',
    '  (setq dwg (findfile path))',
    `  (setq ent (if dwg (vl-catch-all-apply 'vla-insertblock`,
    `                            (list ms (vlax-3d-point (list ${x} ${y} ${z})) dwg s s s r))`,
    '                  "ERR:找不到块文件"))',
    '  (if (vl-catch-all-error-p ent)',
    '      (strcat "ERR:" (vl-catch-all-error-message ent))',
    '    (progn',
    '      (cond',
    '        ((= mode "center")',
    '         (setq ox (* s offx) oy (* s offy))',
    '         (if (> offlen 1e-9)',
    '             (progn',
    '               (setq dx (- (* ox (cos r)) (* oy (sin r)))',
    '                     dy (- (* ox (sin r)) (* oy (cos r))))',
    '               (vla-move ent (vlax-3d-point (list 0.0 0.0 0.0))',
    '                         (vlax-3d-point (list (- dx) (- dy) 0.0))))))',
    '        ((= mode "bottom-left")',
    '         (setq mn (vlax-3d-point (list 0.0 0.0 0.0)) mx (vlax-3d-point (list 0.0 0.0 0.0)))',
    '         (vla-getboundingbox ent (quote mn) (quote mx))',
    '         (setq mnl (vlax-safearray->list mn))',
    `         (vla-move ent mn (vlax-3d-point (list ${x} ${y} ${z})))))`,
    '      (strcat "OK:"',
    '              (cdr (assoc 5 (entget (vlax-vla-object->ename ent))))',
    '              (if (/= uf 1.0) (strcat ":uf=" (rtos uf 2 4)) "")))))',
  ].join('\n');

  // 调试用：LIBRARY_INSERT_DRY_RUN=1 只回生成的 LISP，不连 CAD。
  // 维护者可以把这段代码原样贴进 CAD 验证（本地无 CAD 时的验收手段）。
  if (dryRun) {
    const dry = { dryRun: true, code, file: downloaded.file, blockName, scale, corrected: useOffset };
    return { content: [{ type: 'text', text: JSON.stringify(dry, null, 2) }], structuredContent: dry };
  }

  let result;
  try {
    result = await cad.sendCommandWithResult(code);
  } catch (e) {
    return mcpError(`CAD 执行失败：${e.message}`);
  }
  const text = typeof result === 'string' ? result : JSON.stringify(result);
  if (text.includes('ERR:')) return mcpError(`插入失败：${text}`);
  const handleMatch = /OK:([0-9A-Fa-f]+)/.exec(text);
  const payload = {
    handle: handleMatch ? handleMatch[1] : '',
    blockName,
    scale,
    corrected: useOffset,
    source: downloaded.url,
    raw: text.slice(0, 400),
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}
