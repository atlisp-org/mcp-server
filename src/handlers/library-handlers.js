// @ts-check
/**
 * library-handlers.js — @lisp 在线图库工具（library_search / library_insert /
 * library_categories / library_info）。
 *
 * ## 素材在哪、谁来拿（重要）
 *
 * 图库素材（24,699 个 dwg + 索引）只存在**服务端** `~/www/dw/library`，通过
 * https://atlisp.cn/dw/library/ 对外提供。用户机器上**没有**这份副本，所以这里
 * 不能假设本地有库：
 *
 *   ┌ 索引（搜索/分类） ── 服务端 library-web.json（2.9MB）→ 缓存到
 *   │                       ~/.atlisp/mcp-library/，7 天过期，过期先用旧的后台刷新
 *   ├ 单条详情 ─────────── 服务端 /dwglib/item?id=（完整元数据）
 *   └ dwg（插入）────────  在 **CAD 端**用 @lisp 内核的 @::down-by-base64 下载
 *                           （本机装了 @lisp 就行），拿不到再退回 MCP 侧下载
 *
 * 为什么插入要让 CAD 自己下：中继(peer)拓扑里 MCP 可能不跟 CAD 同机，文件路径
 * 必须落在 CAD 能读到的地方；让 CAD 下载一次解决所有拓扑。
 *
 * ## 三条约定
 *  1. **拿不到不算「图库里没有」**：索引拉不到时返回明确的原因 + 可执行建议。
 *  2. **插入前不碰 CAD**：检索纯本地（缓存），只有 library_insert 才连 CAD。
 *  3. **不猜单位**：单位换算依赖图纸 $INSUNITS，只有在 CAD 端算才准。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { cad } from '../cad.js';
import { mcpError, escapeLispString } from '../handler-utils.js';
import { error as logError } from '../logger.js';

/** 图库站点基址（索引与 dwg 的下载源）。 */
function libraryBase() {
  return String(process.env.ATLISP_LIBRARY_BASE || 'https://atlisp.cn').replace(/\/+$/, '');
}

/**
 * CAD 下载 dwg 用的基址（默认走 CAD 自己的 (@::uri) = s3 镜像）。
 * 与图库同机部署时可设成局域网地址（如 http://192.168.1.100:8100），
 * CAD 就只在内网取 40KB 的 dwg，不用绕公网一圈。
 */
function cadLibraryBase() {
  return String(process.env.ATLISP_LIBRARY_CAD_BASE || '').replace(/\/+$/, '');
}

/** 服务端/开发机上的完整图库目录（存在就用它，免下载）。 */
function libraryRoot() {
  return process.env.ATLISP_LIBRARY_ROOT || path.join(os.homedir(), 'www', 'dw', 'library');
}

/** 客户端缓存目录（索引、以及退回本地下载时的 dwg 都放这儿）。 */
function cacheDir() {
  return process.env.ATLISP_LIBRARY_CACHE || path.join(os.homedir(), '.atlisp', 'mcp-library');
}

/** 索引有效期（小时），默认 7 天。 */
function indexTtlMs() {
  const h = Number(process.env.ATLISP_LIBRARY_TTL_HOURS || 168);
  return (Number.isFinite(h) && h > 0 ? h : 168) * 3600 * 1000;
}

