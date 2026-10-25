// 图纸知识库（atlisp-dwg-kb）HTTP 工具 handler 测试：
// 参数透传、API key 头、401 提示、服务不可达时的降级形状。
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'node:http';

const mockConfig = {
    dwgKb: { url: 'http://127.0.0.1:1', apiKey: '', timeout: 2000 },
};

vi.mock('../src/config.js', () => ({
    default: mockConfig,
    getConfig: () => mockConfig,
    getAllConfig: () => mockConfig,
}));
vi.mock('../src/logger.js', () => ({
    log: vi.fn(),
    error: vi.fn(),
    closeLog: vi.fn(),
}));

const {
    dwgKbHealth, dwgKbStats, dwgKbSearch, dwgKbQuery,
    dwgKbListDrawings, dwgKbReviewQueue,
    dwgKbLayerDrawings, dwgKbVerifyDrawing, dwgKbRenderDrawing,
    dwgKbJob, dwgKbProjectOverview, dwgKbCrossRefGraph,
} = await import('../src/handlers/dwg-kb-handlers.js');

let server;
let port;
let lastRequest;
let routes;

function json(res, status, payload) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
}

beforeAll(async () => {
    server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
            const u = new URL(req.url, 'http://x');
            lastRequest = { method: req.method, path: u.pathname, query: u.searchParams, headers: req.headers, body };
            const handler = routes.get(u.pathname);
            if (!handler) return json(res, 404, { detail: 'not found' });
            const [status, payload] = handler(req, body);
            json(res, status, payload);
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
});

afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
    lastRequest = null;
    mockConfig.dwgKb = { url: `http://127.0.0.1:${port}`, apiKey: '', timeout: 2000 };
    routes = new Map();
});

describe('dwg_kb_* 只读工具', () => {
    it('health 透传知识库状态', async () => {
        routes.set('/health', () => [200, {
            status: 'ok', version: '0.2.0', triples: 5499880,
            rdf_loaded: true, rdf_stale: false, graph_built: true,
        }]);
        const r = await dwgKbHealth();
        expect(r.isError).toBeUndefined();
        const payload = JSON.parse(r.content[0].text);
        expect(payload.reachable).toBe(true);
        expect(payload.triples).toBe(5499880);
        expect(payload.rdfLoaded).toBe(true);
    });

    it('search 带 q/limit 并返回 results', async () => {
        routes.set('/search', () => [200, { results: [{ text: '会议室', drawing: 'A-01' }] }]);
        const r = await dwgKbSearch({ keyword: '会议室', limit: 5 });
        const payload = JSON.parse(r.content[0].text);
        expect(payload.results).toHaveLength(1);
        expect(lastRequest.query.get('q')).toBe('会议室');
        expect(lastRequest.query.get('limit')).toBe('5');
    });

    it('query 以 POST 发送 question/mode', async () => {
        routes.set('/query', () => [200, { type: 'drawings', results: [] }]);
        const r = await dwgKbQuery({ question: '2020 年以后的建施平面图', mode: 'nl' });
        expect(r.isError).toBeUndefined();
        expect(lastRequest.method).toBe('POST');
        expect(JSON.parse(lastRequest.body)).toEqual({
            question: '2020 年以后的建施平面图', mode: 'nl',
        });
    });

    it('list_drawings 透传分页信封', async () => {
        routes.set('/drawings', () => [200, {
            items: [{ id: 'A-01', label: '一层平面图' }], total: 2871, offset: 0, limit: 20,
        }]);
        const r = await dwgKbListDrawings({ discipline: 'Architecture', limit: 20 });
        const payload = JSON.parse(r.content[0].text);
        expect(payload.total).toBe(2871);
        expect(payload.items[0].id).toBe('A-01');
        expect(lastRequest.query.get('discipline')).toBe('Architecture');
    });

    it('配置了 API key 时发送 X-API-Key', async () => {
        mockConfig.dwgKb.apiKey = 'secret-key';
        routes.set('/stats', () => [200, { drawings: 2871 }]);
        await dwgKbStats();
        expect(lastRequest.headers['x-api-key']).toBe('secret-key');
    });

    it('401 时提示检查 DWG_KB_API_KEY，而不是报「查不到」', async () => {
        routes.set('/drawings', () => [401, { detail: 'missing or invalid API key' }]);
        const r = await dwgKbListDrawings({});
        expect(r.isError).toBe(true);
        const payload = JSON.parse(r.content[0].text);
        expect(payload.ok).toBe(false);
        expect(payload.status).toBe(401);
        expect(payload.error).toContain('DWG_KB_API_KEY');
    });

    it('服务不可达时返回 reachable:false + 启动指引（不抛异常）', async () => {
        mockConfig.dwgKb.url = 'http://127.0.0.1:1'; // 必然拒绝连接
        const r = await dwgKbReviewQueue({ limit: 5 });
        expect(r.isError).toBe(true);
        const payload = JSON.parse(r.content[0].text);
        expect(payload.reachable).toBe(false);
        expect(payload.hint).toContain('atlisp-dwg-kb');
    });

    it('缺少必填参数时不发请求', async () => {
        const r = await dwgKbSearch({});
        expect(r.isError).toBe(true);
        expect(lastRequest).toBeNull();
    });
});

