import http from 'node:http';
import https from 'node:https';

const SPARK_CHARS = '\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588';
const BAR_FULL = '\u2588';
const BAR_EMPTY = '\u2591';
const HISTORY_LIMIT = 120;

const C = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    bold: '\x1b[1m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
};

function colorEnabled(options) {
    if (options.color === false) return false;
    if (options.color === true) return true;
    return Boolean(process.stdout.isTTY);
}

function paint(text, color, enabled) {
    return enabled && color ? `${color}${text}${C.reset}` : text;
}

export function formatDuration(seconds) {
    const total = Math.max(0, Math.floor(seconds || 0));
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

export function formatDelta(value, digits = 1) {
    if (value === null || value === undefined || Number.isNaN(value)) return '--';
    const sign = value > 0 ? '+' : value < 0 ? '-' : '';
    return `${sign}${Math.abs(value).toFixed(digits)} MB`;
}

export function renderBar(ratio, width = 24) {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
    const filled = Math.round(clamped * width);
    return BAR_FULL.repeat(filled) + BAR_EMPTY.repeat(width - filled);
}

export function barColor(ratio) {
    if (ratio >= 0.9) return C.red;
    if (ratio >= 0.75) return C.yellow;
    return C.green;
}

export function renderSparkline(values, width = HISTORY_LIMIT) {
    const data = values.slice(-width);
    if (data.length === 0) return '';
    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min;
    if (span === 0) return SPARK_CHARS[0].repeat(data.length);
    return data
        .map((v) => {
            const idx = Math.round(((v - min) / span) * (SPARK_CHARS.length - 1));
            return SPARK_CHARS[Math.max(0, Math.min(SPARK_CHARS.length - 1, idx))];
        })
        .join('');
}

export function buildUrl(options) {
    const protocol = options.ssl ? 'https' : 'http';
    const host = options.host === '0.0.0.0' || options.host === '::' ? '127.0.0.1' : options.host;
    return `${protocol}://${host}:${options.port}/health/full`;
}

export async function fetchSnapshot(options = {}) {
    const url = options.url || buildUrl(options);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || 3000);
    const lib = url.startsWith('https:') ? https : http;
    try {
        const body = await new Promise((resolve, reject) => {
            const req = lib.request(url, {
                method: 'GET',
                agent: false,
                headers: {
                    accept: 'application/json',
                    ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
                },
                signal: controller.signal,
            }, (res) => {
                let raw = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => { raw += chunk; });
                res.on('end', () => resolve({ status: res.statusCode, raw }));
            });
            req.on('error', reject);
            req.end();
        });
        if (body.status !== 200) {
            return { ok: false, error: `HTTP ${body.status}`, url };
        }
        return { ok: true, data: JSON.parse(body.raw), url };
    } catch (e) {
        const reason = e.name === 'AbortError' ? '请求超时' : e.message;
        return { ok: false, error: reason, url };
    } finally {
        clearTimeout(timer);
    }
}

export function createHistory(limit = HISTORY_LIMIT) {
    return { rss: [], heap: [], limit, push(sample) {
        this.rss.push(sample.rss);
        this.heap.push(sample.heap);
        if (this.rss.length > this.limit) this.rss.shift();
        if (this.heap.length > this.limit) this.heap.shift();
    } };
}

export function renderFrame(snapshot, state = {}, options = {}) {
    const color = colorEnabled(options);
    const width = options.width || 66;
    const rule = '\u2500'.repeat(width);
    const data = snapshot.data || {};
    const mem = data.system?.memory || {};
    const cpu = data.system?.cpu || {};
    const cad = data.cad || {};
    const mcp = data.mcp || {};

    const rssMB = mem.rssMB ?? 0;
    const heapUsedMB = mem.heapUsedMB ?? 0;
    const heapTotalMB = mem.heapTotalMB ?? 0;
    const heapLimitMB = mem.heapLimitMB ?? 0;
    const heapRatio = heapTotalMB > 0 ? heapUsedMB / heapTotalMB : 0;
    const rssRatio = heapLimitMB > 0 ? rssMB / heapLimitMB : 0;

    const lines = [];
    lines.push(
        paint('@lisp MCP Server 内存监控', C.bold + C.cyan, color) +
        `  ${snapshot.url || ''}  ${data.timestamp ? data.timestamp.replace('T', ' ').slice(0, 19) : '--'}` +
        paint(`  每 ${options.intervalSec || 2}s 刷新 (Ctrl+C 退出)`, C.dim, color)
    );
    lines.push(rule);

    const cadText = cad.connected
        ? paint(`已连接 ${cad.platform || '?'} ${cad.version || ''}`.trim(), C.green, color)
        : paint('未连接', C.red, color);
    lines.push(`进程  PID ${state.pid ?? '--'}   运行时长 ${formatDuration(data.system?.uptime)}   CAD ${cadText}`);
    lines.push('');

    lines.push(paint('内存', C.bold, color));
    lines.push(
        `  RSS           ${paint(renderBar(rssRatio), barColor(rssRatio), color)}  ${rssMB} MB` +
        (heapLimitMB > 0 ? paint(`  (堆上限 ${heapLimitMB} MB)`, C.dim, color) : '')
    );
    lines.push(
        `  堆已用        ${paint(renderBar(heapRatio), barColor(heapRatio), color)}  ${heapUsedMB} / ${heapTotalMB} MB  ${mem.heapUsedPct ?? (heapRatio * 100).toFixed(1)}%`
    );
    lines.push(`  外部(Buffer)  ${mem.externalMB ?? 0} MB     ArrayBuffer ${mem.arrayBuffersMB ?? 0} MB`);
    lines.push('');

    if (state.history) {
        lines.push(`  RSS 趋势 ${paint(renderSparkline(state.history.rss), C.cyan, color)}  ${state.history.rss.length} 采样`);
        lines.push(`  堆   趋势 ${paint(renderSparkline(state.history.heap), C.green, color)}`);
        lines.push('');
    }

    lines.push(rule);
    const cpuUserSec = (cpu.user || 0) / 1e6;
    const cpuSysSec = (cpu.system || 0) / 1e6;
    const deltaRss = state.prev?.rss === undefined ? null : rssMB - state.prev.rss;
    const deltaHeap = state.prev?.heap === undefined ? null : heapUsedMB - state.prev.heap;
    const deltaText = state.prev === undefined
        ? paint('首次采样', C.dim, color)
        : `RSS ${formatDelta(deltaRss)}   堆 ${formatDelta(deltaHeap)}   间隔 ${(options.intervalSec || 2)}s`;

    lines.push(`CPU   user ${cpuUserSec.toFixed(1)}s   system ${cpuSysSec.toFixed(1)}s   累计 ${(cpuUserSec + cpuSysSec).toFixed(1)}s`);
    lines.push(
        `会话  MCP ${mcp.sessions ?? 0}   SSE ${mcp.sseSessions ?? 0}   工具 ${mcp.tools ?? 0}   队列 ${cad.commandQueueSize ?? 0}   重启 ${cad.restartCount ?? 0}`
    );
    lines.push(`变化  ${deltaText}`);
    return lines.join('\n');
}

