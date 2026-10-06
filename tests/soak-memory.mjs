#!/usr/bin/env node
// 内存泄漏 soak 测试：两阶段判定，避免把「TTL 窗口内的正常堆积」误判为泄漏
//   阶段 1 churn  : 持续制造 MCP 会话，采样 heapUsed/RSS/sessions
//   阶段 2 settle : 停止打点，等待空闲清扫回收，观测会话数回落与 heap 回落
// 判定依据是「回收后是否回到基线」，而不是 churn 期间的斜率
// 用法: node tests/soak-memory.mjs [--url http://127.0.0.1:8110] [--minutes 4]
//       [--settle-minutes 8] [--rpm 96] [--api-key k] [--heap-limit-mb 4194]
import http from 'node:http';

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const URL_BASE = arg('--url', 'http://127.0.0.1:8110');
const MINUTES = Number(arg('--minutes', '4'));
const SETTLE_MINUTES = Number(arg('--settle-minutes', '8'));
const RPM = Number(arg('--rpm', '96'));
const API_KEY = arg('--api-key', process.env.MCP_API_KEY || '');
const SAMPLE_MS = 15000;
const HEAP_LIMIT_MB = Number(arg('--heap-limit-mb', '0')) || 4194; // v8 默认 ~4.19GB

const host = new URL(URL_BASE).hostname;
const port = Number(new URL(URL_BASE).port || 80);

function request(pathname, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      host, port, path: pathname, method: payload ? 'POST' : 'GET',
      headers: {
        ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}),
        ...(API_KEY ? { authorization: `Bearer ${API_KEY}` } : {}),
        ...headers,
      },
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, raw }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

async function sample() {
  const res = await request('/health/full');
  if (res.status !== 200) return { error: `HTTP ${res.status}` };
  const j = JSON.parse(res.raw);
  return {
    t: Date.now(),
    rssMB: j.system.memory.rssMB,
    heapUsedMB: j.system.memory.heapUsedMB,
    heapTotalMB: j.system.memory.heapTotalMB ?? null,
    externalMB: j.system.memory.externalMB,
    sessions: j.mcp.sessions,
    sse: j.mcp.sseSessions,
    heapPct: Number(((j.system.memory.heapUsedMB / HEAP_LIMIT_MB) * 100).toFixed(2)),
  };
}

function slope(samples, key) {
  const pts = samples.filter((s) => typeof s[key] === 'number');
  if (pts.length < 3) return NaN;
  const t0 = pts[0].t;
  const xs = pts.map((s) => (s.t - t0) / 60000);
  const ys = pts.map((s) => s[key]);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0; let den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den === 0 ? NaN : num / den;
}

const stats = { sent: 0, ok: 0, throttled: 0, failed: 0, errors: new Map() };
const samples = [];

console.log(`=== 内存 soak 测试 ===`);
console.log(`目标      ${URL_BASE}`);
console.log(`时长      ${MINUTES} 分钟，速率 ${RPM}/分钟（服务限流 100/60s）`);
console.log(`堆上限    ${HEAP_LIMIT_MB} MB（v8 默认）`);
console.log(`采样      每 ${SAMPLE_MS / 1000}s`);
console.log('');

const baseline = await sample();
if (baseline.error) {
  console.error(`无法获取基线: ${baseline.error}`);
  process.exit(2);
}
samples.push(baseline);
console.log(`基线      heapUsed ${baseline.heapUsedMB} MB  rss ${baseline.rssMB} MB  sessions ${baseline.sessions}  heap ${baseline.heapPct}%`);

const delay = Math.max(1, Math.round(60000 / RPM));

async function churn(endAt) {
  let seq = 0;
  while (Date.now() < endAt) {
    seq += 1;
    const sid = `soak-${Date.now()}-${seq}`;
    try {
      const res = await request('/mcp', {
        jsonrpc: '2.0', id: seq, method: 'tools/call',
        params: { name: 'agent_set_context', arguments: { key: `k${seq}`, value: 'v'.repeat(200) } },
      }, { 'mcp-session-id': sid });
      stats.sent += 1;
      if (res.status === 200) stats.ok += 1;
      else if (res.status === 429) stats.throttled += 1;
      else {
        stats.failed += 1;
        const key = `HTTP ${res.status}`;
        stats.errors.set(key, (stats.errors.get(key) || 0) + 1);
      }
    } catch (e) {
      stats.failed += 1;
      stats.errors.set(e.message, (stats.errors.get(e.message) || 0) + 1);
    }
    const spent = Date.now() % delay;
    await new Promise((r) => setTimeout(r, spent > 0 ? delay - spent : delay));
  }
}

