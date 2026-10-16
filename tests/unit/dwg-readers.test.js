// entity-readers.js + metadata-readers.js 覆盖：mock cad/cad-pool，
// 覆盖实体/文本/块参照/表/包/图形列表读取的解析、缓存、错误分支
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

const activeState = vi.hoisted(() => ({ conn: null }));

const cadMock = vi.hoisted(() => ({
  connected: true,
  connect: vi.fn(async () => true),
  isBusy: vi.fn(async () => false),
  getPlatform: vi.fn(() => 'AutoCAD'),
  getVersion: vi.fn(() => '2025.1'),
  sendCommandWithResult: vi.fn(),
}));

const poolMock = vi.hoisted(() => ({
  getStats: vi.fn(() => ({ active: 'inst1', total: 1, instances: [] })),
  getConnection: vi.fn(() => null),
  onInstanceSwitch: vi.fn(),
  setActive: vi.fn(),
  list: vi.fn(() => []),
}));

vi.mock('../../src/cad.js', () => ({
  cad: cadMock,
  getActiveConnection: () => activeState.conn,
  onDocumentChanged: vi.fn(),
  resolveCadConnection: () => cadMock,
}));
vi.mock('../../src/cad-pool.js', () => ({ pool: poolMock }));
vi.mock('../../src/logger.js', () => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  closeLog: vi.fn(),
}));

const er = await import('../../src/handlers/entity-readers.js');
const mr = await import('../../src/handlers/metadata-readers.js');
const { clearCache } = await import('../../src/handlers/resource-cache.js');
const { log } = await import('../../src/logger.js');

beforeAll(() => {
  // cad.isBusy 默认成功
});

afterAll(() => {
  activeState.conn = null;
});

beforeEach(() => {
  vi.clearAllMocks();
  clearCache();
  cadMock.connected = true;
  activeState.conn = null;
  cadMock.connect.mockImplementation(async () => true);
  cadMock.isBusy.mockImplementation(async () => false);
  cadMock.getPlatform.mockReturnValue('AutoCAD');
  cadMock.getVersion.mockReturnValue('2025.1');
  cadMock.sendCommandWithResult.mockReset();
  cadMock.sendCommandWithResult.mockImplementation(async () => 'nil');
});

describe('getEntityByHandle', () => {
  it('返回 JSON 实体详情', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce('{"type":"LINE","handle":"A1","layer":"0"}');
    const res = await er.getEntityByHandle('A1');
    expect(res).toEqual({ type: 'LINE', handle: 'A1', layer: '0' });
    expect(cadMock.sendCommandWithResult.mock.calls[0][0]).toContain('(handent "A1")');
  });

  it('nil 结果返回未找到错误', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce('nil');
    expect(await er.getEntityByHandle('ZZ')).toEqual({ error: '未找到实体: ZZ' });
  });

  it('非 JSON 结果返回 raw', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce('some-lisp-output');
    expect(await er.getEntityByHandle('A1')).toEqual({ raw: 'some-lisp-output' });
  });

  it('CAD 异常返回 error', async () => {
    cadMock.sendCommandWithResult.mockRejectedValueOnce(new Error('handent fail'));
    expect(await er.getEntityByHandle('A1')).toEqual({ error: 'handent fail' });
  });
});

describe('getCadInfo', () => {
  it('未连接且连接失败时返回断连状态', async () => {
    cadMock.connected = false;
    cadMock.connect.mockImplementation(async () => { /* 不改变连接状态 */ });
    const res = await er.getCadInfo();
    expect(res).toEqual({ connected: false, platform: null, version: null, busy: false });
    expect(cadMock.connect).toHaveBeenCalled();
  });

  it('已连接时返回平台信息并缓存（二次调用命中缓存）', async () => {
    const res = await er.getCadInfo();
    expect(res).toEqual({ connected: true, platform: 'AutoCAD', version: '2025.1', busy: false });
    expect(await er.getCadInfo()).toBe(res); // 缓存同一引用
    expect(cadMock.isBusy).toHaveBeenCalledTimes(1);
  });

  it('isBusy 异常时 busy=false 并记日志', async () => {
    cadMock.isBusy.mockRejectedValueOnce(new Error('busy boom'));
    const res = await er.getCadInfo();
    expect(res.busy).toBe(false);
    expect(log).toHaveBeenCalledWith('Error checking CAD busy status: busy boom');
  });
});

