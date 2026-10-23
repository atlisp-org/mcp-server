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
const { listFrames } = await import('../../src/handlers/frame-handlers.js');

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

  it('分页读取能读到属性（回归：block:get-attributes → 纯 ActiveX GetAttributes）', async () => {
    clearCache();
    // 逐页全量扫描，统计带属性（attributes 非空）的块参照。
    // 修复前属性恒为 nil（服务端调了未加载的 lib 函数 block:get-attributes），带属性数为 0。
    let offset = 0;
    let total = 0;
    let withAttrs = 0;
    const samples = [];
    for (let page = 0; page < 20; page++) {
      clearCache();
      const r = await readResource(`atlisp://dwg/block-refs?offset=${offset}&limit=1000`);
      total = r.total;
      for (const ref of r.blockRefs) {
        const attrs = ref.attributes;
        const n = attrs && typeof attrs === 'object' ? Object.keys(attrs).length : 0;
        if (n > 0) {
          withAttrs += 1;
          if (samples.length < 5) samples.push({ block: ref.blockName, ...attrs });
        }
      }
      if (r.blockRefs.length === 0 || offset + r.blockRefs.length >= total) break;
      offset += r.blockRefs.length;
    }
    expect(total).toBeGreaterThan(0);
    // 地下车库.dwg 实测 2740 个 INSERT 中 473 个含属性
    expect(withAttrs).toBeGreaterThan(0);
    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) {
      expect(s.block).toBeTruthy();
      // 每个样本至少有一个 tag→value
      expect(Object.keys(s).filter(k => k !== 'block').length).toBeGreaterThan(0);
    }
  }, 300000);
});

