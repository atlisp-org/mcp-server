// atlisp://dwg/analysis 覆盖：summary/detailed 两种模式、聚合条目截断修复、
// 历史（被压平）结构兼容、块用量按 INSERT 引用数统计、LISP 生成结构。
import { describe, it, expect, vi, beforeEach } from 'vitest';

const cadMock = vi.hoisted(() => ({
  connected: true,
  connect: vi.fn(async () => true),
  getPlatform: vi.fn(() => 'AutoCAD'),
  getVersion: vi.fn(() => '24.1s'),
  sendCommandWithResult: vi.fn(),
}));

vi.mock('../../src/cad.js', () => ({
  cad: cadMock,
  getActiveConnection: () => cadMock,
  resolveCadConnection: () => cadMock,
  onDocumentChanged: vi.fn(),
}));
vi.mock('../../src/logger.js', () => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  closeLog: vi.fn(),
}));

const { getDrawingAnalysis } = await import('../../src/handlers/resource-snapshot.js');
const { getDrawingAnalysis: reExported } = await import('../../src/handlers/analysis-handlers.js');
const { buildDrawingAnalysisCode } = await import('../../src/handlers/lisp-code-builders.js');
const { clearCache } = await import('../../src/handlers/resource-cache.js');

const SNAPSHOT = '(("dwgName" "地下车库.dwg") ("dwgPath" "D:/Design/2026/地下车库.dwg")'
  + ' ("entityCount" 17394) ("layerCount" 96) ("layerNames" ("0" "WALL")))';

// 规范结构：每个聚合条目都是 (list "key" value) 的二元列表
const ANALYSIS_SUMMARY =
  '(("entityCount" 17394)'
  + ' ("entityByType" (("POLYLINE" . 8419) ("TEXT" . 2517) ("INSERT" . 2740) ("CIRCLE" . 10)))'
  + ' ("blockRefCount" 2740)'
  + ' ("blockCount" 2)'
  + ' ("blockUsage" ((("name" . "A1") ("count" . 1) ("isDynamic" . nil))'
  + ' (("name" . "$DorLib2D$00000001") ("count" . 16) ("isDynamic" . T))))'
  + ' ("layerCount" 96)'
  + ' ("layerState" (("off" . 3) ("frozen" . 0) ("locked" . 12)))'
  + ' ("textCount" 2520)'
  + ' ("textHeights" (("min" . 2.5) ("max" . 100.0) ("median" . 3.5)))'
  + ' ("sysvars" (("ltscale" . 1000) ("clayer" . "0"))))';

const LAYERS_DETAIL =
  '("layers" ((("name" . "0") ("color" . 7) ("off" . nil) ("frozen" . nil) ("locked" . nil) ("linetype" . "Continuous"))'
  + ' (("name" . "WALL") ("color" . 9) ("off" . T) ("frozen" . T) ("locked" . T) ("linetype" . "DASHED"))))';

const BLOCK_DEFS =
  '("blockDefCount" 2)'
  + ' ("blockDefs" ((("name" . "A1") ("entityCount" . 1507) ("isDynamic" . nil))'
  + ' (("name" . "DOOR") ("entityCount" . 12) ("isDynamic" . T))))';

const ANALYSIS_DETAILED =
  '(("entityCount" 17394)'
  + ' ("entityByType" (("POLYLINE" . 8419) ("TEXT" . 2517)))'
  + ' ("blockRefCount" 2740) ("blockCount" 1)'
  + ' ("blockUsage" ((("name" . "A1") ("count" . 1) ("isDynamic" . nil))))'
  + ' ("layerCount" 2) ("layerState" (("off" . 1) ("frozen" . 1) ("locked" . 1)))'
  + ' ("textCount" 2520) ("textHeights" (("min" . 2.5) ("max" . 100.0) ("median" . 3.5)))'
  + ' ("sysvars" (("ltscale" . 1000)))'
  + ' ' + LAYERS_DETAIL
  + ' ' + BLOCK_DEFS + ')';

// 历史结构：旧 LISP 用 (cons "k" v)，value 是列表时条目被压平成 ("k" a b c)
const ANALYSIS_LEGACY =
  '(("entityCount" 10)'
  + ' ("entityByType" ("LINE" . 10) ("TEXT" . 5))'
  + ' ("blockUsage" ("name" "A1" "count" 7 "isDynamic" :vlax-true))'
  + ' ("textHeights" "min" 2.0 "max" 8.0 "median" 3.0))';

let capturedCodes = [];

beforeEach(() => {
  vi.clearAllMocks();
  clearCache();
  cadMock.connected = true;
  capturedCodes = [];
  cadMock.sendCommandWithResult.mockImplementation(async (code) => {
    capturedCodes.push(code);
    if (code.includes('layerNames')) return SNAPSHOT;
    if (code.includes('entityByType')) return ANALYSIS_SUMMARY;
    return 'nil';
  });
});