describe('getEntitiesSummary / getEntities', () => {
  it('汇总解析：total + 按数量倒序的类型统计', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce(
      '(("total" 5) ("LINE" 3) ("CIRCLE" 2))'
    );
    // cacheKey 必须与 getEntities({}) 的 `dwg:entities:{}` 一致才能命中
    const res = await er.getEntitiesSummary('dwg:entities:{}');
    expect(res.total).toBe(5);
    expect(res.summary).toEqual([{ type: 'LINE', count: 3 }, { type: 'CIRCLE', count: 2 }]);
    expect(log).toHaveBeenCalledWith('getEntitiesSummary: total=5, types=2');
    // setCache 写入后 getEntities 无过滤时可直接命中
    const viaGet = await er.getEntities({});
    expect(viaGet).toBe(res);
    expect(cadMock.sendCommandWithResult).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['空串', ''],
    ['nil', 'nil'],
    ['非列表', 'garbage'],
  ])('异常输入(%s)返回空统计', async (_label, input) => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce(input);
    expect(await er.getEntitiesSummary('k1')).toEqual({ total: 0, summary: [] });
  });

  it('total 非数字与非数组项被忽略', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce('(("total" "x") junk (1))');
    const res = await er.getEntitiesSummary('k2');
    expect(res.total).toBe(0);
    expect(res.summary).toEqual([]);
  });

  it('查询抛错时记录日志并返回空', async () => {
    cadMock.sendCommandWithResult.mockRejectedValueOnce(new Error('sum fail'));
    expect(await er.getEntitiesSummary('k3')).toEqual({ total: 0, summary: [] });
    expect(log).toHaveBeenCalledWith('getEntitiesSummary error: sum fail');
  });

  it('带过滤条件时解析实体属性列表并缓存', async () => {
    // propertyPairsToObject 期望每个实体为 [key, value] 对数组
    cadMock.sendCommandWithResult.mockResolvedValueOnce(
      '(2 ('
      + '(("type" "LINE") ("handle" "A1") ("layer" "0")) '
      + '(("type" "LINE") ("handle" "A2") ("layer" "Wall"))))'
    );
    const res = await er.getEntities({ type: 'LINE' });
    expect(res.total).toBe(2);
    expect(res.entities).toEqual([
      { type: 'LINE', handle: 'A1', layer: '0' },
      { type: 'LINE', handle: 'A2', layer: 'Wall' },
    ]);
    expect(cadMock.sendCommandWithResult.mock.calls[0][0]).toContain('(cons 0 "LINE")');
    // 缓存命中
    expect(await er.getEntities({ type: 'LINE' })).toBe(res);
    expect(cadMock.sendCommandWithResult).toHaveBeenCalledTimes(1);
  });

  it('bbox 过滤进入查询代码', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce('(0 ())');
    await er.getEntities({ bbox: '0,0,100,100' });
    const code = cadMock.sendCommandWithResult.mock.calls[0][0];
    expect(code).toContain('"<AND"');
    expect(code).toContain('list 10 0 0 0.0');
  });

  it.each([
    ['nil', 'nil', { total: 0, entities: [] }],
    ['长度不足', '(5)', { total: 0, entities: [] }],
    ['解析失败', 'garbage', { total: 0, entities: [] }],
    ['总数非数字', '("xx" ("a" "b"))', { total: 0, entities: [] }],
    ['实体列表非数组', '(2 "notarray")', { total: 2, entities: [] }],
  ])('过滤查询异常输入(%s)', async (_label, input, expected) => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce(input);
    expect(await er.getEntities({ type: 'CIRCLE', layer: 'x' })).toEqual(expected);
  });

  it('过滤查询抛错时记录日志并返回空', async () => {
    cadMock.sendCommandWithResult.mockRejectedValueOnce(new Error('ent fail'));
    expect(await er.getEntities({ type: 'LINE' })).toEqual({ total: 0, entities: [] });
    expect(log).toHaveBeenCalledWith('getEntities error: ent fail');
  });
});

