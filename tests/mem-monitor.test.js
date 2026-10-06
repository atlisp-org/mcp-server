import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import {
    formatDuration,
    formatDelta,
    renderBar,
    barColor,
    renderSparkline,
    buildUrl,
    fetchSnapshot,
    createHistory,
    renderFrame,
    renderError,
    runMemMonitor,
} from '../src/mem-monitor.js';

function snapshot(overrides = {}) {
    return {
        ok: true,
        url: 'http://127.0.0.1:8110/health/full',
        data: {
            status: 'ok',
            timestamp: '2026-10-06T08:00:00.000Z',
            cad: { connected: true, platform: 'AutoCAD', version: '2024', commandQueueSize: 2, restartCount: 1 },
            system: {
                uptime: 3725,
                memory: {
                    rssMB: 186, heapUsedMB: 92, heapTotalMB: 128,
                    externalMB: 18, arrayBuffersMB: 3, heapLimitMB: 512, heapUsedPct: 18,
                },
                cpu: { user: 12_300_000, system: 4_500_000 },
            },
            mcp: { sessions: 2, tools: 358, sseSessions: 1 },
            pool: {},
            ...overrides,
        },
    };
}

describe('mem-monitor 纯函数', () => {
    it('formatDuration 按量级切换格式', () => {
        expect(formatDuration(45)).toBe('45s');
        expect(formatDuration(125)).toBe('2m 5s');
        expect(formatDuration(3725)).toBe('1h 2m 5s');
        expect(formatDuration(90061)).toBe('1d 1h 1m');
        expect(formatDuration(undefined)).toBe('0s');
        expect(formatDuration(-5)).toBe('0s');
    });

    it('formatDelta 带符号并保留一位小数', () => {
        expect(formatDelta(2.14)).toBe('+2.1 MB');
        expect(formatDelta(-0.44)).toBe('-0.4 MB');
        expect(formatDelta(0)).toBe('0.0 MB');
        expect(formatDelta(null)).toBe('--');
        expect(formatDelta(NaN)).toBe('--');
    });

    it('renderBar 按比例填充并裁剪越界值', () => {
        expect(renderBar(0, 10)).toBe('\u2591'.repeat(10));
        expect(renderBar(1, 10)).toBe('\u2588'.repeat(10));
        expect(renderBar(0.5, 10)).toBe('\u2588'.repeat(5) + '\u2591'.repeat(5));
        expect(renderBar(2, 10)).toBe('\u2588'.repeat(10));
        expect(renderBar(-1, 10)).toBe('\u2591'.repeat(10));
        expect(renderBar(NaN, 4)).toBe('\u2591'.repeat(4));
    });

    it('barColor 随占用率升级为黄/红', () => {
        expect(barColor(0.5)).toBe('\x1b[32m');
        expect(barColor(0.8)).toBe('\x1b[33m');
        expect(barColor(0.95)).toBe('\x1b[31m');
    });

    it('renderSparkline 空数据返回空串，恒定数据返回平底线', () => {
        expect(renderSparkline([])).toBe('');
        expect(renderSparkline([5, 5, 5])).toBe('\u2581\u2581\u2581');
    });

    it('renderSparkline 按最小最大值映射到 8 级字符', () => {
        const spark = renderSparkline([0, 5, 10]);
        expect(spark).toHaveLength(3);
        expect(spark[0]).toBe('\u2581');
        expect(spark[1]).not.toBe(spark[0]);
        expect(spark[2]).toBe('\u2588');
    });

    it('buildUrl 把通配监听地址换成本机回环', () => {
        expect(buildUrl({ host: '0.0.0.0', port: 8110 })).toBe('http://127.0.0.1:8110/health/full');
        expect(buildUrl({ host: '::', port: 3000 })).toBe('http://127.0.0.1:3000/health/full');
        expect(buildUrl({ host: 'localhost', port: 8110, ssl: true })).toBe('https://localhost:8110/health/full');
    });

    it('createHistory 保留最近 limit 个采样', () => {
        const h = createHistory(3);
        [1, 2, 3, 4].forEach((v) => h.push({ rss: v, heap: v * 10 }));
        expect(h.rss).toEqual([2, 3, 4]);
        expect(h.heap).toEqual([20, 30, 40]);
    });
});