// =============================================================================
// 图框识别（atlisp://dwg/frames / list_frames）
// 目标图纸：D:\Design\2026\车位线\地下车库.dwg（PUB_TITLE 层上有 10 个外框 + 2 个未命中候选）
// =============================================================================
describe.skipIf(!LIVE)('真机图框识别（atlisp://dwg/frames）', () => {
  const PAPER_SIZES = ['A4', 'A3', 'A2', 'A1', 'A0'];
  const SCALES = [1, 5, 10, 20, 25, 30, 40, 50, 70, 100, 120, 150, 200, 250, 300, 400, 500, 1000];
  const dimOf = f => `${f.width}x${f.height}`;

  it('PUB_TITLE 层：识别出外框、图幅/比例与人工扫描基线一致，内框被剔除', async () => {
    clearCache();
    const res = await readResource('atlisp://dwg/frames?layer=PUB_TITLE');
    expect(res.connected).toBe(true);
    expect(res.frameCount).toBe(res.frames.length);
    expect(res.frameCount).toBeGreaterThan(0);
    expect(res.offset).toBe(0);
    expect(res.limit).toBe(500);
    expect(res.nextOffset).toBe(res.total);

    for (const f of res.frames) {
      expect(f.layer).toBe('PUB_TITLE');
      expect(PAPER_SIZES).toContain(f.paperSize);
      expect(SCALES).toContain(f.scale);
      // ratio 由服务端统一保留 4 位小数
      expect(f.ratio).toBe(Math.round((Math.max(f.width, f.height) / Math.min(f.width, f.height)) * 10000) / 10000);
      expect(f.bbox).toHaveLength(4);
      expect(f.inner).toBe(false); // includeInner 默认 false，只留外框
    }

    // 人工扫描基线上的外框尺寸都应出现（84100x59400 / 59400x42000 / 126100x59400 / 105100x59400 / 73550x29700）
    const dims = res.frames.map(dimOf);
    expect(dims).toContain('84100x59400');
    expect(dims).toContain('59400x42000');
    expect(dims).toContain('126100x59400');
    expect(dims).toContain('105100x59400');
    expect(dims).toContain('73550x29700');

    // 外框 84100x59400 与其内框 80600x57400 同时是候选，必须只留外框
    expect(dims).not.toContain('80600x57400');
    // 84100x59400 → A1 标准幅面 1:100（例：59400 = 594×100）
    const a1 = res.frames.find(f => dimOf(f) === '84100x59400');
    expect(a1).toMatchObject({ paperSize: 'A1', elongation: '', scale: 100 });
    // 126100x59400 是 +1/2 加长幅面，105100x59400 是 +1/4 加长幅面
    expect(res.frames.find(f => dimOf(f) === '126100x59400')).toMatchObject({ elongation: '+1/2', scale: 100 });
    expect(res.frames.find(f => dimOf(f) === '105100x59400')).toMatchObject({ elongation: '+1/4', scale: 100 });
  }, 300000);

  it('frames 按面积降序，默认容差 0.0035 下 336400x118800 命中 A1+1@1:200', async () => {
    clearCache();
    const res = await readResource('atlisp://dwg/frames?layer=PUB_TITLE');
    const areas = res.frames.map(f => f.width * f.height);
    expect([...areas].sort((a, b) => b - a)).toEqual(areas);

    // 宽高比 2.8316 与比例表 2.82857(+1 加长) 差 0.0031，在默认 tolRatio=0.0035 内 → 命中
    // （旧默认 0.002 时该图进 unmatched 供人工复核）
    const big = res.frames.filter(f => dimOf(f) === '336400x118800');
    expect(big.length).toBeGreaterThan(0);
    for (const f of big) {
      expect(f.layer).toBe('PUB_TITLE');
      expect(f.ratio).toBeCloseTo(2.8316, 4);
      expect(f).toMatchObject({ paperSize: 'A1', elongation: '+1', scale: 200 });
    }
  }, 300000);

  it('includeInner=true 时内框出现在结果里并标 inner=true', async () => {
    clearCache();
    const outerOnly = await readResource('atlisp://dwg/frames?layer=PUB_TITLE');
    clearCache();
    const withInner = await readResource('atlisp://dwg/frames?layer=PUB_TITLE&includeInner=true');
    expect(withInner.total).toBeGreaterThan(outerOnly.total);
    const inner = withInner.frames.filter(f => f.inner);
    expect(inner.length).toBeGreaterThan(0);
    // 内框（标题栏内边界 80600x57400 / 122600x57400 等）只在 includeInner=true 时出现：
    // 命中标准表的内框进 frames(inner=true)，未命中标准表的内框进 unmatched。
    const allDims = [...withInner.frames, ...withInner.unmatched].map(dimOf);
    expect(allDims.some(d => d.endsWith('x57400'))).toBe(true);
    // 默认（includeInner=false）时内框在 frames 与 unmatched 里都不应出现
    expect(outerOnly.frames.concat(outerOnly.unmatched).map(dimOf).some(d => d.endsWith('x57400'))).toBe(false);
    // 外框在两种模式下都在
    expect(outerOnly.frames.map(dimOf).every(d => withInner.frames.map(dimOf).includes(d))).toBe(true);
  }, 300000);

  it('分页：limit 只在排序后的 frames 上切片，nextOffset 可翻页到结束', async () => {
    clearCache();
    const all = await readResource('atlisp://dwg/frames?layer=PUB_TITLE');
    clearCache();
    const page1 = await readResource('atlisp://dwg/frames?layer=PUB_TITLE&limit=2');
    expect(page1.frames).toHaveLength(Math.min(2, all.total));
    expect(page1.total).toBe(all.total);
    expect(page1.limit).toBe(2);
    expect(page1.nextOffset).toBe(page1.frames.length);
    // 第一页就是全量降序的前 2 条
    expect(page1.frames.map(dimOf)).toEqual(all.frames.slice(0, page1.frames.length).map(dimOf));

    clearCache();
    const page2 = await readResource(`atlisp://dwg/frames?layer=PUB_TITLE&offset=${page1.nextOffset}&limit=2`);
    expect(page2.frames.map(dimOf)).toEqual(all.frames.slice(2, 4).map(dimOf));
  }, 300000);

  it('minSize / scales 参数生效，全图扫描（不传 layer）也能跑通', async () => {
    clearCache();
    const big = await readResource('atlisp://dwg/frames?layer=PUB_TITLE&minSize=50000');
    // 短边 < 50000 的 59400x42000(A2) 与 73550x29700 被过滤
    expect(big.frames.map(dimOf)).not.toContain('73550x29700');

    clearCache();
    const restricted = await readResource('atlisp://dwg/frames?layer=PUB_TITLE&scales=50,100');
    expect(restricted.frames.every(f => [50, 100].includes(f.scale))).toBe(true);

    clearCache();
    const whole = await readResource('atlisp://dwg/frames');
    expect(whole.connected).toBe(true);
    // 全图扫描：图内的车位框/箭头框都被外框包含（inner）而剔除，只留最外层候选
    expect(whole.frameCount).toBeGreaterThan(0);
    expect(whole.unmatched.every(u => u.handle && u.width > 0)).toBe(true);
  }, 300000);

  it('contract：每条 frame 带 source，sources 汇总；几何歧义进 alternatives', async () => {
    clearCache();
    const res = await readResource('atlisp://dwg/frames?layer=PUB_TITLE');
    expect(res.sources).toBeDefined();
    expect(res.sources['attr-block'] + res.sources.polyline).toBe(res.frameCount);
    for (const f of res.frames) {
      expect(['attr-block', 'polyline']).toContain(f.source);
      expect(Array.isArray(f.alternatives)).toBe(true);
    }
    // 本图图框是 PUB_TITLE 上的闭合多段线 → 全部走几何通道
    expect(res.sources.polyline).toBe(res.frameCount);
    expect(res.sources['attr-block']).toBe(0);
    expect(res.frames.every(f => f.source === 'polyline')).toBe(true);
    expect(res.frames.every(f => f.blockName === null)).toBe(true);
    // 84100x59400 是 1:100 的 A1；与 1:200 的 A3 几何等价 → alternatives 里应能看到 A3@200
    const a1 = res.frames.find(f => dimOf(f) === '84100x59400');
    expect(a1).toMatchObject({ paperSize: 'A1', elongation: '', scale: 100 });
    expect(a1.alternatives.some(a => a.paperSize === 'A3' && a.scale === 200)).toBe(true);
  }, 300000);

  it('list_frames 工具：content 是 JSON 文本、structuredContent 与资源同源', async () => {
    clearCache();
    const viaTool = await listFrames({ layer: 'PUB_TITLE' });
    expect(viaTool.isError).toBeUndefined();
    const text = JSON.parse(viaTool.content[0].text);
    expect(text.frameCount).toBe(viaTool.structuredContent.frameCount);
    expect(text.frames[0]).toHaveProperty('paperSize');

    clearCache();
    const viaResource = await readResource('atlisp://dwg/frames?layer=PUB_TITLE');
    expect(viaTool.structuredContent).toEqual(viaResource);
  }, 300000);
});