describe('getTextContent', () => {
  const TEXT_RESULT =
    '("total" 4 "texts" ('
    + '("text" "Hello" "position" (1.0 2.0) "height" 3.5 "handle" "A1") '
    + '("text" "X" "position" (0 0) "height" "abc" "handle" "") '
    + '("text" "Y" "position" 5 "height" 2.0 "handle" "H9") '
    + '("text" "" "position" (0 0) "height" 1.0 "handle" "H0") '
    + '"not-a-record"))';

  it('解析文本列表：类型转换与无效记录过滤', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce(TEXT_RESULT);
    const res = await er.getTextContent();
    expect(res.total).toBe(4);
    expect(res.texts).toEqual([
      { text: 'Hello', position: [1, 2], height: 3.5, handle: 'A1' },
      { text: 'X', position: [0, 0], height: 2.5, handle: '' }, // height 非数字→2.5
      { text: 'Y', position: [], height: 2, handle: 'H9' }, // position 非数组→[]
    ]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[DEBUG text-content]'));
    // 缓存
    expect(await er.getTextContent()).toBe(res);
    expect(cadMock.sendCommandWithResult).toHaveBeenCalledTimes(1);
  });

  it('offset/limit 参数被钳制进查询代码', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce('("total" 0 "texts" nil)');
    await er.getTextContent({ offset: '-5', limit: '99999' });
    const code = cadMock.sendCommandWithResult.mock.calls[0][0];
    expect(code).toContain('(< (length texts) 5000)'); // limit ≤5000
    expect(code).toContain('i 0'); // offset ≥0
    // 非法数字回落默认值
    cadMock.sendCommandWithResult.mockResolvedValueOnce('("total" 0 "texts" nil)');
    await er.getTextContent({ offset: 'abc', limit: 'abc' });
    const code2 = cadMock.sendCommandWithResult.mock.calls[1][0];
    expect(code2).toContain('(< (length texts) 5000)');
    expect(code2).toContain('i 0');
  });

  it('解析失败时记录日志并抛出', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce('garbage');
    await expect(er.getTextContent({ layer: 'x' })).rejects.toThrow('text-content: 解析 Lisp 结果失败');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('getTextContent error'));
  });
});

describe('medianHeight / shouldContinueLine', () => {
  it('medianHeight：空/全无效→2.5，奇数→中位，偶数→均值', () => {
    expect(er.medianHeight([])).toBe(2.5);
    expect(er.medianHeight([{ height: 0 }, { height: -1 }])).toBe(2.5);
    expect(er.medianHeight([{ height: 5 }, { height: 1 }, { height: 3 }])).toBe(3);
    expect(er.medianHeight([{ height: 10 }, { height: 20 }])).toBe(15);
  });

  it('shouldContinueLine：空/空白/句末标点不续行', () => {
    expect(er.shouldContinueLine(null, 'x')).toBe(false);
    expect(er.shouldContinueLine('x', '')).toBe(false);
    expect(er.shouldContinueLine('   ', 'x')).toBe(false);
    expect(er.shouldContinueLine('End.', 'next')).toBe(false);
    expect(er.shouldContinueLine('End。', 'next')).toBe(false);
    expect(er.shouldContinueLine('End!', 'next')).toBe(false);
    expect(er.shouldContinueLine('Continuing', 'next')).toBe(true);
  });
});

