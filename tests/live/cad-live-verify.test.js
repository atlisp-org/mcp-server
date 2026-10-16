// 真机验证（opt-in，默认跳过）：把 cad.sendCommandWithResult 代理到线上 MCP 的
// eval_lisp_with_result，其余走仓库真实代码，验证需要真实图纸才能复现的三个缺陷：
//   1) atlisp://dwg/analysis 聚合截断 + type=summary/detailed
//   2) blockUsage 的 Count 语义（INSERT 引用数 vs 块定义内实体数）
//   3) atlisp://dwg/block-refs 分页与含 $/中文/空格块名的模板匹配
//
// 运行方式（需要一台开着图纸的 CAD）：
//   LIVE_MCP_URL=http://192.168.1.50:8110/mcp npx vitest run tests/live/
// 不设置 LIVE_MCP_URL 时整个文件跳过，CI 无网络也可通过。
import { describe, it, expect, vi } from 'vitest';

const LIVE = process.env.LIVE_MCP_URL || '';

let rpcId = 1;
const sentCodes = [];

async function lisp(code) {
  sentCodes.push(code);
  const res = await fetch(LIVE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: rpcId++, method: 'tools/call',
      params: { name: 'eval_lisp_with_result', arguments: { code } },
    }),
  });
  const json = await res.json();
  const text = json.result?.content?.[0]?.text ?? '';
  if (json.error || json.result?.isError) throw new Error(`CAD error: ${JSON.stringify(json.error || text)}`);
  return text;
}

const cadMock = {
  connected: true,
  connect: async () => true,
  isBusy: async () => false,
  getPlatform: () => process.env.LIVE_CAD_PLATFORM || 'AutoCAD',
  getVersion: () => 'live',
  sendCommandWithResult: (code) => lisp(code),
};

vi.mock('../../src/cad.js', () => ({
  cad: cadMock,
  getActiveConnection: () => cadMock,
  resolveCadConnection: () => cadMock,
  onDocumentChanged: vi.fn(),
}));
vi.mock('../../src/logger.js', () => ({
  log: () => {}, error: () => {}, warn: () => {}, debug: () => {}, closeLog: () => {},
}));

const { readResource } = await import('../../src/handlers/resource-handlers.js');
const { clearCache } = await import('../../src/handlers/resource-cache.js');

const jsonSize = obj => Buffer.byteLength(JSON.stringify(obj), 'utf8');

describe.skipIf(!LIVE)('真机 CAD 验证（LIVE_MCP_URL）', () => {
  it('analysis?type=summary：聚合完整、响应小、无明细', async () => {
    clearCache();
    const res = await readResource('atlisp://dwg/analysis?type=summary');
    expect(res.connected).toBe(true);
    expect(res.type).toBe('summary');
    // 修复前 entityByType 只剩 1 条、layers 只剩 1 条
    expect(res.entityByType.length).toBeGreaterThan(1);
    const sum = res.entityByType.reduce((a, e) => a + e.count, 0);
    expect(sum).toBe(res.entityCount);
    expect(res.blockUsage.length).toBeLessThanOrEqual(50);
    expect(res.layers).toBeUndefined();
    expect(res.blockDefs).toBeUndefined();
    // 未传 limit 的 block-refs 全量读约 543 KB，summary 必须远小于它
    expect(jsonSize(res)).toBeLessThan(20000);
  }, 120000);

  it('analysis?type=detailed：追加图层明细 + 块定义明细 + 全量 blockUsage', async () => {
    clearCache();
    const summary = await readResource('atlisp://dwg/analysis?type=summary');
    clearCache();
    const detailed = await readResource('atlisp://dwg/analysis?type=detailed');
    expect(detailed.layers.length).toBe(detailed.layerCount);
    expect(detailed.blockDefs.length).toBe(detailed.blockDefCount);
    expect(detailed.blockUsage.length).toBe(detailed.blockCount);
    // summary 只保留前 50 条，detailed 全量
    expect(summary.blockUsage.length).toBeLessThanOrEqual(50);
    expect(detailed.blockUsage.length).toBeGreaterThanOrEqual(summary.blockUsage.length);
  }, 300000);

  it('blockUsage 是 INSERT 引用数（不等于块定义内实体数）', async () => {
    clearCache();
    const res = await readResource('atlisp://dwg/analysis?type=detailed');
    // 逐个块用 block-refs/{name} 交叉验证引用数
    for (const b of res.blockUsage.slice(0, 3)) {
      clearCache();
      const refs = await readResource(`atlisp://dwg/block-refs/${encodeURIComponent(b.name)}`);
      expect(refs.total).toBe(b.count);
    }
  }, 300000);

  it('block-refs?limit=2 分页并回填 total/offset/limit', async () => {
    clearCache();
    sentCodes.length = 0;
    const res = await readResource('atlisp://dwg/block-refs?limit=2');
    expect(res.blockRefs.length).toBe(2);
    expect(res.offset).toBe(0);
    expect(res.limit).toBe(2);
    // 分页条件下推到 LISP（不是把全量拉回来再 slice）
    expect(sentCodes.some(c => /\(< \(length refs\) 2\)/.test(c))).toBe(true);
  }, 300000);

  it('分页循环可断言 collected === total', async () => {
    clearCache();
    let offset = 0;
    let collected = 0;
    let total = 0;
    for (let page = 0; page < 200; page++) {
      const r = await readResource(`atlisp://dwg/block-refs?offset=${offset}&limit=1000`);
      total = r.total;
      collected += r.blockRefs.length;
      if (collected >= total || r.blockRefs.length === 0) break;
      offset += r.blockRefs.length;
    }
    expect(collected).toBe(total);
  }, 300000);

  it('block-refs/{blockName} 支持含 $ / 中文的块名 + 分页参数', async () => {
    clearCache();
    const res = await readResource(`atlisp://dwg/block-refs/${encodeURIComponent('$LinePat$防水层1')}?limit=2`);
    expect(res.blockRefs.length).toBeLessThanOrEqual(2);
    if (res.total > 0) expect(res.blockRefs[0].blockName).toBe('$LinePat$防水层1');
  }, 300000);

  it('block-refs/{blockName} 不再因空格/畸形编码报「资源不存在」', async () => {
    clearCache();
    await expect(readResource(`atlisp://dwg/block-refs/${encodeURIComponent('MY BLOCK')}`))
      .resolves.toMatchObject({ total: 0 });
    await expect(readResource('atlisp://dwg/block-refs/%E0%A4%A')).resolves.toBeDefined();
  }, 300000);
});
