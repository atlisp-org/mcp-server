import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendCommandWithResult = vi.fn();
const mockConnect = vi.fn();

const mockCad = {
  connected: false,
  connect: mockConnect,
  sendCommandWithResult: mockSendCommandWithResult,
  getPlatform: vi.fn(),
  getVersion: vi.fn(),
};

vi.mock('../src/cad.js', () => ({ cad: mockCad }));
vi.mock('../src/logger.js', () => ({ log: vi.fn(), closeLog: vi.fn() }));
vi.mock('../src/config.js', () => ({
  default: {
    port: 8110, host: '0.0.0.0', transport: 'stdio',
    resourceCacheTtl: 0, apiKey: '', enableSse: true,
    messageTimeout: 60000, heartbeatInterval: 30000,
    busyRetries: 10, busyDelay: 500,
    enableCors: false, corsOrigin: '*',
    rateLimitWindow: 60000, rateLimitMax: 100,
    debug: false, debugFile: '',
  },
  getConfig: () => {},
  getAllConfig: () => ({}),
}));

vi.mock('../src/constants.js', () => ({
  CAD_PLATFORMS: ['AutoCAD', 'ZWCAD', 'GStarCAD', 'BricsCAD'],
  FILE_EXTENSIONS: {
    'AutoCAD': ['.fas', '.vlx'], 'ZWCAD': ['.zelx', '.vls'],
    'GStarCAD': ['.fas', '.vlx'], 'BricsCAD': ['.des']
  },
  MOCK_PACKAGES: [],
  PROTOCOL_VERSION: '2024-11-05',
  SERVER_NAME: 'atlisp-mcp-server',
  SERVER_VERSION: '1.0.10',
}));

function buildLispResult(texts) {
  const items = texts.map(t => {
    const pos = t.position || [0, 0, 0];
    const textStr = `"${t.text.replace(/"/g, '\\"')}"`;
    return `("text" ${textStr} "position" (${pos[0]} ${pos[1]} ${pos[2]}) "height" ${t.height ?? 2.5} "handle" "${t.handle || ''}")`;
  });
  return `("total" ${texts.length} "offset" 0 "limit" 5000 "texts" (${items.join(' ')}))`;
}