describe('combineText', () => {
  it('无文本时返回空块', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce('("total" 0 "texts" nil)');
    expect(await er.combineText()).toEqual({ total: 0, blocks: [], medianHeight: 2.5 });
  });

  it('同行分列、行内断行、跨行分块', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce(
      '("total" 4 "texts" ('
      + '("text" "Alpha" "position" (0 100) "height" 10 "handle" "H1") '
      + '("text" "Beta" "position" (15 100) "height" 10 "handle" "H2") '
      + '("text" "Gamma" "position" (100 100) "height" 10 "handle" "H3") '
      + '("text" "Next" "position" (0 140) "height" 10 "handle" "H4")))'
    );
    const res = await er.combineText();
    expect(res.medianHeight).toBe(10);
    expect(res.total).toBe(2);
    expect(res.blocks[0]).toMatchObject({ text: 'Next', y: 140, rowCount: 1, lines: ['Next'] });
    // 同行内 0→15 间距小合并，15→100 间距 > mh*3 断行；block.lines 为行文本 join(' ')
    expect(res.blocks[1].lines).toEqual(['AlphaBeta Gamma']);
    expect(res.blocks[1].text).toBe('AlphaBeta Gamma');
  });

  it('相邻行未以句末结尾时合并为同一行文本', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce(
      '("total" 2 "texts" ('
      + '("text" "Hello" "position" (0 100) "height" 10 "handle" "H1") '
      + '("text" "World" "position" (0 120) "height" 10 "handle" "H2")))'
    );
    const res = await er.combineText();
    expect(res.total).toBe(1);
    expect(res.blocks[0].rowCount).toBe(2);
    expect(res.blocks[0].lines).toEqual(['WorldHello']); // 自上而下倒序后拼接
    expect(res.blocks[0].y).toBe(120);
  });

  it('前一行以句末结尾时不合并，另起一行', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce(
      '("total" 2 "texts" ('
      + '("text" "Start" "position" (0 100) "height" 10 "handle" "H1") '
      + '("text" "End." "position" (0 120) "height" 10 "handle" "H2")))'
    );
    const res = await er.combineText();
    expect(res.blocks[0].lines).toEqual(['End.', 'Start']);
    expect(res.blocks[0].text).toBe('End.\nStart');
  });

  it('自定义 yTolerance 与缺字段记录', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce(
      '("total" 4 "texts" ('
      + '("text" "AA" "position" (0 100) "height" 10 "handle" "H1") '
      + '("text" "BB" "position" (5 200) "height" 10 "handle" "H2") '
      + '("text" "NoPos" "handle" "H3") '
      + '("position" (0 0) "height" 5 "handle" "H4")))'
    );
    const res = await er.combineText({ yTolerance: 100 });
    expect(res.total).toBe(1);
    // yTolerance=100 使 y=100/200/0 全部归入同一行（rowCount 是行数而非条目数）
    expect(res.blocks[0].rowCount).toBe(1);
    expect(res.blocks[0].text).toContain('NoPos'); // 无 position 记录归入 (0,0)
    expect(res.blocks[0].text).toContain('AA');
  });
});

describe('getDwgName / getDwgPath', () => {
  it('getDwgName 成功/空值/异常', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce('"Plan.dwg"');
    expect(await er.getDwgName()).toEqual({ name: '"Plan.dwg"' });

    cadMock.sendCommandWithResult.mockResolvedValueOnce('');
    expect(await er.getDwgName()).toEqual({ name: null });

    cadMock.sendCommandWithResult.mockRejectedValueOnce(new Error('name fail'));
    expect(await er.getDwgName()).toEqual({ name: null });
  });

  it('getDwgPath：JSON 数组解析', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce('["C:/proj/", "Plan.dwg"]');
    expect(await er.getDwgPath()).toEqual({ path: 'C:/proj/', name: 'Plan.dwg' });
  });

  it('getDwgPath：JSON 失败回落 Lisp 列表', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce('("C:/proj/" "Plan.dwg")');
    expect(await er.getDwgPath()).toEqual({ path: 'C:/proj/', name: 'Plan.dwg' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('JSON parse error'));
  });

  it('getDwgPath：nil/空返回 null', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce('nil');
    expect(await er.getDwgPath()).toEqual({ path: null, name: null });
    cadMock.sendCommandWithResult.mockResolvedValueOnce('');
    expect(await er.getDwgPath()).toEqual({ path: null, name: null });
  });

  it('getDwgPath：无法解析时返回原始结果 / 异常返回 null', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce('some-raw');
    expect(await er.getDwgPath()).toEqual({ path: 'some-raw', name: 'some-raw' });

    cadMock.sendCommandWithResult.mockRejectedValueOnce(new Error('path fail'));
    expect(await er.getDwgPath()).toEqual({ path: null, name: null });
  });
});

