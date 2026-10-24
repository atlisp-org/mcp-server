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