describe('mem-monitor 渲染', () => {
    it('renderFrame 无颜色输出含关键指标', () => {
        const frame = renderFrame(snapshot(), {}, { color: false, intervalSec: 2 });
        expect(frame).toContain('内存');
        expect(frame).toContain('186 MB');
        expect(frame).toContain('92 / 128 MB');
        expect(frame).toContain('外部(Buffer)  18 MB');
        expect(frame).toContain('ArrayBuffer 3 MB');
        expect(frame).toContain('1h 2m 5s');
        expect(frame).toContain('AutoCAD');
        expect(frame).toContain('首次采样');
        expect(frame).not.toContain('\x1b[');
    });

    it('renderFrame 首次采样后展示增量', () => {
        const frame = renderFrame(snapshot(), { prev: { rss: 184, heap: 90 } }, { color: false });
        expect(frame).toContain('RSS +2.0 MB');
        expect(frame).toContain('堆 +2.0 MB');
    });

    it('renderFrame 在有历史时输出趋势行', () => {
        const history = createHistory(10);
        [100, 110, 120].forEach((v) => history.push({ rss: v, heap: v / 2 }));
        const frame = renderFrame(snapshot(), { history }, { color: false });
        expect(frame).toContain('RSS 趋势');
        expect(frame).toContain('3 采样');
    });

    it('renderFrame 缺字段时降级不抛异常', () => {
        const frame = renderFrame({ ok: true, url: 'u', data: {} }, {}, { color: false });
        expect(frame).toContain('RSS');
        expect(frame).toContain('0 / 0 MB');
    });

    it('renderFrame CAD 断开时显示未连接', () => {
        const s = snapshot();
        s.data.cad.connected = false;
        const frame = renderFrame(s, {}, { color: false });
        expect(frame).toContain('未连接');
    });

    it('renderFrame color:true 时注入 ANSI 序列', () => {
        const frame = renderFrame(snapshot(), {}, { color: true });
        expect(frame).toContain('\x1b[');
    });

    it('renderError 显示失败原因与连续失败次数', () => {
        const out = renderError({ ok: false, url: 'http://x/health/full', error: 'ECONNREFUSED' }, { failures: 3 }, { color: false });
        expect(out).toContain('无法获取状态: ECONNREFUSED');
        expect(out).toContain('连续失败 3 次');
    });
});

describe('fetchSnapshot（真实 HTTP 服务）', () => {
    let server;
    let port;
    let lastHeaders;
    let handler;

    beforeEach(async () => {
        lastHeaders = null;
        handler = (req, res) => {
            lastHeaders = req.headers;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(snapshot().data));
        };
        server = http.createServer((req, res) => handler(req, res));
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = server.address().port;
    });

    afterEach(async () => {
        await new Promise((resolve) => server.close(resolve));
    });

    it('成功时解析 JSON', async () => {
        const res = await fetchSnapshot({ url: `http://127.0.0.1:${port}/health/full` });
        expect(res.ok).toBe(true);
        expect(res.data.system.memory.heapUsedMB).toBe(92);
    });

    it('带 apiKey 时发送 Bearer 头', async () => {
        await fetchSnapshot({ url: `http://127.0.0.1:${port}/health/full`, apiKey: 'secret' });
        expect(lastHeaders.authorization).toBe('Bearer secret');
    });

    it('未传 apiKey 时不带认证头', async () => {
        await fetchSnapshot({ url: `http://127.0.0.1:${port}/health/full` });
        expect(lastHeaders.authorization).toBeUndefined();
    });

    it('非 200 返回 HTTP 状态', async () => {
        handler = (req, res) => { res.statusCode = 401; res.end('{"error":"Unauthorized"}'); };
        const res = await fetchSnapshot({ url: `http://127.0.0.1:${port}/health/full` });
        expect(res).toMatchObject({ ok: false, error: 'HTTP 401' });
    });

    it('非法 JSON 转为 ok:false 而非抛出', async () => {
        handler = (req, res) => res.end('not-json');
        const res = await fetchSnapshot({ url: `http://127.0.0.1:${port}/health/full` });
        expect(res.ok).toBe(false);
        expect(res.error).toBeTruthy();
    });

    it('连接被拒绝时返回错误而不抛出', async () => {
        const res = await fetchSnapshot({ url: 'http://127.0.0.1:1/health/full', timeoutMs: 2000 });
        expect(res.ok).toBe(false);
        expect(res.error).toBeTruthy();
    });

    it('超时时报告请求超时', async () => {
        handler = () => { /* 故意不响应 */ };
        const res = await fetchSnapshot({ url: `http://127.0.0.1:${port}/health/full`, timeoutMs: 150 });
        expect(res).toMatchObject({ ok: false, error: '请求超时' });
    });
});