describe('getBlockRefs', () => {
  it('解析块参照属性：数值清洗、布尔转换、属性字典化', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce(
      '(("total" 3) '
      + '("blockRefs" ('
      + '(("handle" "A1") ("insertionPoint" (1.0 2.0 "bad")) ("scale" (1 "x" 3)) '
      + '("isDynamic" "true") ("attributes" (("TAG1" "V1"))) ("rotation" 45 "extra")) '
      + '(("handle" "A2") ("isDynamic" 0) ("dynamicProperties" (("WIDTH" 500)))) '
      + '"bad-record")))'
    );
    const res = await mr.getBlockRefs();
    expect(res.total).toBe(3);
    expect(res.blockRefs).toHaveLength(3);
    expect(res.blockRefs[0]).toEqual({
      handle: 'A1',
      insertionPoint: [1, 2, 0], // 非数字→0
      scale: [1, 1, 3], // 非数字→1
      isDynamic: true,
      attributes: { TAG1: 'V1' },
      rotation: [45, 'extra'], // 长度≠2 → slice(1)
    });
    expect(res.blockRefs[1]).toMatchObject({ handle: 'A2', isDynamic: false });
    expect(res.blockRefs[1].dynamicProperties).toEqual({ WIDTH: 500 });
    expect(res.blockRefs[2]).toEqual({}); // 非数组记录 → 空对象
    // 缓存
    expect(await mr.getBlockRefs()).toBe(res);
    expect(cadMock.sendCommandWithResult).toHaveBeenCalledTimes(1);
  });

  it('无 total 时回退为 blockRefs 数量', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce(
      '(("blockRefs" ((("handle" "B1")))))'
    );
    const res = await mr.getBlockRefs({ blockName: 'DOOR' });
    expect(res.total).toBe(1);
    expect(cadMock.sendCommandWithResult.mock.calls[0][0]).toContain('(cons 2 "DOOR")');
  });

  it('解析失败时记录日志并抛出', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce('garbage');
    await expect(mr.getBlockRefs({ blockName: 'X' })).rejects.toThrow('block-refs: 解析 Lisp 结果失败');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('getBlockRefs error'));
  });

  it('offset/limit 下推到 LISP 并在响应回填 total/offset/limit', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce(
      '(("total" 2740) ("offset" 5) ("limit" 2) ("blockRefs" ((("handle" "B1")) (("handle" "B2")))))'
    );
    const res = await mr.getBlockRefs({ offset: '5', limit: '2' });
    expect(res.total).toBe(2740);
    expect(res.offset).toBe(5);
    expect(res.limit).toBe(2);
    expect(res.blockRefs).toHaveLength(2);
    const code = cadMock.sendCommandWithResult.mock.calls[0][0];
    expect(code).toContain('i 5');
    expect(code).toContain('(< (length refs) 2)');
  });

  it('不同 offset/limit 走不同缓存键（第一页不冒充第二页）', async () => {
    cadMock.sendCommandWithResult
      .mockResolvedValueOnce('(("total" 4) ("offset" 0) ("limit" 2) ("blockRefs" ((("handle" "P1")))))')
      .mockResolvedValueOnce('(("total" 4) ("offset" 2) ("limit" 2) ("blockRefs" ((("handle" "P3")))))');
    const page1 = await mr.getBlockRefs({ limit: 2 });
    const page2 = await mr.getBlockRefs({ offset: 2, limit: 2 });
    expect(page1.blockRefs[0].handle).toBe('P1');
    expect(page2.blockRefs[0].handle).toBe('P3');
    expect(page1).not.toBe(page2);
    expect(cadMock.sendCommandWithResult).toHaveBeenCalledTimes(2);
  });

  it('属性读取失败要可见：attrReadFailed 归一化成布尔', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce(
      '(("total" 2) ("blockRefs" ('
      + '(("handle" "E1") ("blockName" "_AXISO") ("attributes" (("A" . "K"))) ("attrReadFailed" 1)) '
      + '(("handle" "E2") ("blockName" "WINDOW") ("attributes" nil)))))'
    );
    const res = await mr.getBlockRefs({ limit: 2 });
    expect(res.blockRefs[0]).toMatchObject({
      handle: 'E1', attributes: { A: 'K' }, attrReadFailed: true,
    });
    // 无属性（读取正常但为空）不带 attrReadFailed
    expect(res.blockRefs[1].attributes).toBeNull();
    expect(res.blockRefs[1].attrReadFailed).toBeUndefined();
  });

  it('生成的 LISP 用纯 ActiveX 读属性，不依赖未加载的 @lisp lib', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce('(("total" 0) ("blockRefs" nil))');
    await mr.getBlockRefs({ limit: 1 });
    const code = cadMock.sendCommandWithResult.mock.calls[0][0];
    // 目标会话没有 lib：block:get-attributes / block:get-properties 都不存在
    expect(code).not.toContain('(block:get-attributes');
    expect(code).not.toContain("'block:get-attributes");
    expect(code).not.toContain("'block:get-properties");
    expect(code).toContain("'vla-get-HasAttributes");
    // vla-get-Attributes 在本环境报「函数错误」，必须用方法形式
    expect(code).toContain("(vl-catch-all-apply 'vlax-invoke (list o 'GetAttributes))");
    expect(code).toContain("(list \"attributes\" (if (= 1 (car af)) (cdr af) nil))");
    expect(code).toContain('(list "attrReadFailed" 1)');
    // nil 字段用 (list ...) 保留 key（(cons "k" nil) 会退化成 ("k") 被服务端丢掉）
    expect(code).not.toContain('(cons "attributes"');
    // 分页条件与不分页的恒真条件都不能用 T（会话里 T 可能被绑成 nil，会静默变成恒假）
    expect(code).toContain('(< (length refs) 1)');
    expect(code).not.toMatch(/\(and \(< i total\) T\)/);
    clearCache();
    cadMock.sendCommandWithResult.mockResolvedValueOnce('(("total" 0) ("blockRefs" nil))');
    await mr.getBlockRefs();
    expect(cadMock.sendCommandWithResult.mock.calls.at(-1)[0]).toContain('(< i total) 1)');
  });
});