function fileAge(file) {
  try {
    return Date.now() - fs.statSync(file).mtimeMs;
  } catch {
    return Infinity;
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** web 索引的行数组 → 统一 item 形状（与 library-index.json 的 items 对齐）。 */
function rowToItem(rows) {
  return rows.map((r) => ({
    id: r[0],
    name: r[1],
    disc: r[2],
    pyi: r[3] || '',
    off: [Number(r[4]) || 0, Number(r[5]) || 0],
    bbox: [Number(r[6]) || 0, Number(r[7]) || 0],
    units: Number(r[8]) || 0,
    png: r[9] === 1,
    dup: r[10] === 1,
    std: r[11] || '',
  }));
}

function normalizeIndex(raw, source) {
  // 两种索引都是 {items:[...]}：完整索引的 items 是对象，web 索引的 items 是数组行。
  // 只看有没有 items 会把 web 行当对象解析（disc/name 全 undefined）。
  if (Array.isArray(raw?.items) && raw.items.length && Array.isArray(raw.items[0])) {
    return { items: rowToItem(raw.items), generated: raw.generated || '', source };
  }
  if (Array.isArray(raw?.items)) {
    // library-index.json：完整索引（服务端/开发机）
    const items = raw.items.map((i) => ({
      ...i,
      pyi: i.pyi || '',
      off: i.off || [0, 0],
      bbox: i.bbox || [0, 0],
      std: i.std || '',
      png: i.png !== false,
      dup: Boolean(i.dup),
    }));
    return { items, generated: raw.generated || '', source };
  }
  if (Array.isArray(raw)) {
    // 裸数组（兼容旧格式）
    return { items: rowToItem(raw), generated: '', source };
  }
  return null;
}

let _index = null;
let _refreshing = null;

/**
 * 选索引来源：显式指定 > 本地全量（服务端/开发机）> 缓存 > 服务端下载。
 * 返回 {file, full} —— full=true 表示带 std/insbase/warn 等完整字段。
 */
function pickIndexFile() {
  const explicit = process.env.ATLISP_LIBRARY_INDEX;
  if (explicit && fs.existsSync(explicit)) return { file: explicit, full: true, local: true };
  const root = libraryRoot();
  // 与图库同机时优先读本地 web 索引：3MB，解析比全量 17MB 快一个数量级；
  // 需要 insbase/warn 等完整字段时 libraryInfo 会另外读全量（见 ensureFullIndex）。
  const localWeb = path.join(root, 'index', 'library-web.json');
  if (fs.existsSync(localWeb)) return { file: localWeb, full: false, local: true };
  const localFull = path.join(root, 'index', 'library-index.json');
  if (fs.existsSync(localFull)) return { file: localFull, full: true, local: true };
  const cachedFull = path.join(cacheDir(), 'library-index.json');
  if (fs.existsSync(cachedFull)) return { file: cachedFull, full: true };
  const cachedWeb = path.join(cacheDir(), 'library-web.json');
  if (fs.existsSync(cachedWeb)) return { file: cachedWeb, full: false };
  return null;
}

async function downloadIndex() {
  const dir = cacheDir();
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'library-web.json');
  const url = `${libraryBase()}/dw/library/index/library-web.json`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 atlisp-mcp' },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const text = await res.text();
  const raw = JSON.parse(text);
  const normalized = normalizeIndex(raw, url);
  if (!normalized || !normalized.items.length) throw new Error(`索引内容为空: ${url}`);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, target);
  return { ...normalized, file: target };
}

/** 后台刷新（stale-while-revalidate）：失败只记日志，不影响本次检索。 */
function refreshIndexInBackground() {
  if (_refreshing) return _refreshing;
  _refreshing = downloadIndex()
    .then((fresh) => {
      _index = fresh;
      return fresh;
    })
    .catch((e) => {
      logError(`library index refresh failed: ${e.message}`);
      return null;
    })
    .finally(() => {
      _refreshing = null;
    });
  return _refreshing;
}

/**
 * 取索引（进程内缓存）。返回值：
 *   {items, generated, source, stale}
 * 拿不到索引时抛错，由调用方统一转成可读提示。
 */
