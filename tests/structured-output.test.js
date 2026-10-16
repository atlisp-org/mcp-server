import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';

const mockSendCommandWithResult = vi.fn();
const mockCad = {
  connected: false,
  connect: vi.fn().mockResolvedValue(true),
  sendCommand: vi.fn(),
  sendCommandWithResult: mockSendCommandWithResult,
  ping: vi.fn().mockResolvedValue(true),
  getInfo: vi.fn().mockResolvedValue('ok'),
  getPlatform: vi.fn().mockReturnValue('AutoCAD'),
  getVersion: vi.fn().mockReturnValue('2025.1'),
  isBusy: vi.fn().mockResolvedValue(false),
  hasDoc: vi.fn().mockResolvedValue({ hasDoc: true }),
};

vi.mock('../src/cad.js', () => ({
  cad: mockCad,
  onDocumentChanged: vi.fn(),
  resolveCadConnection: () => mockCad,
}));
vi.mock('../src/logger.js', () => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  closeLog: vi.fn(),
}));

const {
  parseListText,
  parsePairsText,
  entityBasicStructured,
  entityDetailStructured,
  stringListStructured,
  measureStructured,
  jsonStructured,
} = await import('../src/handlers/structured-output.js');

const { getEntity, selectEntities } = await import('../src/handlers/entity-handlers.js');
const { getBlocks } = await import('../src/handlers/block-handlers.js');
const {
  listGroups, getGroupEntities, measureDistance, measureArea, getEntityInfo, listPageSetups,
} = await import('../src/handlers/query-print-handlers.js');
const { listUcs, listLayouts } = await import('../src/handlers/ucs-layout-handlers.js');
const { getSystemStatus } = await import('../src/handlers/cad-handlers.js');
const { tools } = await import('../src/tools/index.js');
const { handleToolCall } = await import('../src/tool-executor.js');
const { registerTool } = await import('../src/tool-registry.js');

const validator = new AjvJsonSchemaValidator();

/**
 * 校验成功结果同时带 content（文本）与符合 outputSchema 的 structuredContent。
 * @param {string} toolName
 * @param {{content?: Array<{type: string, text?: string}>, isError?: boolean, structuredContent?: object}} result
 */
function expectValidStructured(toolName, result) {
  const def = tools.find((t) => t.name === toolName);
  expect(def, `${toolName} 未找到工具定义`).toBeTruthy();
  expect(def.outputSchema, `${toolName} 未声明 outputSchema`).toBeTruthy();
  expect(result.isError, `${toolName} 不应为错误结果`).toBeFalsy();
  expect(Array.isArray(result.content) && result.content.length > 0, `${toolName} 缺少 content`).toBe(true);
  expect(typeof result.content[0].text).toBe('string');
  expect(result.structuredContent, `${toolName} 缺少 structuredContent`).toBeTruthy();
  expect(typeof result.structuredContent).toBe('object');
  const check = validator.getValidator(def.outputSchema)(result.structuredContent);
  expect(check.valid, `${toolName} structuredContent 不符合 outputSchema: ${check.errorMessage}`).toBe(true);
}