describe('getTables', () => {
  it.each([
    ['空串', ''],
    ['nil', 'nil'],
  ])('空结果(%s)返回空 data', async (_label, input) => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce(input);
    expect(await mr.getTables({ tbl: 'layer' })).toEqual({ table: 'layer', data: [] });
  });

  it('解析失败返回 table/total/data 空结构', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce('garbage');
    expect(await mr.getTables({ tbl: 'layer' })).toEqual({ table: 'layer', total: 0, data: [] });
  });

  it('单表格式：TABLE/TOTAL/DATA 头解析', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce(
      '(("TABLE" "layer") ("TOTAL" 2) '
      + '("DATA" (((2 "0") (62 7) (70 0)) ((2 "Wall") (62 1) (6  DASHED)) "bad-rec")))'
    );
    const res = await mr.getTables({ tbl: 'layer' });
    expect(res.table).toBe('layer');
    expect(res.total).toBe(2);
    expect(res.data).toEqual([
      { name: '0', color: 7, flags: 0, frozen: false, locked: false },
      { name: 'Wall', color: 1, linetype: 'DASHED' },
    ]);
    // 缓存
    expect(await mr.getTables({ tbl: 'layer' })).toBe(res);
    expect(cadMock.sendCommandWithResult).toHaveBeenCalledTimes(1);
  });

  it('单表格式：DATA 缺失/为空时取 slice(2)，TOTAL 非数字按 0', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce(
      '(("TABLE" "layer") ("TOTAL" "x") ("DATA" ()))'
    );
    const res = await mr.getTables({ tbl: 'layer', type: 'fallback' });
    expect(res.total).toBe(0);
    expect(res.data).toEqual([]); // slice(2) 的 TOTAL 对不是合法记录 → 被过滤
  });

  it('多表格式：内层 table 头与平铺 key 两种条目', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce(
      '('
      + '(("table" "layer") ("TOTAL" 1) ("DATA" (((2 "0") (62 7))))) '
      + '(("table" "block") ("TOTAL" "x") ("DATA" "notarr")) '
      + '("plain" ("TOTAL" 1) ("DATA" ((("Name" "Door"))))) '
      + '"junk" (1)'
      + ')'
    );
    const res = await mr.getTables({ tbl: 'all' });
    expect(res.layer).toMatchObject({ total: 1 });
    expect(res.layer.data[0]).toMatchObject({ name: '0', color: 7 });
    expect(res.block).toEqual({ total: 0, data: [] }); // TOTAL 非数字 + DATA 非数组
    expect(res.plain).toEqual({ total: 1, data: [{ Name: 'Door', name: 'Door' }] });
    expect(Object.keys(res)).toEqual(['layer', 'block', 'plain']); // junk 项被跳过
    expect(cadMock.sendCommandWithResult.mock.calls[0][0]).toContain('vl-catch-all-apply'); // all → 组合查询
  });

  it('查询抛错时记录日志并返回空', async () => {
    cadMock.sendCommandWithResult.mockRejectedValueOnce(new Error('tbl fail'));
    expect(await mr.getTables({ tbl: 'layer' })).toEqual({ table: 'layer', data: [] });
    expect(log).toHaveBeenCalledWith('getTables error: tbl fail');
  });
});