async function ensureIndex() {
  if (_index) return _index;

  const picked = pickIndexFile();
  if (picked) {
    try {
      const raw = readJson(picked.file);
      const normalized = normalizeIndex(raw, picked.local ? (picked.full ? 'local-full' : 'local-web') : 'cache');
      if (normalized && normalized.items.length) {
        normalized.stale = fileAge(picked.file) > indexTtlMs();
        _index = normalized;
        if (normalized.stale) refreshIndexInBackground();
        return _index;
      }
    } catch (e) {
      logError(`library index read failed (${picked.file}): ${e.message}`);
    }
  }

  // 本地/缓存都没有 → 从服务端拉
  const fresh = await downloadIndex();
  fresh.stale = false;
  _index = fresh;
  return _index;
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

function indexSourceHint() {
  return (
    `索引会自动从 ${libraryBase()}/dw/library/index/library-web.json 下载并缓存到 ` +
    `${cacheDir()}（可用 ATLISP_LIBRARY_CACHE / ATLISP_LIBRARY_BASE / ATLISP_LIBRARY_INDEX 覆盖）`
  );
}

export async function librarySearch(args = {}) {
  const query = String(args.query || '').trim();
  if (!query) return mcpError('query 不能为空');
  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
  const category = String(args.category || '').trim();

  let index;
  try {
    index = await ensureIndex();
  } catch (e) {
    return mcpError(`图库索引不可用：${e.message}\n${indexSourceHint()}`);
  }

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
    generated: index.generated || '',
    indexSource: index.source,
    items,
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

export async function libraryCategories(args = {}) {
  let index;
  try {
    index = await ensureIndex();
  } catch (e) {
    return mcpError(`图库索引不可用：${e.message}\n${indexSourceHint()}`);
  }
  const only = String(args.category || '').trim();
  const map = new Map();
  for (const item of index.items) {
    const disc = item.disc || '(root)';
    if (!map.has(disc)) map.set(disc, { count: 0 });
    map.get(disc).count += 1;
  }
  const discs = [...map.entries()]
    .filter(([name]) => !only || name === only)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([name, v]) => ({ name, count: v.count }));
  const payload = { total: index.items.length, indexSource: index.source, discs };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

let _fullIndex = null;

/** 同机的全量索引（17MB）：只有 libraryInfo 需要 insbase/warn 时才读。 */
function ensureFullIndex() {
  if (_fullIndex) return _fullIndex;
  const candidates = [
    process.env.ATLISP_LIBRARY_INDEX,
    path.join(libraryRoot(), 'index', 'library-index.json'),
    path.join(cacheDir(), 'library-index.json'),
  ].filter(Boolean);
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const normalized = normalizeIndex(readJson(file), 'local-full');
      if (normalized && normalized.items.length) {
        _fullIndex = normalized;
        return _fullIndex;
      }
    } catch (e) {
      logError(`library full index read failed (${file}): ${e.message}`);
    }
  }
  return null;
}

export async function libraryInfo(args = {}) {
  const id = String(args.id || '').trim();
  if (!id) return mcpError('id 不能为空');

  // 1) 同机全量索引里有 → 直接读盘，不绕网络
  const full = ensureFullIndex();
  if (full) {
    const item = full.items.find((x) => x.id === id);
    if (item) return infoResponse(item);
  }

  // 2) 服务端单条接口（客户端没有完整索引时的权威来源）
  try {
    const url = `${libraryBase()}/dwglib/item?id=${encodeURIComponent(id)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 atlisp-mcp' },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const body = await res.json();
      const data = body?.data || body;
      if (data && data.id) {
        return infoResponse({
          id: data.id,
          name: data.name,
          disc: data.disc,
          std: data.std || '',
          bbox: [data.w, data.h],
          off: [data.offx, data.offy],
          units: data.units,
          png: data.png === 1 || data.png === true,
          dup: data.dup === 1,
          insbase: [0, 0],
          warn: [],
        });
      }
    }
  } catch (e) {
    logError(`library item fetch failed: ${e.message}`);
  }

  // 3) 退回索引里的精简信息
  try {
    const index = await ensureIndex();
    const item = index.items.find((x) => x.id === id);
    if (item) return infoResponse(item);
  } catch (e) {
    return mcpError(`图库索引不可用：${e.message}\n${indexSourceHint()}`);
  }
  return mcpError(`图库里没有这个符号：${id}`);
}

function infoResponse(item) {
  const payload = {
    ...slim(item),
    insbase: item.insbase || [0, 0],
    offset: item.off || [0, 0],
    entities: item.ents || 0,
    layers: item.layers || 0,
    proxy: item.proxy || 0,
    warn: item.warn || [],
    pinyin: item.py || '',
    dwg_url: `${libraryBase()}/dw/library/${encodeURI(item.id)}.dwg`,
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

/** MCP 侧下载（只在 CAD 端拿不到 @lisp 内核时兜底）。 */
async function downloadDwg(id) {
  const safe = id.replace(/[/\\<>":;?*|,=`]/g, '_');
  const dir = path.join(cacheDir(), 'dw', path.dirname(safe));
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

