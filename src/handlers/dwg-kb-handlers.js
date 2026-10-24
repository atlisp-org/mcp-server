// @ts-check
/**
 * atlisp-dwg-kb（图纸知识库）HTTP 客户端与工具 handler。
 *
 * 定位：mcp-server 的 CAD 工具只看「当前打开的图」，本模块补的是「历史图纸库」——
 * 跨文件找图、统计、版本演进、图号互引、解析风险体检。数据源是独立进程
 * `atlisp-dwg-kb serve`（默认 :8322），这里只做 HTTP 转发，不碰 CAD。
 *
 * 三条约定（与 server/agent 的桥接连路一致）：
 *  1. **不可达不算错误**：知识库没起时返回 `{reachable:false, hint}` 而不是抛异常，
 *     否则模型会把「服务没开」读成「图纸不存在」。
 *  2. **鉴权走 X-API-Key**：dwg-kb 侧 `DWG_KB_API_KEY` 一旦设置，/drawings、/search
 *     等都会 401；`/health`、`/stats` 免鉴权（保留用于探活）。
 *  3. **超时必须有**：/query 走 5.5M 三元组 + 启发式，/build 是分钟级后台任务；
 *     没有 AbortController 会把 MCP 请求拖到客户端超时，看起来像「工具不存在」。
 */
import config from '../config.js';
import { error as logError } from '../logger.js';

const DEFAULT_TIMEOUT = 10000;

/** 知识库地址（去掉尾部斜杠）。配置文件 > 环境变量 > 默认本机 :8322。 */
export function dwgKbUrl() {
  const url = config.dwgKb?.url || process.env.DWG_KB_URL || 'http://127.0.0.1:8322';
  return String(url).replace(/\/+$/, '');
}

function dwgKbKey() {
  return config.dwgKb?.apiKey ?? process.env.DWG_KB_API_KEY ?? '';
}

function dwgKbTimeout() {
  const n = Number(config.dwgKb?.timeout ?? process.env.DWG_KB_TIMEOUT ?? DEFAULT_TIMEOUT);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT;
}

/**
 * 统一请求。成功返回 `{ok:true, data, url}`；失败返回
 * `{ok:false, reachable, status?, error, url}`，永不 throw。
 */