const sampler = setInterval(async () => {
  const s = await sample();
  if (s.error) { console.error(`采样失败: ${s.error}`); return; }
  samples.push(s);
  console.log(
    `[${new Date(s.t).toLocaleTimeString()}] heapUsed ${String(s.heapUsedMB).padStart(5)} MB (${String(s.heapPct).padStart(5)}%)  `
    + `rss ${String(s.rssMB).padStart(5)} MB  heapTotal ${String(s.heapTotalMB).padStart(5)} MB  sessions ${String(s.sessions).padStart(5)}`
  );
}, SAMPLE_MS);

console.log(`阶段 1 churn ${MINUTES} 分钟 @ ${RPM}/分钟`);
await churn(Date.now() + MINUTES * 60000);
clearInterval(sampler);
await sample().then((s) => { if (!s.error) samples.push(s); });

const peak = samples.reduce((a, s) => (s.sessions > a.sessions ? s : a), samples[0]);
console.log(`
阶段 1 结束  sessions ${samples[samples.length - 1].sessions}  heapUsed ${samples[samples.length - 1].heapUsedMB} MB  rss ${samples[samples.length - 1].rssMB} MB`);
console.log(`阶段 2 settle ${SETTLE_MINUTES} 分钟，等待空闲清扫（SESSION_IDLE_TTL + 5min 扫描周期）\n`);

let prevSessions = samples[samples.length - 1].sessions;
let firstDropIdx = null;
const settleEnd = Date.now() + SETTLE_MINUTES * 60000;
while (Date.now() < settleEnd) {
  await new Promise((r) => setTimeout(r, SAMPLE_MS));
  const s = await sample();
  if (s.error) { console.error(`采样失败: ${s.error}`); continue; }
  const d = s.sessions - prevSessions;
  samples.push(s);
  prevSessions = s.sessions;
  console.log(
    `  [${new Date(s.t).toLocaleTimeString()}] heapUsed ${String(s.heapUsedMB).padStart(4)} MB (${String(s.heapPct).padStart(5)}%)  `
    + `rss ${String(s.rssMB).padStart(4)} MB  heapTotal ${String(s.heapTotalMB).padStart(4)} MB  sessions ${String(s.sessions).padStart(5)} (${d >= 0 ? '+' : ''}${d})`
  );
  if (d < 0 && firstDropIdx === null) {
    firstDropIdx = samples.length - 1;
    console.log('  >>> 回收开始');
  }
  // 不因回收刚开始就退出：V8 回收是延迟的，过早取样会把未 GC 的垃圾当成泄漏。
  // 仅在地板值连续稳定若干个采样后才提前结束。
  if (firstDropIdx !== null) {
    const post = samples.slice(firstDropIdx);
    if (post.length >= 8) {
      const floor = Math.min(...post.map((x) => x.heapUsedMB));
      const tail = post.slice(-4);
      if (tail.every((x) => x.heapUsedMB === floor)) {
        console.log('  地板值已稳定，提前结束观察');
        break;
      }
    }
  }
}

const first = samples[0];
const last = samples[samples.length - 1];
const churnSamples = firstDropIdx === null ? samples : samples.slice(0, firstDropIdx);
const peakHeap = Math.max(...churnSamples.map((s) => s.heapUsedMB));
const observedPeakHeap = Math.max(...samples.map((s) => s.heapUsedMB));
const postSamples = firstDropIdx === null ? [] : samples.slice(firstDropIdx);
// 地板值：回收后所有采样中的最小 heapUsed。V8 何时 GC 不确定，
// 取 min 比取最后一个样本更能代表真实稳态驻留量。
const settledHeap = postSamples.length ? Math.min(...postSamples.map((s) => s.heapUsedMB)) : null;
const settledHeapLast = postSamples.length ? postSamples[postSamples.length - 1].heapUsedMB : null;
const settledHeapTotal = postSamples.length ? postSamples[postSamples.length - 1].heapTotalMB : null;
const heapTotalRatchet = postSamples.length && first.heapTotalMB !== null
  ? settledHeapTotal - first.heapTotalMB
  : null;
const hSlope = slope(samples, 'heapUsedMB');
const postSlope = postSamples.length >= 3 ? slope(postSamples, 'heapUsedMB') : NaN;

