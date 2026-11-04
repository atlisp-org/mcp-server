// @ts-check
/**
 * pattern-handlers.js — `hatch_with_pattern`：
 * 确保 .pat 在 CAD 本地（按需从服务器下载）→ 用 -HATCH 按选择对象填充。
 *
 * 为什么下载放在 CAD 端：中继拓扑下 MCP 与 CAD 可能不同机，文件必须落在 CAD
 * 能读到的地方；.pat 通常只有几 KB，下载成本远低于把二进制推过去。
 *
 * ## 两个实测坑（都已避开）
 * 1. `.pat` 放 `@::*prefix*` **根目录**即可：它本来就在 CAD 的 SupportPath 里
 *    （实测 `C:\Users\<user>\@lisp` 已在支持路径）。不要用 `setenv "acad"`——
 *    那台机器 `(getenv "acad")` 是 nil，会直接报 stringp nil。
 * 2. `-HATCH` 只能用「选择对象」路径：`(command "_.-HATCH" "s" <ename> "" "")`。
 *    用 `"p" <图案名>` 会停在属性子提示上，把 CAD 卡死（实测踩过）。
 *    图案/比例/角度改用 sysvar 预先设置，事后恢复。
 */
import { cad } from '../cad.js';
import { mcpError, escapeLispString } from '../handler-utils.js';

/** CAD 下载基址：同机/内网部署可指向局域网，跳过公网。 */
function cadBase() {
  return String(process.env.ATLISP_LIBRARY_CAD_BASE || '').replace(/\/+$/, '');
}