describe('structured-output 构建器', () => {
  it('parseListText 解析 Lisp 列表与 JSON 数组', () => {
    expect(parseListText('("A" "B")')).toEqual(['A', 'B']);
    expect(parseListText('["A", "B"]')).toEqual(['A', 'B']);
    expect(parseListText('"("A")"')).toEqual(['A']);
    expect(parseListText('普通文本')).toBeNull();
    expect(parseListText('nil')).toBeNull();
  });

  it('parsePairsText 解析扁平与嵌套键值对', () => {
    expect(parsePairsText('("type" "LINE" "handle" "1F")')).toEqual({ type: 'LINE', handle: '1F' });
    expect(parsePairsText('(list "type" "LINE" "color" 1)')).toEqual({ type: 'LINE', color: 1 });
    expect(parsePairsText('(("type" "LINE") ("handle" "1F"))')).toEqual({ type: 'LINE', handle: '1F' });
    expect(parsePairsText('不是列表')).toBeNull();
  });

  it('entityBasicStructured / entityDetailStructured 保证必填字段', () => {
    const basic = entityBasicStructured('("type" "CIRCLE" "handle" "2B" "layer" "0" "color" 1)');
    expect(basic).toMatchObject({ type: 'CIRCLE', handle: '2B', layer: '0', color: 1 });
    expect(typeof basic.elevation).toBe('number');
    expect(basic.raw).toBeUndefined();

    const broken = entityBasicStructured('无法解析');
    expect(broken).toMatchObject({ type: '', handle: '', layer: '' });
    expect(broken.raw).toBe('无法解析');

    const detail = entityDetailStructured('(("type" "LINE") ("handle" "1F") ("layer" "0") ("layerLocked" T) ("layerFrozen" nil))');
    expect(detail).toMatchObject({ type: 'LINE', handle: '1F', layer: '0', layerLocked: true, layerFrozen: false });
  });

  it('stringListStructured 解析列表并在失败时回退', () => {
    expect(stringListStructured('("A" "B")', 'items')).toEqual({ count: 2, items: ['A', 'B'] });
    expect(stringListStructured('[]', 'items')).toEqual({ count: 0, items: [] });
    expect(stringListStructured('空', 'items')).toEqual({ count: 0, items: [], raw: '空' });
    expect(stringListStructured(null, 'items')).toEqual({ count: 0, items: [] });
    expect(stringListStructured('("1F")', 'handles', { groupName: 'G1' }))
      .toEqual({ groupName: 'G1', count: 1, handles: ['1F'] });
  });

  it('measureStructured 提取数值标签，失败时返回 raw', () => {
    const dist = measureStructured(
      '("Distance: 100.0000" "Angle: 45.00°" "DX: 70.7107" "DY: 70.7107")',
      { distance: 'distance', angle: 'angleDeg', dx: 'dx', dy: 'dy' }
    );
    expect(dist).toEqual({ distance: 100, angleDeg: 45, dx: 70.7107, dy: 70.7107 });

    const area = measureStructured('("Area: 10000.0 sq units" "Perimeter: 400.0")',
      { area: 'area', perimeter: 'perimeter' });
    expect(area).toEqual({ area: 10000, perimeter: 400 });

    expect(measureStructured('100.0', { distance: 'distance' })).toEqual({ raw: '100.0' });
  });

  it('jsonStructured 解析对象，失败时返回 raw', () => {
    expect(jsonStructured('{"a":1}')).toEqual({ a: 1 });
    expect(jsonStructured('坏数据')).toEqual({ raw: '坏数据' });
    expect(jsonStructured('[1,2]')).toEqual({ raw: '[1,2]' });
  });
});