describe('getPackages', () => {
  it('nil/空结果返回空数组', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce('nil');
    expect(await mr.getPackages()).toEqual([]);
    cadMock.sendCommandWithResult.mockResolvedValueOnce('');
    expect(await mr.getPackages()).toEqual([]);
  });

  it('JSON 解析：对象/字符串/数字/数组条目各类型映射', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce(JSON.stringify([
      { name: 'pkg-a', version: '1.0', description: 'desc', fullName: 'f', author: 'au', category: 'c', url: 'u' },
      { Name: 'UP', Version: '2.0', Description: 'D2', full_name: 'fn', Author: 'a2', Category: 'cat', Url: 'url2' },
      { ':NAME': 'colon', ':VERSION': '3.0', ':DESCRIPTION': 'cd' },
      'plain-pkg',
      42,
      [ { ':NAME': 'colon-arr' }, { ':VERSION': '5.0' } ],
      null,
      { version: '9.9' }, // 无 name
    ]));
    const pkgs = await mr.getPackages();
    expect(pkgs).toHaveLength(7);
    expect(pkgs[0]).toEqual({ name: 'pkg-a', version: '1.0', description: 'desc', fullName: 'f', author: 'au', category: 'c', url: 'u', loaded: true });
    expect(pkgs[1]).toMatchObject({ name: 'UP', version: '2.0', description: 'D2', fullName: 'fn', author: 'a2', category: 'cat', url: 'url2' });
    expect(pkgs[2]).toMatchObject({ name: 'colon', version: '3.0', description: 'cd' });
    expect(pkgs[3]).toEqual({ name: 'plain-pkg', version: '0.0.0', loaded: true });
    expect(pkgs[4]).toEqual({ name: '42', version: '0.0.0', loaded: true });
    expect(pkgs[5]).toMatchObject({ name: 'colon-arr', version: '5.0' });
    expect(pkgs[6]).toMatchObject({ name: '', version: '9.9' });
  });

  it('非 JSON 走 Lisp 列表解析；非数组结果置空', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce('("lp1" "lp2")');
    const listRes = await mr.getPackages();
    expect(listRes.map(p => p.name)).toEqual(['lp1', 'lp2']);

    cadMock.sendCommandWithResult.mockResolvedValueOnce('{"a":1}');
    expect(await mr.getPackages({ filterName: 'x' })).toEqual([]); // JSON 是对象 → 非数组
  });

  it('按名称过滤并缓存过滤结果', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce(
      JSON.stringify([{ name: 'keep' }, { name: 'drop' }])
    );
    const res = await mr.getPackages('keep');
    expect(res).toEqual([{ name: 'keep', version: '0.0.0', description: '', loaded: true }]);
    expect(await mr.getPackages('keep')).toBe(res);
    expect(cadMock.sendCommandWithResult).toHaveBeenCalledTimes(1);
  });

  it('查询抛错返回空数组', async () => {
    cadMock.sendCommandWithResult.mockRejectedValueOnce(new Error('pkg fail'));
    expect(await mr.getPackages()).toEqual([]);
  });
});