export async function hatchWithPattern(args = {}) {
  const pattern = String(args.pattern || '').trim();
  if (!pattern) return mcpError('pattern 不能为空');
  /* 比例：
   *   - 显式传了 scale → 以它为准；
   *   - 没传（或传 "auto"）且有 pitch（图案基间距，由 agent 的 pattern_search 带入）
   *     → 在 CAD 里按**填充边界最小边长 / pitch / 15** 反推，让图案在边界里约重复 15 次；
   *   - 两者都没有 → 沿用 1（老行为）。 */
  const explicitScale = args.scale === undefined || args.scale === null || args.scale === 'auto'
    ? 0
    : Number(args.scale);
  const pitch = Number(args.pitch) > 0 ? Number(args.pitch) : 0;
  const autoScale = !(explicitScale > 0) && pitch > 0;
  const scale = explicitScale > 0 ? explicitScale : 1;
  const angle = Number(args.angle) || 0;
  const file = String(args.file || '').trim() || `${pattern}.pat`;

  const dryRun = process.env.PATTERN_DRY_RUN === '1';
  if (!dryRun) {
    if (!cad.connected) await cad.connect();
    if (!cad.connected) return mcpError('未连接 CAD');
  }

  const base = cadBase();
  const baseExpr = base ? `"${escapeLispString(base)}"` : '(@::uri)';

  const code = [
    '(progn',
    '  (vl-load-com)',
    /* 只认 @::*prefix* 是不够的：`@::down-by-base64` 的符号可能已 interna，
       但函数定义在 NETWORK 模块里（新文档里就常见「undefined function」）。
       所以先用 catch-all 尝试加载 network 模块，下载本身也用 catch-all 包住。 */
    '  (if (not (boundp (quote @::*prefix*)))',
    '      "ERR:需要 @lisp 内核（缺少 @::*prefix*）"',
    `    (progn`,
    `      (setq pfile (strcat @::*prefix* "${escapeLispString(file)}"))`,
    '      (setq had (if (findfile pfile) T nil))',
    '      (if (not had)',
    '          (progn',
    '            (if (member (quote @::load-module) (atoms-family 0))',
    '                (vl-catch-all-apply (function (lambda () (@::load-module (quote NETWORK)))) nil))',
    /* 下载必须包在 lambda 里再交给 catch-all：直接传符号
       `(vl-catch-all-apply (quote @::down-by-base64) ...)` 在函数未定义时是硬错误，
       catch-all 接不住（实测：@lisp 1.23.23 没有这个函数）。 */
    '            (vl-catch-all-apply',
    '              (function',
    '                (lambda ()',
    `                  (@::down-by-base64 (strcat ${baseExpr} "/dw/pat/" "${escapeLispString(file)}")`,
    '                                     pfile nil)))',
    '              nil)))',
    '      (if (null (findfile pfile))',
    '          (strcat "ERR:图案文件下载失败（内核缺少 network 模块或网络不通） " pfile)',
    '        (progn',
    /* 注意：这台 CAD 上 `or`/`and` 被第三方插件改成了只返回 T/nil，
       `(setq ss (or (ssget "_I") (ssget "_P")))` 会得到 T 而不是选择集。
       所以这里分两步赋值。 */
    '          (setq ss (ssget "_I"))',
    '          (if (null ss) (setq ss (ssget "_P")))',
    '          (if (null ss)',
    '              "ERR:未选择边界（请先选中闭合边界，再调用本工具）"',
    '            (progn',
    /* 自动比例：@hs 先放显式值（没有就 1），auto 时再按边界覆盖。
       只用 if/ progn，不碰 or/and（同上，返回值不可靠）。 */
    `              (setq @hs ${scale})`,
    ...(autoScale
      ? [
          '              (setq @ho (vlax-ename->vla-object (ssname ss 0)))',
          '              (setq @hr (vl-catch-all-apply',
          "                     (function (lambda () (vla-getboundingbox @ho (quote @hp1) (quote @hp2))))))",
          '              (if (not (vl-catch-all-error-p @hr))',
          '                (progn',
          '                  (setq @hl1 (vlax-safearray->list @hp1) @hl2 (vlax-safearray->list @hp2))',
          '                  (setq @hw (abs (- (car @hl1) (car @hl2)))',
          '                        @hh (abs (- (cadr @hl1) (cadr @hl2))))',
          '                  (setq @hd @hw)',
          '                  (if (< @hh @hw) (setq @hd @hh))',
          `                  (if (> @hd 0.0) (setq @hs (/ (/ @hd 15.0) ${pitch})))))`,
        ]
      : []),
    '              (if (<= @hs 0.0) (setq @hs 1.0))',
    '              (setq o1 (getvar "HPNAME") o2 (getvar "HPSCALE") o3 (getvar "HPANG") n 0 i 0)',
    `              (setvar "HPNAME" "${escapeLispString(pattern)}")`,
    '              (setvar "HPSCALE" @hs)',
    `              (setvar "HPANG" ${angle})`,
    '              (while (< i (sslength ss))',
    '                (command "_.-HATCH" "s" (ssname ss i) "" "")',
    '                (setq n (1+ n) i (1+ i)))',
    '              (setvar "HPNAME" o1) (setvar "HPSCALE" o2) (setvar "HPANG" o3)',
    '              (strcat "OK:" (if had "cached" "fetched") ":" (itoa n)',
    '                      ":SCALE=" (rtos @hs 2 3)))))))))',
  ].join('\n');

  if (dryRun) {
    const dry = { dryRun: true, code, pattern, file, autoScale, pitch };
    return { content: [{ type: 'text', text: JSON.stringify(dry, null, 2) }], structuredContent: dry };
  }

  let result;
  try {
    result = await cad.sendCommandWithResult(code);
  } catch (e) {
    return mcpError(`CAD 执行失败：${e.message}`);
  }
  const text = typeof result === 'string' ? result : JSON.stringify(result);
  if (text.includes('ERR:')) return mcpError(`填充失败：${text}`);

  const usedScale = Number((text.match(/SCALE=([\d.]+)/) || [])[1]) || scale;
  const payload = {
    pattern,
    file,
    scale: usedScale,
    autoScale,
    fetched: text.includes('fetched'),
    handle: '',
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

// ---------------------------------------------------------------------------
// pattern_search：855 个图案，索引 153KB（schema 2）—— 用户端直接下载缓存即可
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function patternCacheFile() {
  const dir = process.env.ATLISP_LIBRARY_CACHE || path.join(os.homedir(), '.atlisp', 'mcp-library');
  return path.join(dir, 'pattern-index.json');
}

function patternIndexUrl() {
  const base = String(process.env.ATLISP_LIBRARY_BASE || 'https://atlisp.cn').replace(/\/+$/, '');
  return `${base}/dw/pat/index/pattern-index.json`;
}

let _patCache = null;
let _patSchema = 0;
let _patRefreshTried = false;

async function ensurePatternIndex() {
  if (_patCache) return _patCache;
  const file = patternCacheFile();
  const ttlMs = 7 * 24 * 3600 * 1000;
  try {
    const st = fs.statSync(file);
    if (Date.now() - st.mtimeMs < ttlMs) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(raw?.items) && raw.items.length) {
        /* schema 1 的旧缓存没有 cat/pitch：进程内最多再拉一次新索引，
           拉不到就继续用旧的（不能让每次调用都走网络）。 */
        if ((raw.schema || 1) >= 2 || _patRefreshTried) {
          _patCache = raw.items;
          _patSchema = raw.schema || 1;
          return _patCache;
        }
      }
    }
  } catch {
    /* 缓存没有/过期 → 下载 */
  }
  const res = await fetch(patternIndexUrl(), {
    headers: { 'User-Agent': 'Mozilla/5.0 atlisp-mcp' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${patternIndexUrl()}`);
  const text = await res.text();
  const raw = JSON.parse(text);
  const items = Array.isArray(raw?.items) ? raw.items : [];
  if (!items.length) throw new Error('图案索引为空');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, text);
  fs.renameSync(`${file}.tmp`, file);
  _patCache = items;
  _patSchema = raw.schema || 1;
  _patRefreshTried = true;
  return _patCache;
}

function patScore(it, q) {
  const name = String(it.name || '').toLowerCase();
  const desc = String(it.desc || '').toLowerCase();
  const pyi = String(it.pyi || '');
  const ql = q.toLowerCase();
  if (name === ql) return 1000;
  if (name.startsWith(ql)) return 800;
  if (name.includes(ql)) return 500;
  if (desc.includes(ql)) return 400;
  if (pyi && pyi.startsWith(ql)) return 300;
  if (pyi && pyi.includes(ql)) return 200;
  if (String(it.cat || '').includes(ql)) return 150;
  return 0;
}

export async function patternSearch(args = {}) {
  const q = String(args.query || '').trim();
  const cat = String(args.category || '').trim();
  if (!q && !cat) return mcpError('query 不能为空（可只给 category 浏览某类图案）');
  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 60);
  let items;
  try {
    items = await ensurePatternIndex();
  } catch (e) {
    return mcpError(`图案索引不可用：${e.message}（可由 agent 的同名本地工具替代）`);
  }
  if (cat && !items.some((it) => it.cat)) {
    return mcpError(
      '本地图案索引是旧版（schema 1，无类别字段）。已自动尝试刷新；仍拿不到就删掉缓存 '
        + `${patternCacheFile()} 或等 7 天过期，也可先用关键字搜。`,
    );
  }
  const pool = cat ? items.filter((it) => String(it.cat || '').includes(cat)) : items;
  if (!pool.length) {
    const cats = [...new Set(items.map((it) => it.cat).filter(Boolean))];
    return mcpError(`图案库里没有「${cat}」类图案。可用类别：${cats.join(' · ')}`);
  }
  const hits = [];
  for (const it of pool) {
    const s = q ? patScore(it, q) : 1;
    if (s > 0) hits.push([s, it]);
  }
  hits.sort((a, b) => b[0] - a[0] || String(a[1].name).localeCompare(String(b[1].name)));
  const top = hits.slice(0, limit).map(([, it]) => ({
    name: it.name,
    desc: it.desc || '',
    file: it.file,
    cat: it.cat || '',
    pitch: it.pitch ?? null,
    unit: it.unit || '',
    scale_hint: it.scale_hint ?? null,
    lines: it.lines || 0,
  }));
  const payload = { count: hits.length, returned: top.length, items: top };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}