describe('combineText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCad.connected = false;
  });

  it('returns empty blocks when no texts', async () => {
    mockCad.connected = true;
    mockSendCommandWithResult.mockResolvedValue(
      '("total" 0 "offset" 0 "limit" 5000 "texts" nil)'
    );
    const { combineText } = await import('../src/handlers/resource-readers.js');
    const result = await combineText({});
    expect(result.total).toBe(0);
    expect(result.blocks).toEqual([]);
    expect(result.medianHeight).toBe(2.5);
  });

  it('groups two close texts on same line into one block', async () => {
    mockCad.connected = true;
    const lispResult = buildLispResult([
      { text: 'Hello', position: [0, 0, 0], height: 2.5, handle: '1' },
      { text: 'World', position: [5, 0, 0], height: 2.5, handle: '2' },
    ]);
    mockSendCommandWithResult.mockResolvedValue(lispResult);
    const { combineText } = await import('../src/handlers/resource-readers.js');
    const result = await combineText({});
    expect(result.total).toBe(1);
    expect(result.blocks[0].text).toBe('HelloWorld');
    expect(result.blocks[0].rowCount).toBe(1);
    expect(result.blocks[0].lines).toHaveLength(1);
  });

  it('splits text into two blocks when Y gap is large', async () => {
    mockCad.connected = true;
    const lispResult = buildLispResult([
      { text: 'Title', position: [0, 100, 0], height: 5, handle: '1' },
      { text: 'Note', position: [0, 0, 0], height: 5, handle: '2' },
    ]);
    mockSendCommandWithResult.mockResolvedValue(lispResult);
    const { combineText } = await import('../src/handlers/resource-readers.js');
    const result = await combineText({});
    expect(result.total).toBe(2);
    expect(result.blocks[0].text).toBe('Title');
    expect(result.blocks[1].text).toBe('Note');
  });

  it('groups into same row within Y tolerance', async () => {
    mockCad.connected = true;
    const lispResult = buildLispResult([
      { text: 'Left', position: [0, 0, 0], height: 10, handle: '1' },
      { text: 'Right', position: [20, 10, 0], height: 10, handle: '2' },
    ]);
    mockSendCommandWithResult.mockResolvedValue(lispResult);
    const { combineText } = await import('../src/handlers/resource-readers.js');
    const result = await combineText({});
    expect(result.total).toBe(1);
    expect(result.blocks[0].text).toBe('LeftRight');
  });

  it('handles Chinese text self-intersection (续句检测)', async () => {
    mockCad.connected = true;
    const lispResult = buildLispResult([
      { text: '这是一个很长', position: [0, 100, 0], height: 5, handle: '1' },
      { text: '的句子需要续行', position: [0, 90, 0], height: 5, handle: '2' },
      { text: '这是另一段。', position: [0, 70, 0], height: 5, handle: '3' },
    ]);
    mockSendCommandWithResult.mockResolvedValue(lispResult);
    const { combineText } = await import('../src/handlers/resource-readers.js');
    const result = await combineText({});
    expect(result.total).toBe(2);
    expect(result.blocks[0].text).toBe('这是一个很长的句子需要续行');
    expect(result.blocks[1].text).toBe('这是另一段。');
  });

  it('does not continue line after period', async () => {
    mockCad.connected = true;
    const lispResult = buildLispResult([
      { text: 'First sentence.', position: [0, 100, 0], height: 5, handle: '1' },
      { text: 'Second sentence.', position: [0, 90, 0], height: 5, handle: '2' },
    ]);
    mockSendCommandWithResult.mockResolvedValue(lispResult);
    const { combineText } = await import('../src/handlers/resource-readers.js');
    const result = await combineText({});
    expect(result.total).toBe(1);
    expect(result.blocks[0].lines).toHaveLength(2);
    expect(result.blocks[0].text).toBe('First sentence.\nSecond sentence.');
  });

  it('skips empty text entries', async () => {
    mockCad.connected = true;
    const lispResult = buildLispResult([
      { text: '', position: [0, 0, 0], height: 2.5, handle: '1' },
      { text: 'Visible', position: [10, 0, 0], height: 2.5, handle: '2' },
    ]);
    mockSendCommandWithResult.mockResolvedValue(lispResult);
    const { combineText } = await import('../src/handlers/resource-readers.js');
    const result = await combineText({});
    expect(result.total).toBe(1);
    expect(result.blocks[0].text).toBe('Visible');
  });

  it('splits segments on same row when X gap is large', async () => {
    mockCad.connected = true;
    const lispResult = buildLispResult([
      { text: 'Name:', position: [0, 0, 0], height: 2.5, handle: '1' },
      { text: 'John', position: [100, 0, 0], height: 2.5, handle: '2' },
    ]);
    mockSendCommandWithResult.mockResolvedValue(lispResult);
    const { combineText } = await import('../src/handlers/resource-readers.js');
    const result = await combineText({});
    expect(result.total).toBe(1);
    expect(result.blocks[0].text).toBe('Name: John');
  });

  it('sorts blocks from top to bottom', async () => {
    mockCad.connected = true;
    const lispResult = buildLispResult([
      { text: 'Bottom', position: [0, 0, 0], height: 5, handle: '1' },
      { text: 'Top', position: [0, 100, 0], height: 5, handle: '2' },
    ]);
    mockSendCommandWithResult.mockResolvedValue(lispResult);
    const { combineText } = await import('../src/handlers/resource-readers.js');
    const result = await combineText({});
    expect(result.total).toBe(2);
    expect(result.blocks[0].text).toBe('Top');
    expect(result.blocks[1].text).toBe('Bottom');
  });
});