describe('getDrawingAnalysis', () => {
  it('summary（默认）返回完整聚合，不再只剩 1 条', async () => {
    const res = await getDrawingAnalysis();
    expect(res.connected).toBe(true);
    expect(res.type).toBe('summary');
    expect(res.dwgName).toBe('地下车库.dwg');
    expect(res.entityCount).toBe(17394);

    // 修复前 entityByType 只有 ["POLYLINE", 8419]；现在 4 条且按数量降序
    expect(res.entityByType).toHaveLength(4);
    expect(res.entityByType[0]).toEqual({ type: 'POLYLINE', count: 8419 });
    expect(res.entityByType.map(e => e.type)).toEqual(['POLYLINE', 'INSERT', 'TEXT', 'CIRCLE']);

    expect(res.blockRefCount).toBe(2740);
    expect(res.blockCount).toBe(2);
    expect(res.blockUsage).toEqual([
      { name: 'A1', count: 1, isDynamic: false },
      { name: '$DorLib2D$00000001', count: 16, isDynamic: true },
    ]);

    expect(res.layerCount).toBe(96);
    expect(res.layerState).toEqual({ off: 3, frozen: 0, locked: 12 });
    expect(res.textCount).toBe(2520);
    expect(res.textHeights).toEqual({ min: 2.5, max: 100, median: 3.5 });
    expect(res.sysvars).toEqual({ ltscale: 1000, clayer: '0' });

    // summary 不带明细，保证响应体小
    expect(res.layers).toBeUndefined();
    expect(res.blockDefs).toBeUndefined();
    expect(res.blockDefCount).toBeUndefined();
  });

  it('详细模式（?type=detailed）在 summary 之上追加图层与块定义明细', async () => {
    cadMock.sendCommandWithResult.mockImplementation(async (code) => {
      capturedCodes.push(code);
      if (code.includes('layerNames')) return SNAPSHOT;
      return ANALYSIS_DETAILED;
    });
    const res = await getDrawingAnalysis({ type: 'detailed' });
    expect(res.type).toBe('detailed');
    // LISP 的 nil 经解析为 null（falsy），与 T → true 一起表达图层状态
    expect(res.layers).toEqual([
      { name: '0', color: 7, off: null, frozen: null, locked: null, linetype: 'Continuous' },
      { name: 'WALL', color: 9, off: true, frozen: true, locked: true, linetype: 'DASHED' },
    ]);
    expect(res.blockDefCount).toBe(2);
    expect(res.blockDefs).toEqual([
      { name: 'A1', entityCount: 1507, isDynamic: false },
      { name: 'DOOR', entityCount: 12, isDynamic: true },
    ]);
  });

  it('未知 type 回落 summary（避免误取大响应）', async () => {
    const res = await getDrawingAnalysis({ type: 'ALL' });
    expect(res.type).toBe('summary');
    const code = capturedCodes.find(c => c.includes('entityByType'));
    expect(code).not.toContain('(list "linetype" ll)');
    expect(code).not.toContain('(list "layers" layers)');
  });

  it('兼容历史被压平结构（旧服务端返回）', async () => {
    cadMock.sendCommandWithResult.mockImplementation(async (code) => {
      capturedCodes.push(code);
      if (code.includes('layerNames')) return SNAPSHOT;
      return ANALYSIS_LEGACY;
    });
    const res = await getDrawingAnalysis();
    expect(res.entityByType).toEqual([{ type: 'LINE', count: 10 }, { type: 'TEXT', count: 5 }]);
    expect(res.blockUsage).toEqual([{ name: 'A1', count: 7, isDynamic: true }]);
    expect(res.textHeights).toEqual({ min: 2, max: 8, median: 3 });
  });

  it('CAD 未连接时返回 connected:false', async () => {
    cadMock.connected = false;
    cadMock.connect.mockImplementation(async () => false);
    const res = await getDrawingAnalysis();
    expect(res).toEqual({ connected: false, error: 'CAD 未连接' });
  });

  it('解析失败返回错误而不是抛错', async () => {
    cadMock.sendCommandWithResult.mockImplementation(async (code) => (code.includes('layerNames') ? SNAPSHOT : 'garbage'));
    const res = await getDrawingAnalysis();
    expect(res.error).toBe('分析结果解析失败');
  });

  it('analysis-handlers 再导出的是同一实现', () => {
    expect(reExported).toBe(getDrawingAnalysis);
  });
});

describe('buildDrawingAnalysisCode', () => {
  it('聚合条目/记录字段一律用 (list "key" value) 组装', () => {
    const code = buildDrawingAnalysisCode('detailed');
    for (const key of ['entityCount', 'entityByType', 'blockUsage', 'blockRefCount', 'layerCount', 'layerState', 'textCount', 'textHeights', 'sysvars', 'blockDefs', 'blockDefCount', 'layers']) {
      expect(code).toContain(`(list "${key}"`);
      expect(code).not.toContain(`(cons "${key}"`);
    }
    // 记录内部字段同样不能用 cons：value 为 nil 时 (cons "k" nil) 会退化成 ("k")，
    // 字段整个丢失（如 isDynamic=false、图层状态全 false）
    for (const key of ['name', 'count', 'isDynamic', 'entityCount', 'off', 'frozen', 'locked', 'linetype', 'min', 'max', 'median', 'ltscale']) {
      expect(code).not.toContain(`(cons "${key}"`);
    }
  });

  it('块用量按 INSERT 实体统计，不使用 vla-get-Count 当引用数', () => {
    const code = buildDrawingAnalysisCode('summary');
    expect(code).toContain('(ssget "_X" \'((0 . "INSERT")))');
    expect(code).toContain('(assoc 2 (entget (ssname bss bi)))');
    // 排除布局块，引用数降序，summary 最多保留 50 条
    expect(code).toContain('"*Model_Space"');
    expect(code).toContain('(vl-sort blocks');
    expect(code).toContain('(< ci 50)');
  });

  it('detailed 才生成图层明细与块定义明细，且 blockUsage 不截断', () => {
    const summary = buildDrawingAnalysisCode('summary');
    const detailed = buildDrawingAnalysisCode('detailed');
    expect(summary).not.toContain('(list "linetype" ll)');
    expect(summary).not.toContain('(list "layers" layers)');
    expect(summary).not.toContain('blockDefs');
    expect(summary).toContain('(< ci 50)');
    expect(detailed).toContain('(list "linetype" ll)');
    expect(detailed).toContain('(list "layers" layers)');
    expect(detailed).toContain('(list "blockDefs" bdefs)');
    expect(detailed).not.toContain('(< ci 50)');
  });
});