async function request(path, opts = {}) {
  const { method = 'GET', query, body, timeout } = opts;
  let url;
  try {
    url = new URL(dwgKbUrl() + path);
  } catch {
    return { ok: false, reachable: false, error: `知识库地址无效: ${dwgKbUrl()}`, url: dwgKbUrl() };
  }
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  const headers = { Accept: 'application/json' };
  const key = dwgKbKey();
  if (key) headers['X-API-Key'] = key;
  if (body) headers['Content-Type'] = 'application/json';

  const ctrl = new AbortController();
  const ms = timeout || dwgKbTimeout();
  const startedAt = Date.now();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) {
      const detail = (data && (data.detail || data.error || data.message)) || `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false, reachable: true, status: res.status, url: url.toString(),
          error: `${detail}（检查 DWG_KB_API_KEY 是否与知识库一致）`,
        };
      }
      return { ok: false, reachable: true, status: res.status, url: url.toString(), error: String(detail) };
    }
    return { ok: true, data, url: url.toString(), elapsedMs: Date.now() - startedAt };
  } catch (e) {
    // AbortError = 服务在但太慢；其他（ECONNREFUSED/DNS）= 服务根本不在。
    // 两者在 failResult 里提示不同：只有「不在」才追加启动指引。
    const aborted = !!(e && e.name === 'AbortError');
    const error = aborted
      ? `请求超时（${ms}ms）: ${url.pathname}`
      : (e && e.message) || String(e);
    if (!aborted) {
      logError(`dwg-kb 请求失败 ${url}: ${error}`);
    }
    return {
      ok: false,
      reachable: aborted ? undefined : false,
      error,
      url: url.toString(),
    };
  } finally {
    clearTimeout(timer);
  }
}

const UNREACHABLE_HINT =
  '知识库服务未就绪。确认 atlisp-dwg-kb 已启动（atlisp-dwg-kb serve --port 8322），' +
  '或设置环境变量 DWG_KB_URL / 托盘「知识库」菜单里的地址。';

function okResult(payload) {
  return { content: [{ type: 'text', text: JSON.stringify({ ok: true, ...payload }, null, 2) }] };
}

function failResult(r, extra = {}) {
  const payload = {
    ok: false,
    error: r.error,
    ...(r.status ? { status: r.status } : {}),
    url: r.url,
    ...(r.reachable === false ? { reachable: false, hint: UNREACHABLE_HINT } : {}),
    ...extra,
  };
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: true };
}

// ===================== 工具 handler =====================

export async function dwgKbHealth() {
  const r = await request('/health', { timeout: 5000 });
  if (!r.ok) return failResult(r);
  const d = r.data || {};
  return okResult({ elapsedMs: r.elapsedMs,
    reachable: true,
    version: d.version,
    triples: d.triples,
    rdfLoaded: d.rdf_loaded,
    rdfStale: d.rdf_stale,
    graphBuilt: d.graph_built,
    extractDir: d.extract_dir,
    url: dwgKbUrl(),
  });
}

export async function dwgKbStats() {
  const r = await request('/stats', { timeout: 30000 });
  if (!r.ok) return failResult(r);
  return okResult({ elapsedMs: r.elapsedMs, stats: r.data });
}

export async function dwgKbSearch(args = {}) {
  const q = String(args.keyword || args.q || '').trim();
  if (!q) return failResult({ error: '缺少 keyword 参数', url: dwgKbUrl() });
  // 大库实测 /search 5–20s（rdflib 全文扫描）：默认 10s 会误报超时。
  const r = await request('/search', { query: { q, limit: args.limit }, timeout: args.timeout || 45000 });
  if (!r.ok) return failResult(r);
  return okResult({ elapsedMs: r.elapsedMs, keyword: q, results: r.data?.results ?? [] });
}

export async function dwgKbQuery(args = {}) {
  const question = String(args.question || '').trim();
  if (!question) return failResult({ error: '缺少 question 参数', url: dwgKbUrl() });
  const mode = args.mode === 'sparql' ? 'sparql' : 'nl';
  const r = await request('/query', {
    method: 'POST',
    body: { question, mode },
    // 自然语言/SPARQL 在 5.5M 三元组上可能几十秒；长查询用 timeout 覆盖
    timeout: args.timeout || 60000,
  });
  if (!r.ok) return failResult(r);
  return okResult({ elapsedMs: r.elapsedMs, question, mode, result: r.data });
}

export async function dwgKbListDrawings(args = {}) {
  const r = await request('/drawings', {
    query: {
      discipline: args.discipline,
      project: args.project,
      limit: args.limit,
      offset: args.offset,
    },
    timeout: 20000,
  });
  if (!r.ok) return failResult(r);
  return okResult({ elapsedMs: r.elapsedMs,
    total: r.data?.total,
    offset: r.data?.offset,
    limit: r.data?.limit,
    items: r.data?.items ?? [],
  });
}

export async function dwgKbProjects(args = {}) {
  const r = await request('/projects', { query: { name: args.name, limit: args.limit, offset: args.offset }, timeout: 20000 });
  if (!r.ok) return failResult(r);
  return okResult({ elapsedMs: r.elapsedMs,
    total: r.data?.total,
    offset: r.data?.offset,
    limit: r.data?.limit,
    items: r.data?.items ?? [],
  });
}

export async function dwgKbLayers(args = {}) {
  const r = await request('/layers', { query: { limit: args.limit, offset: args.offset }, timeout: 20000 });
  if (!r.ok) return failResult(r);
  return okResult({ elapsedMs: r.elapsedMs,
    total: r.data?.total,
    offset: r.data?.offset,
    limit: r.data?.limit,
    items: r.data?.items ?? [],
  });
}

export async function dwgKbBlocks(args = {}) {
  const r = await request('/blocks', { query: { limit: args.limit, offset: args.offset }, timeout: 20000 });
  if (!r.ok) return failResult(r);
  return okResult({ elapsedMs: r.elapsedMs,
    total: r.data?.total,
    offset: r.data?.offset,
    limit: r.data?.limit,
    items: r.data?.items ?? [],
  });
}

export async function dwgKbReviewQueue(args = {}) {
  // build_review_queue 要扫整个 extract 目录（2871 张图）：实测 ~44s
  const r = await request('/review_queue', { query: { limit: args.limit }, timeout: args.timeout || 90000 });
  if (!r.ok) return failResult(r);
  return okResult({ elapsedMs: r.elapsedMs,
    total: r.data?.total,
    extractDir: r.data?.extract_dir,
    queue: r.data?.queue ?? [],
    ...(r.data?.warning ? { warning: r.data.warning } : {}),
  });
}

export async function dwgKbDrawingHistory(args = {}) {
  const id = String(args.drawing || args.drawing_id || '').trim();
  if (!id) return failResult({ error: '缺少 drawing 参数（图纸 id 或名称）', url: dwgKbUrl() });
  const r = await request(`/drawings/${encodeURIComponent(id)}/evolution`, { timeout: 30000 });
  if (!r.ok) return failResult(r);
  return okResult({ elapsedMs: r.elapsedMs, drawing: r.data?.drawing, chain: r.data?.chain ?? [] });
}

export async function dwgKbCrossRef(args = {}) {
  const id = String(args.drawing || args.drawing_id || '').trim();
  if (!id) return failResult({ error: '缺少 drawing 参数（图纸 id 或名称）', url: dwgKbUrl() });
  const r = await request(`/drawings/${encodeURIComponent(id)}/cross_ref`, { timeout: 30000 });
  if (!r.ok) return failResult(r);
  return okResult({ elapsedMs: r.elapsedMs, drawing: r.data?.drawing, references: r.data?.references ?? [] });
}