describe('runMemMonitor', () => {
    let server;
    let port;
    let chunks = [];
    const captured = () => chunks;

    beforeEach(async () => {
        server = http.createServer((req, res) => {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(snapshot().data));
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = server.address().port;
        chunks = [];
        vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { chunks.push(String(chunk)); return true; });
    });

    afterEach(async () => {
        await new Promise((resolve) => server.close(resolve));
        vi.restoreAllMocks();
    });

    it('--mem-once 只取一次快照后返回', async () => {
        const code = await runMemMonitor({ url: `http://127.0.0.1:${port}/health/full`, once: true, color: false });
        expect(code).toBe(0);
        const out = captured().join('');
        expect(out.match(/内存监控/g)).toHaveLength(1);
        expect(out).toContain('首次采样');
    });

    it('显式 url 优先于 host/port 组合', async () => {
        await runMemMonitor({ url: `http://127.0.0.1:${port}/health/full`, host: '0.0.0.0', port: 1, once: true, color: false });
        expect(captured().join('')).toContain(`http://127.0.0.1:${port}/health/full`);
    });

    it('连续采样累计趋势并展示相对上一帧的增量', async () => {
        let rss = 100;
        server.removeAllListeners('request');
        server.on('request', (req, res) => {
            rss += 3;
            res.setHeader('content-type', 'application/json');
            const data = snapshot().data;
            data.system.memory.rssMB = rss;
            data.system.memory.heapUsedMB = rss - 50;
            res.end(JSON.stringify(data));
        });
        const timer = setTimeout(() => process.emit('SIGINT'), 60);
        await runMemMonitor({ url: `http://127.0.0.1:${port}/health/full`, intervalMs: 10, color: false });
        clearTimeout(timer);
        const out = captured().join('');
        expect(out).toContain('RSS +3.0 MB');
        expect(out).toContain('堆 +3.0 MB');
        expect(out).toMatch(/\d+ 采样/);
    });

    it('连接失败时打印错误帧且不抛异常', async () => {
        const code = await runMemMonitor({ url: 'http://127.0.0.1:1/health/full', once: true, color: false, timeoutMs: 2000 });
        expect(code).toBe(0);
        expect(captured().join('')).toContain('无法获取状态');
    });

    it('TTY 模式隐藏并恢复光标、原地刷新', async () => {
        const timer = setTimeout(() => process.emit('SIGINT'), 40);
        await runMemMonitor({ url: `http://127.0.0.1:${port}/health/full`, intervalMs: 10, color: false, isTty: true });
        clearTimeout(timer);
        const out = captured().join('');
        expect(out).toContain('[?25l');
        expect(out.trimEnd().endsWith('[?25h')).toBe(true);
    });

    it('SIGINT 后停止继续取样', async () => {
        const timer = setTimeout(() => process.emit('SIGINT'), 40);
        await runMemMonitor({ url: `http://127.0.0.1:${port}/health/full`, intervalMs: 10, color: false });
        clearTimeout(timer);
        const framesAtStop = captured().length;
        await new Promise((resolve) => setTimeout(resolve, 40));
        expect(captured().length).toBe(framesAtStop);
    });
});