console.log('\n=== 结果 ===');
console.log(`请求      发送 ${stats.sent}  成功 ${stats.ok}  限流 ${stats.throttled}  失败 ${stats.failed}`);
if (stats.errors.size) for (const [k, v] of stats.errors) console.log(`          ${k} x${v}`);
console.log(`跨度      ${((last.t - first.t) / 60000).toFixed(1)} 分钟，${samples.length} 个采样`);
console.log(`基线      heapUsed ${first.heapUsedMB} MB  heapTotal ${first.heapTotalMB} MB  rss ${first.rssMB} MB  sessions ${first.sessions}`);
console.log(`峰值      heapUsed ${peakHeap} MB（全程最高 ${observedPeakHeap} MB）  heapTotal ${Math.max(...samples.map((s) => s.heapTotalMB || 0))} MB  sessions ${peak.sessions}`);
console.log(`全程斜率  heap ${Number.isNaN(hSlope) ? 'n/a' : hSlope.toFixed(2) + ' MB/min'}  rss ${Number.isNaN(slope(samples, 'rssMB')) ? 'n/a' : slope(samples, 'rssMB').toFixed(2) + ' MB/min'}`);
if (postSamples.length) {
  console.log(`回收后    heapUsed 地板 ${settledHeap} MB / 末值 ${settledHeapLast} MB（基线 ${first.heapUsedMB} MB）  heapTotal ${settledHeapTotal} MB（基线 ${first.heapTotalMB} MB）  斜率 ${Number.isNaN(postSlope) ? 'n/a' : postSlope.toFixed(2) + ' MB/min'}`);
}
console.log(`堆占比    ${first.heapPct}% -> ${last.heapPct}%  (上限 ${HEAP_LIMIT_MB} MB)`);

let verdict;
let exitCode = 0;
// 判据：回收后的 heapUsed 地板值相对「churn 前基线」。
// 不用「峰值 × 1.5」——峰值常落在 GC 之前，会把延迟 GC 误判成泄漏。
const base = first.heapUsedMB;
const growthRatio = settledHeap !== null && base > 0 ? settledHeap / base : NaN;
if (firstDropIdx === null) {
  verdict = 'INCONCLUSIVE：观察窗口内未出现会话回收，无法区分「TTL 窗口内堆积」与「泄漏」。'
    + '请把 --settle-minutes 提到大于 SESSION_IDLE_TTL + 5min（默认配置需 >35 分钟）后重跑。';
} else if (postSamples.length < 3) {
  verdict = 'INCONCLUSIVE：回收已开始但样本不足，无法取地板值，请加大 --settle-minutes。';
} else if (Number.isNaN(growthRatio)) {
  verdict = 'INCONCLUSIVE：基线为 0，无法计算增长比，请加大 --minutes 让基线采样稳定。';
} else if (growthRatio > 2 && postSlope > 0.5) {
  verdict = `FAIL：回收后 heapUsed 地板 ${settledHeap} MB 达基线 ${base} MB 的 ${growthRatio.toFixed(2)} 倍，`
    + `且仍以 ${postSlope.toFixed(2)} MB/min 上升，判定泄漏。`;
  exitCode = 1;
} else if (growthRatio > 1.3) {
  verdict = `WARN：回收后 heapUsed 地板 ${settledHeap} MB 仍比基线 ${base} MB 高 ${((growthRatio - 1) * 100).toFixed(0)}%，`
    + '建议延长 --settle-minutes 观察是否继续回落（V8 可能尚未完成 GC）。';
} else if (heapTotalRatchet !== null && heapTotalRatchet > Math.max(64, base)) {
  verdict = `WARN：heapUsed 已回落（地板 ${settledHeap} MB vs 基线 ${base} MB），但 heapTotal 从 ${first.heapTotalMB} MB 涨到 ${settledHeapTotal} MB 未归还（+${heapTotalRatchet} MB）。`
    + '属堆碎片化，多轮 churn 下需观察 heapTotal 是否收敛。';
} else {
  verdict = `PASS：会话已回收，heapUsed 地板 ${settledHeap} MB 回到基线 ${base} MB 的 ${growthRatio.toFixed(2)} 倍以内，无无界增长。`;
}
console.log(`
判定      ${verdict}`);
console.log(`说明      阶段 1 斜率不作为泄漏依据：会话在 SESSION_IDLE_TTL 内合法堆积，需以回收后趋势为准`);
process.exit(exitCode);