describe('getPlatforms / getCadStatus / getDwgList', () => {
  it('getPlatforms 覆盖四个平台与扩展名', () => {
    const platforms = mr.getPlatforms();
    expect(platforms.map(p => p.name)).toEqual(['AutoCAD', 'ZWCAD', 'GStarCAD', 'BricsCAD']);
    expect(platforms[0].extensions).toEqual(['.fas', '.vlx']);
    expect(platforms[3].extensions).toEqual(['.des']);
  });

  it('getCadStatus：默认连接与池内实例一致时不追加', async () => {
    const inst = { key: 'inst1', connected: true, platform: 'AutoCAD', version: '2025', label: 'A', queueSize: 0 };
    const conn = { ...inst };
    poolMock.getStats.mockReturnValueOnce({ active: 'inst1', total: 1, instances: [inst] });
    poolMock.getConnection.mockReturnValueOnce(conn);
    activeState.conn = conn;
    const res = await mr.getCadStatus();
    expect(res).toEqual({
      active: 'inst1',
      total: 1,
      instances: [{
        key: 'inst1', connected: true, platform: 'AutoCAD', version: '2025',
        label: 'A', queueSize: 0, stall: { stalled: false, reason: null, remainingMs: 0 },
      }],
    });
  });

  it('getCadStatus：活动连接与池不同则追加 isActive 条目（含 stall 与无方法分支）', async () => {
    poolMock.getStats.mockReturnValueOnce({
      active: 'old',
      total: 2,
      instances: [{ key: 'old', connected: false, platform: 'ZWCAD', version: '24', label: '旧', queueSize: 3, stall: { stalled: true, reason: 'busy', remainingMs: 500 } }],
    });
    poolMock.getConnection.mockReturnValueOnce({ key: 'old' });
    activeState.conn = {
      connected: true,
      getPlatform: () => 'AutoCAD',
      getVersion: () => '2025.1',
      _getQueueSize: () => 2,
      getStallInfo: () => ({ stalled: false, reason: null, remainingMs: 0 }),
    };
    const res = await mr.getCadStatus();
    expect(res.instances[0].stall).toEqual({ stalled: true, reason: 'busy', remainingMs: 500 });
    expect(res.instances[1]).toEqual({
      key: 'old', connected: true, platform: 'AutoCAD', version: '2025.1',
      label: '默认连接', queueSize: 2,
      stall: { stalled: false, reason: null, remainingMs: 0 }, isActive: true,
    });

    // 活动连接缺少 _getQueueSize/getStallInfo → 默认值分支
    poolMock.getStats.mockReturnValueOnce({ active: 'x', total: 1, instances: [] });
    poolMock.getConnection.mockReturnValueOnce(null);
    activeState.conn = { connected: true, getPlatform: () => 'GStarCAD', getVersion: () => '1.0' };
    const res2 = await mr.getCadStatus();
    expect(res2.instances[0]).toMatchObject({ key: 'x', queueSize: 0, isActive: true });
    expect(res2.instances[0].stall).toEqual({ stalled: false, reason: null, remainingMs: 0 });
  });

  it('getDwgList：JSON / Lisp / 空 / 非数组多种输入', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce('[["a.dwg", "C:/x/a.dwg"], ["bad"], ["b.dwg", "C:/y/b.dwg"]]');
    expect(await mr.getDwgList()).toEqual([
      { name: 'a.dwg', path: 'C:/x/a.dwg' },
      { name: 'b.dwg', path: 'C:/y/b.dwg' },
    ]);

    cadMock.sendCommandWithResult.mockResolvedValueOnce('nil');
    clearCache(); // 同测试内多输入需清缓存，否则命中上一次结果
    expect(await mr.getDwgList()).toEqual([]);

    cadMock.sendCommandWithResult.mockResolvedValueOnce('"just-a-string"');
    clearCache();
    expect(await mr.getDwgList()).toEqual([]); // JSON 解析成功但非数组

    cadMock.sendCommandWithResult.mockResolvedValueOnce('garbage');
    clearCache();
    expect(await mr.getDwgList()).toEqual([]); // Lisp 解析也非数组

    cadMock.sendCommandWithResult.mockRejectedValueOnce(new Error('dwgs fail'));
    clearCache();
    expect(await mr.getDwgList()).toEqual([]);
  });

  it('getDwgList 缓存命中', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce('[["c.dwg", "C:/c.dwg"]]');
    const res = await mr.getDwgList();
    expect(await mr.getDwgList()).toBe(res);
    expect(cadMock.sendCommandWithResult).toHaveBeenCalledTimes(1);
  });
});