export function renderError(snapshot, state = {}, options = {}) {
    const color = colorEnabled(options);
    const rule = '\u2500'.repeat(options.width || 66);
    return [
        paint('@lisp MCP Server 内存监控', C.bold + C.cyan, color) + `  ${snapshot.url || ''}`,
        rule,
        paint(`无法获取状态: ${snapshot.error}`, C.red, color),
        state.failures ? paint(`连续失败 ${state.failures} 次，重试中...`, C.dim, color) : '',
        rule,
    ].filter(Boolean).join('\n');
}

export async function runMemMonitor(options = {}) {
    const opts = {
        url: options.url || '',
        host: options.host || '127.0.0.1',
        port: options.port || 8110,
        intervalMs: options.intervalMs || 2000,
        intervalSec: options.intervalSec || Math.round((options.intervalMs || 2000) / 1000),
        apiKey: options.apiKey || '',
        ssl: Boolean(options.ssl),
        once: Boolean(options.once),
        color: options.color,
        width: options.width,
        timeoutMs: options.timeoutMs,
    };
    const state = { prev: undefined, failures: 0, history: createHistory(), pid: options.pid };
    const tty = (options.isTty ?? Boolean(process.stdout.isTTY)) && !opts.once;
    const write = (s) => process.stdout.write(s + '\n');

    if (tty) process.stdout.write('\x1b[?25l');
    write(`正在连接 ${opts.url || buildUrl(opts)} ...`);

    let painted = 2;
    let running = true;
    const onSignal = () => { running = false; };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);

    try {
        while (running) {
            const snapshot = await fetchSnapshot(opts);
            const previous = state.prev;
            if (snapshot.ok) {
                state.failures = 0;
                const mem = snapshot.data.system?.memory || {};
                state.prev = { rss: mem.rssMB ?? 0, heap: mem.heapUsedMB ?? 0 };
                state.history.push({ rss: mem.rssMB ?? 0, heap: mem.heapUsedMB ?? 0 });
            } else {
                state.failures += 1;
            }

            const view = { ...state, prev: previous };
            const frame = snapshot.ok ? renderFrame(snapshot, view, opts) : renderError(snapshot, view, opts);
            if (tty) {
                process.stdout.write(`\x1b[${painted}A`);
                const lines = frame.split('\n');
                for (const line of lines) write(`\x1b[2K${line}`);
                painted = lines.length;
            } else {
                write(frame);
            }
            if (opts.once || !running) break;
            await new Promise((resolve) => setTimeout(resolve, opts.intervalMs));
        }
    } finally {
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
        if (tty) process.stdout.write('\x1b[?25h\n');
    }
    return 0;
}

// 服务器进程自身内存监控：定期采样 process.memoryUsage()，
// RSS 或堆变化超过 thresholdMB 时输出一行到终端（stderr），返回停止函数
export function startLocalMemWatcher(options = {}) {
    const intervalMs = options.intervalMs || 15000;
    const thresholdMB = options.thresholdMB ?? 1;
    const write = options.write || ((s) => process.stderr.write(s + '\n'));
    let prev = null;

    const tick = () => {
        const mem = process.memoryUsage();
        const cur = { rssMB: mem.rss / 1024 / 1024, heapMB: mem.heapUsed / 1024 / 1024 };
        if (prev) {
            const dRss = cur.rssMB - prev.rssMB;
            const dHeap = cur.heapMB - prev.heapMB;
            if (Math.abs(dRss) >= thresholdMB || Math.abs(dHeap) >= thresholdMB) {
                write(
                    `[内存] RSS ${prev.rssMB.toFixed(1)}→${cur.rssMB.toFixed(1)} MB (${formatDelta(dRss)})`
                    + `   堆 ${prev.heapMB.toFixed(1)}→${cur.heapMB.toFixed(1)} MB (${formatDelta(dHeap)})`
                );
            }
        }
        prev = cur;
    };

    const handle = setInterval(tick, intervalMs);
    return () => clearInterval(handle);
}