// ---- 图层反查 / 校验 / 渲染 / 任务 / 概览 / 跨专业全景 ----

describe('dwg_kb_* 审查工具', () => {
    it('layer_drawings 走反查端点并回传 matched_layers 与 evidence', async () => {
        routes.set('/layers/%E9%98%B2%E7%81%AB/drawings', () => [200, {
            layer: '防火', exact: false, matched_layers: ['A-DOOR-FM(防火门编号)'],
            matched_layer_count: 1, total: 2, offset: 0, limit: 20,
            items: [{ id: 'a1', label: '平面图', path: '/x/平面图.dwg' }],
            evidence: [{ source: 'rdf', id: 'a1', matched: '平面图' }],
        }]);
        const r = await dwgKbLayerDrawings({ layer: '防火', limit: 20 });
        expect(r.isError).toBeUndefined();
        const p = JSON.parse(r.content[0].text);
        expect(p.total).toBe(2);
        expect(p.items[0].id).toBe('a1');
        expect(p.matchedLayers).toEqual(['A-DOOR-FM(防火门编号)']);
        expect(p.evidence).toHaveLength(1);
        expect(lastRequest.query.get('limit')).toBe('20');
        // 未传 exact 时不带该参数（默认子串）
        expect(lastRequest.query.get('exact')).toBeNull();
    });

    it('layer_drawings 传 exact=false 时显式下发', async () => {
        routes.set('/layers/WALL/drawings', () => [200, { total: 0, items: [] }]);
        await dwgKbLayerDrawings({ layer: 'WALL', exact: false });
        expect(lastRequest.query.get('exact')).toBe('false');
    });

    it('layer_drawings 缺 layer 时不发请求', async () => {
        const r = await dwgKbLayerDrawings({});
        expect(r.isError).toBe(true);
        expect(lastRequest).toBeNull();
    });

    it('verify_drawing 用 POST 并展开报告', async () => {
        routes.set('/drawings/%E5%B9%B3%E9%9D%A2%E5%9B%BE/verify', () => [200, {
            drawing: '平面图', confidence: 0.8,
            warnings: [{ reason: '图名冲突', verdict: 'corrected' }],
            stats: { confirmed: 3, corrected: 1, unverifiable: 0 },
        }]);
        const r = await dwgKbVerifyDrawing({ drawing: '平面图', question: '图名与图号是否一致' });
        expect(r.isError).toBeUndefined();
        const p = JSON.parse(r.content[0].text);
        expect(lastRequest.method).toBe('POST');
        expect(lastRequest.query.get('question')).toBe('图名与图号是否一致');
        expect(p.confidence).toBe(0.8);
        expect(p.warnings[0].verdict).toBe('corrected');
    });

    it('verify_drawing 后台模式回传 job_id', async () => {
        routes.set('/drawings/%E5%B9%B3%E9%9D%A2%E5%9B%BE/verify', () => [200, { status: 'started', job_id: 'abc123' }]);
        const r = await dwgKbVerifyDrawing({ drawing: '平面图', background: true });
        const p = JSON.parse(r.content[0].text);
        expect(lastRequest.query.get('background')).toBe('true');
        expect(p.job_id).toBe('abc123');
    });

    it('render_drawing 返回落盘路径 + 可访问 URL，不含二进制', async () => {
        routes.set('/drawings/%E5%B9%B3%E9%9D%A2%E5%9B%BE/render', () => [200, {
            status: 'ok', format: 'png', file: '/renders/平面图.png',
            path: '/home/u/.dwg-kb/renders/平面图.png', bytes: 123456,
        }]);
        const r = await dwgKbRenderDrawing({ drawing: '平面图' });
        const p = JSON.parse(r.content[0].text);
        expect(lastRequest.method).toBe('POST');
        expect(lastRequest.query.get('format')).toBe('png');
        expect(p.path).toContain('renders');
        expect(p.url.endsWith('/renders/平面图.png')).toBe(true);
        expect(p.bytes).toBe(123456);
        expect(JSON.stringify(p)).not.toContain('base64');
    });

    it('job 查询异步任务状态', async () => {
        routes.set('/jobs/abc123', () => [200, {
            id: 'abc123', kind: 'verify', status: 'ok', result: { confidence: 0.9 },
        }]);
        const r = await dwgKbJob({ job_id: 'abc123' });
        const p = JSON.parse(r.content[0].text);
        expect(p.status).toBe('ok');
        expect(p.result.confidence).toBe(0.9);
    });

    it('project_overview 拉项目级审查轮次', async () => {
        routes.set('/projects/%E5%B9%BF%E8%AF%9A%E5%95%86%E5%8A%A1%E5%B9%BF%E5%9C%BA', () => [200, {
            project: { id: 'p1', label: '广诚商务广场' }, total_drawings: 42,
            disciplines: { Architecture: 30, Structure: 12 },
            review_rounds: [{ round: 1, drawing_count: 5, date: '2024-03-01' }],
        }]);
        const r = await dwgKbProjectOverview({ project: '广诚商务广场' });
        const p = JSON.parse(r.content[0].text);
        expect(p.totalDrawings).toBe(42);
        expect(p.disciplines.Architecture).toBe(30);
        expect(p.reviewRounds[0].round).toBe(1);
    });

    it('cross_ref_graph 按 kind 切端点，非法 kind 回落 shared_layers', async () => {
        routes.set('/cross_ref/matrix', () => [200, { matrix: { 'Architecture <-> HVAC': 7 } }]);
        const m = JSON.parse((await dwgKbCrossRefGraph({ kind: 'matrix' })).content[0].text);
        expect(m.matrix['Architecture <-> HVAC']).toBe(7);

        routes.set('/cross_ref/shared_layers', () => [200, { layers: [{ layer: 'WALL', total_drawings: 4 }] }]);
        const s = JSON.parse((await dwgKbCrossRefGraph({ kind: 'nope' })).content[0].text);
        expect(s.kind).toBe('shared_layers');
        expect(s.layers[0].layer).toBe('WALL');
        expect(lastRequest.path).toBe('/cross_ref/shared_layers');
    });

    it('新工具在服务不可达时同样降级不抛异常', async () => {
        mockConfig.dwgKb.url = 'http://127.0.0.1:1';
        for (const r of [
            await dwgKbLayerDrawings({ layer: 'WALL' }),
            await dwgKbVerifyDrawing({ drawing: 'x' }),
            await dwgKbRenderDrawing({ drawing: 'x' }),
            await dwgKbJob({ job_id: 'x' }),
            await dwgKbProjectOverview({ project: 'x' }),
            await dwgKbCrossRefGraph({ kind: 'bridges' }),
        ]) {
            expect(r.isError).toBe(true);
            const p = JSON.parse(r.content[0].text);
            expect(p.ok).toBe(false);
            expect(p.reachable).toBe(false);
            expect(p.hint).toContain('atlisp-dwg-kb');
        }
    });
});

describe('dwg_kb_list_drawings 的 layer 过滤', () => {
    it('layer 参数透传到 /drawings（不再被静默忽略）', async () => {
        routes.set('/drawings', () => [200, {
            items: [{ id: 'a1', label: '平面图', matched_layers: ['WALL'] }],
            total: 1, offset: 0, limit: 20,
        }]);
        const r = await dwgKbListDrawings({ layer: 'WALL', discipline: 'Architecture' });
        const p = JSON.parse(r.content[0].text);
        expect(lastRequest.query.get('layer')).toBe('WALL');
        expect(lastRequest.query.get('discipline')).toBe('Architecture');
        expect(p.items[0].matched_layers).toEqual(['WALL']);
    });
});