/** 探测 CAD 端有没有 @lisp 内核的下载能力（有就让 CAD 自己下，拓扑无关）。 */
async function cadCanDownload() {
  try {
    const probe = await cad.sendCommandWithResult(
      `(if (and (member '@::down-by-base64 (atoms-family 0)) (boundp '@::*prefix*)) "CADDL" "NOCAD")`,
    );
    return String(probe || '').includes('CADDL');
  } catch {
    return false;
  }
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

  let item = null;
  try {
    const index = await ensureIndex();
    item = index.items.find((i) => i.id === id) || null;
  } catch {
    /* 索引拿不到也能插：基点/单位就交给 CAD 自己判断 */
  }

  const dryRun = process.env.LIBRARY_INSERT_DRY_RUN === '1';
  if (!dryRun) {
    if (!cad.connected) await cad.connect();
    if (!cad.connected) return mcpError('未连接 CAD');
  }

  const md = (item && (item.warn ? item.warn.includes('units_missing') : false)) || (item && item.units === 0);
  const off = (item && item.off) || [0, 0];
  const bbox = (item && item.bbox) || [0, 0];
  const size = Math.max(Math.abs(bbox[0] || 0), Math.abs(bbox[1] || 0), 1e-9);
  const offLen = Math.hypot(off[0] || 0, off[1] || 0);
  let useOffset = false;
  if (align === 'center' || align === 'bottom-left') useOffset = true;
  else if (align === 'auto' && offLen > size) useOffset = true;

  const rot = (rotationDeg * Math.PI) / 180;
  const symUnits = (item && item.units) || 0;

  // 优先 CAD 端下载：中继拓扑下 MCP 与 CAD 不同机，本地文件路径对 CAD 不可见
  const cadSide = dryRun ? true : await cadCanDownload();
  let downloaded = null;
  let pathMode = 'cad';
  if (!cadSide) {
    try {
      downloaded = await downloadDwg(id);
      pathMode = 'local';
    } catch (e) {
      return mcpError(`图库符号下载失败：${e.message}`);
    }
  }

  // CAD 端下载基址：同机部署可用 LAN 地址（ATLISP_LIBRARY_CAD_BASE）跳过公网
  const cadBase = cadLibraryBase();
  const cadBaseExpr = cadBase ? `"${escapeLispString(cadBase)}"` : '(@::uri)';
  const safeId = id.replace(/[/\\<>":;?*|,=`]/g, '_');
  const pathSetup =
    pathMode === 'cad'
      ? [
          `  (setq path (strcat @::*prefix* "library/mcp/${escapeLispString(safeId)}.dwg"))`,
          '  (@::mkdir (@::path (vl-filename-directory path)))',
          `  (@::down-by-base64 (strcat ${cadBaseExpr} "/dw/library/${escapeLispString(id)}.dwg") path nil)`,
        ]
      : [`  (setq path "${escapeLispString(downloaded.file)}")`];

  const blockName = pathMode === 'cad' ? safeId : path.basename(downloaded.file, '.dwg');

  // 单位换算在 CAD 端做：目标图纸的 $INSUNITS 只有 CAD 知道。
  const code = [
    '(progn',
    '  (vl-load-com)',
    ...pathSetup,
    '  (setq dwg (findfile path))',
    `  (if (null dwg) (strcat "ERR:找不到块文件 " path)`,
    '    (progn',
    `      (setq su ${symUnits} du (getvar "INSUNITS")`,
    '            su* (cond ((= su 1) 25.4) ((= su 4) 1.0) ((= su 5) 10.0) ((= su 6) 1000.0)',
    '                      ((= su 10) 914.4) (t nil))',
    '            du* (cond ((= du 1) 25.4) ((= du 4) 1.0) ((= du 5) 10.0) ((= du 6) 1000.0)',
    '                      ((= du 10) 914.4) (t nil)))',
    '      (setq uf (if (and su* du* (/= su* du*)) (/ su* du*) 1.0))',
    `      (setq s (* ${scale} uf) r ${rot})`,
    `      (setq offx ${Number(off[0]) || 0} offy ${Number(off[1]) || 0} offlen (sqrt (+ (* offx offx) (* offy offy)))`,
    `            size (max ${Number(bbox[0]) || 0} ${Number(bbox[1]) || 0} 1e-9))`,
    `      (setq mode "${align}")`,
    '      (if (= mode "auto") (setq mode (if (> offlen size) "center" "base")))',
    '      (setq ms (vla-get-modelspace (vla-get-activedocument (vlax-get-acad-object))))',
    `      (setq ent (vl-catch-all-apply 'vla-insertblock`,
    `                 (list ms (vlax-3d-point (list ${x} ${y} ${z})) dwg s s s r)))`,
    '      (if (vl-catch-all-error-p ent)',
    '          (strcat "ERR:" (vl-catch-all-error-message ent))',
    '        (progn',
    '          ;; 对齐一律用插入后的真实包围盒：不用索引里的 off 算旋转，',
    '          ;; 少一处三角函数就少一处符号错误（实测曾经把 y 偏移算反）。',
    '          (cond',
    '            ((= mode "center")',
    '             (setq mn (vlax-3d-point (list 0.0 0.0 0.0)) mx (vlax-3d-point (list 0.0 0.0 0.0)))',
    '             (vla-getboundingbox ent (quote mn) (quote mx))',
    '             (setq mnl (vlax-safearray->list mn) mxl (vlax-safearray->list mx))',
    `             (vla-move ent (vlax-3d-point (list 0.0 0.0 0.0))`,
    `                       (vlax-3d-point (list (- ${x} (/ (+ (car mnl) (car mxl)) 2.0))`,
    `                                              (- ${y} (/ (+ (cadr mnl) (cadr mxl)) 2.0)) 0.0))))`,
    '            ((= mode "bottom-left")',
    '             (setq mn (vlax-3d-point (list 0.0 0.0 0.0)) mx (vlax-3d-point (list 0.0 0.0 0.0)))',
    '             (vla-getboundingbox ent (quote mn) (quote mx))',
    `             (vla-move ent mn (vlax-3d-point (list ${x} ${y} ${z})))))`,
    '          (strcat "OK:"',
    '                  (cdr (assoc 5 (entget (vlax-vla-object->ename ent))))',
    '                  (if (/= uf 1.0) (strcat ":uf=" (rtos uf 2 4)) "")))))))',
  ].join('\n');

  if (dryRun) {
    const dry = { dryRun: true, pathMode, code, blockName, scale, corrected: useOffset };
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
    source: `${libraryBase()}/dw/library/${encodeURI(id)}.dwg`,
    fetchedBy: pathMode === 'cad' ? 'cad' : 'mcp',
    ...(md ? { unitsUndefined: true } : {}),
    raw: text.slice(0, 400),
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}