describe('只读查询工具的 outputSchema + structuredContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCad.connected = false;
  });

  it('get_entity', async () => {
    mockCad.connected = true;
    mockSendCommandWithResult.mockResolvedValue(
      '("type" "LINE" "handle" "1F" "layer" "0" "color" 256 "linetype" "Continuous" "elevation" 0.0)'
    );
    expectValidStructured('get_entity', await getEntity('1F'));
  });

  it('select_entities（无匹配时也返回 structuredContent）', async () => {
    mockCad.connected = true;
    mockSendCommandWithResult.mockResolvedValue('("1F" "2A")');
    expectValidStructured('select_entities', await selectEntities({ type: 'LINE' }));

    mockSendCommandWithResult.mockResolvedValue('nil');
    const empty = await selectEntities({ type: 'CIRCLE' });
    expectValidStructured('select_entities', empty);
    expect(empty.structuredContent).toMatchObject({ count: 0, handles: [] });
  });

  it('get_blocks（空图形返回 structuredContent）', async () => {
    mockCad.connected = true;
    mockSendCommandWithResult.mockResolvedValue('("Block1" "Block2")');
    expectValidStructured('get_blocks', await getBlocks());

    mockSendCommandWithResult.mockResolvedValue('nil');
    const empty = await getBlocks();
    expectValidStructured('get_blocks', empty);
    expect(empty.structuredContent).toMatchObject({ count: 0, blocks: [] });
  });

  it('get_entity_info', async () => {
    mockCad.connected = true;
    mockSendCommandWithResult.mockResolvedValue(
      '(("type" "LINE") ("handle" "1F") ("layer" "0") ("color" 1) ("layerFrozen" nil) ("layerLocked" T))'
    );
    const result = await getEntityInfo('1F');
    expectValidStructured('get_entity_info', result);
    expect(result.structuredContent).toMatchObject({ type: 'LINE', layerLocked: true, layerFrozen: false });
  });

  it('list_groups / get_group_entities', async () => {
    mockCad.connected = true;
    mockSendCommandWithResult.mockResolvedValue('("G1" "G2")');
    expectValidStructured('list_groups', await listGroups());

    mockSendCommandWithResult.mockResolvedValue('("1F" "2A")');
    const entities = await getGroupEntities('G1');
    expectValidStructured('get_group_entities', entities);
    expect(entities.structuredContent).toMatchObject({ groupName: 'G1', count: 2 });
  });

  it('measure_distance / measure_area', async () => {
    mockCad.connected = true;
    mockSendCommandWithResult.mockResolvedValue(
      '("Distance: 100.0000" "Angle: 45.00°" "DX: 70.7107" "DY: 70.7107")'
    );
    const dist = await measureDistance('0,0', '100,100');
    expectValidStructured('measure_distance', dist);
    expect(dist.structuredContent).toMatchObject({ distance: 100, angleDeg: 45 });

    // 无法解析时回退为 raw，且仍符合 outputSchema
    mockSendCommandWithResult.mockResolvedValue('100.0');
    const fallback = await measureDistance('0,0', '100,0');
    expectValidStructured('measure_distance', fallback);
    expect(fallback.structuredContent).toEqual({ raw: '100.0' });

    mockSendCommandWithResult.mockResolvedValue('("Area: 10000.0 sq units" "Perimeter: 400.0")');
    const area = await measureArea('0,0 100,0 100,100 0,100');
    expectValidStructured('measure_area', area);
    expect(area.structuredContent).toMatchObject({ area: 10000, perimeter: 400 });
  });

  it('list_page_setups', async () => {
    mockCad.connected = true;
    mockSendCommandWithResult.mockResolvedValue('("A3打印" "PDF输出")');
    expectValidStructured('list_page_setups', await listPageSetups());

    mockSendCommandWithResult.mockResolvedValue('[]');
    const empty = await listPageSetups();
    expectValidStructured('list_page_setups', empty);
    expect(empty.structuredContent).toMatchObject({ count: 0, pageSetups: [] });
  });

  it('list_ucs / list_layouts', async () => {
    mockCad.connected = true;
    mockSendCommandWithResult.mockResolvedValue('("World" "MyUCS")');
    expectValidStructured('list_ucs', await listUcs());

    mockSendCommandWithResult.mockResolvedValue('("Model" "Layout1")');
    expectValidStructured('list_layouts', await listLayouts());

    mockSendCommandWithResult.mockResolvedValue('nil');
    expectValidStructured('list_ucs', await listUcs());
    expectValidStructured('list_layouts', await listLayouts());
  });

  it('get_system_status', async () => {
    mockCad.connected = false;
    const result = await getSystemStatus();
    expectValidStructured('get_system_status', result);
    expect(result.structuredContent).toHaveProperty('mcp');
    expect(result.structuredContent).toHaveProperty('cad');
  });
});

describe('tool-executor 的 structuredContent 透传与回填', () => {
  it('handler 返回 structuredContent 时原样透传', async () => {
    mockCad.connected = true;
    mockSendCommandWithResult.mockResolvedValue('("World" "MyUCS")');
    const result = await handleToolCall('list_ucs', {});
    expect(result.structuredContent).toMatchObject({ count: 2, ucs: ['World', 'MyUCS'] });
    expect(result.content[0].text).toContain('World');
  });

  it('缺少 content 时自动回填 JSON 文本块', async () => {
    registerTool(
      { name: 'zz_structured_probe', description: '结构化输出测试工具', inputSchema: { type: 'object', properties: {} } },
      async () => ({ structuredContent: { hello: 'world' } })
    );
    const result = await handleToolCall('zz_structured_probe', {});
    expect(result.structuredContent).toEqual({ hello: 'world' });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(JSON.parse(result.content[0].text)).toEqual({ hello: 'world' });
  });

  it('非对象的 structuredContent 会被丢弃', async () => {
    registerTool(
      { name: 'zz_structured_invalid', description: '非法结构化输出测试工具', inputSchema: { type: 'object', properties: {} } },
      async () => ({ content: [{ type: 'text', text: 'ok' }], structuredContent: ['not', 'an', 'object'] })
    );
    const result = await handleToolCall('zz_structured_invalid', {});
    expect(result).not.toHaveProperty('structuredContent');
    expect(result.content[0].text).toBe('ok');
  });

  it('普通工具结果保持不变（不新增字段）', async () => {
    const result = await handleToolCall('get_platform_info', {});
    expect(result).not.toHaveProperty('structuredContent');
    expect(result.content[0].text).toContain('AutoCAD');
  });
});
