import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';

const mockSendCommand = vi.fn();
const mockSendCommandWithResult = vi.fn();
const mockConnect = vi.fn();
const mockGetPlatform = vi.fn();
const mockGetVersion = vi.fn();

const mockCad = {
  connected: false,
  connect: mockConnect,
  sendCommand: mockSendCommand,
  sendCommandWithResult: mockSendCommandWithResult,
  getPlatform: mockGetPlatform,
  getVersion: mockGetVersion,
};

vi.mock('../src/cad.js', () => ({ cad: mockCad }));
vi.mock('../src/logger.js', () => ({ log: vi.fn(), closeLog: vi.fn() }));
vi.mock('../src/config.js', () => ({
  default: {
    port: 8110, host: '0.0.0.0', transport: 'stdio',
    resourceCacheTtl: 0,
    apiKey: '', enableSse: true,
    messageTimeout: 60000, heartbeatInterval: 30000,
    busyRetries: 10, busyDelay: 500,
    enableCors: false, corsOrigin: '*',
    rateLimitWindow: 60000, rateLimitMax: 100,
    debug: false, debugFile: '',
  },
  getConfig: () => {},
  getAllConfig: () => ({}),
}));

const originalFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error('fetch disabled in tests'));
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

vi.mock('../src/constants.js', () => ({
  CAD_PLATFORMS: ['AutoCAD', 'ZWCAD', 'GStarCAD', 'BricsCAD'],
  FILE_EXTENSIONS: {
    'AutoCAD': ['.fas', '.vlx'],
    'ZWCAD': ['.zelx', '.vls'],
    'GStarCAD': ['.fas', '.vlx'],
    'BricsCAD': ['.des']
  },
  MOCK_PACKAGES: [
    { name: 'base', description: '基础函数库', version: '1.0.0' },
    { name: 'at-pm', description: '工程项目管理', version: '2.1.0' },
    { name: 'network', description: '网络功能模块', version: '1.5.0' },
    { name: 'userman', description: '用户管理', version: '1.2.0' },
    { name: 'pkgman', description: '包管理器', version: '2.0.0' },
    { name: 'sidebar', description: '侧边栏工具', version: '1.0.0' },
    { name: 'aibot', description: 'AI 助手', version: '0.9.0' },
    { name: 'tips', description: '每日提示', version: '1.0.0' },
    { name: 'function', description: '函数库', version: '3.0.0' }
  ],
  PROTOCOL_VERSION: '2024-11-05',
  SERVER_NAME: 'atlisp-mcp-server',
  SERVER_VERSION: '1.0.10',
}));

const {
  listResources,
  readResource,
  clearCache,
  RESOURCES,
} = await import('../src/handlers/resource-handlers.js');

describe('resource-handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCad.connected = false;
    clearCache();
  });

  describe('RESOURCES static list', () => {
    it('contains atlisp://packages as subscribable resource', () => {
      const pkgRes = RESOURCES.find(r => r.uri === 'atlisp://packages');
      expect(pkgRes).toBeDefined();
      expect(pkgRes.name).toBe('Packages');
      expect(pkgRes.mimeType).toBe('application/json');
      expect(pkgRes.subscribable).toBe(true);
    });

    it('contains all expected resources', () => {
      expect(RESOURCES).toHaveLength(16);
      const uris = RESOURCES.map(r => r.uri);
      expect(uris).toContain('atlisp://cad/info');
      expect(uris).toContain('atlisp://dwg/entities');
      expect(uris).toContain('atlisp://dwg/text-content');
      expect(uris).toContain('atlisp://dwg/text-combined');
      expect(uris).toContain('atlisp://dwg/name');
      expect(uris).toContain('atlisp://dwg/path');
      expect(uris).toContain('atlisp://dwg/block-refs');
      expect(uris).toContain('atlisp://dwg/tbl');
      expect(uris).toContain('atlisp://cad/dwgs');
      expect(uris).toContain('atlisp://packages');
      expect(uris).toContain('atlisp://platforms');
      expect(uris).toContain('atlisp://standards/drafting');
      expect(uris).toContain('atlisp://standards/coding');
      expect(uris).toContain('atlisp://cad/events');
      expect(uris).toContain('atlisp://dwg/context');
      expect(uris).toContain('atlisp://tools/relationships');
    });
  });

  describe('listResources', () => {
    it('returns packages resource in list', async () => {
      const list = await listResources([]);
      const pkgRes = list.find(r => r.uri === 'atlisp://packages');
      expect(pkgRes).toBeDefined();
      expect(pkgRes.subscribed).toBe(false);
    });

    it('marks packages as subscribed when uri is in subscribedUris', async () => {
      const list = await listResources(['atlisp://packages']);
      const pkgRes = list.find(r => r.uri === 'atlisp://packages');
      expect(pkgRes.subscribed).toBe(true);
    });
  });

  describe('readResource atlisp://packages', () => {
    it('throws when CAD is not connected', async () => {
      mockConnect.mockResolvedValue(false);
      await expect(readResource('atlisp://packages')).rejects.toThrow('未连接 CAD');
    });

    it('returns empty array when CAD returns nil', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('nil');
      const result = await readResource('atlisp://packages');
      expect(result).toEqual([]);
    });

    it('returns empty array when CAD returns empty string', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('');
      const result = await readResource('atlisp://packages');
      expect(result).toEqual([]);
    });

    it('parses JSON-formatted result from CAD', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('[{"name":"base","version":"1.0.0","description":"基础函数库"},{"name":"at-pm","version":"2.1.0","description":"工程项目管理"}]');
      const result = await readResource('atlisp://packages');
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ name: 'base', version: '1.0.0' });
      expect(result[1]).toMatchObject({ name: 'at-pm', version: '2.1.0' });
    });

    it('parses LISP list result from CAD', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('("base" "at-pm" "network")');
      const result = await readResource('atlisp://packages');
      expect(result).toHaveLength(3);
      expect(result.map(p => p.name)).toEqual(['base', 'at-pm', 'network']);
    });

    it('handles string items with default version', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('("sidebar" "tips")');
      const result = await readResource('atlisp://packages');
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ name: 'sidebar', version: '0.0.0', loaded: true });
      expect(result[1]).toMatchObject({ name: 'tips', version: '0.0.0', loaded: true });
    });
  });

  describe('readResource atlisp://packages?name=xxx', () => {
    it('filters packages by name', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('[{"name":"base","version":"1.0.0","description":"基础库"},{"name":"at-pm","version":"2.1.0","description":"项目管理"}]');
      const result = await readResource('atlisp://packages?name=base');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('base');
    });

    it('returns empty when filter matches nothing', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('[{"name":"base","version":"1.0.0"}]');
      const result = await readResource('atlisp://packages?name=notfound');
      expect(result).toEqual([]);
    });
  });

  describe('package detail parsing', () => {
    it('extracts full package metadata from JSON', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('[{"name":"at-pm","version":"2.1.0","description":"工程项目管理","fullName":"AT Project Manager","author":"vitalgg","category":"tools","url":"https://example.com/at-pm"}]');
      const result = await readResource('atlisp://packages');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'at-pm',
        version: '2.1.0',
        description: '工程项目管理',
        fullName: 'AT Project Manager',
        author: 'vitalgg',
        category: 'tools',
        url: 'https://example.com/at-pm',
        loaded: true
      });
    });
  });

  describe('subscribable resource', () => {
    it('atlisp://packages is subscribable', () => {
      const pkgRes = RESOURCES.find(r => r.uri === 'atlisp://packages');
      expect(pkgRes.subscribable).toBe(true);
    });

    it('atlisp://platforms is NOT subscribable', () => {
      const platRes = RESOURCES.find(r => r.uri === 'atlisp://platforms');
      expect(platRes.subscribable).toBe(false);
    });
  });

  describe('readResource atlisp://dwg/entities', () => {
    it('throws when CAD is not connected', async () => {
      mockConnect.mockResolvedValue(false);
      await expect(readResource('atlisp://dwg/entities')).rejects.toThrow('未连接 CAD');
    });

    it('returns empty when CAD returns nil', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('nil');
      const result = await readResource('atlisp://dwg/entities');
      expect(result).toEqual({ total: 0, summary: [] });
    });

    it('returns entities with entity:properties key-value JSON', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue(
        '(2 (((ObjectName . "AcDbLine") (Handle . "ABC") (Layer . "0") (Color . 256) (Linetype . "ByLayer") (StartPoint (0.0 0.0 0.0)) (EndPoint (100.0 0.0 0.0))) ((ObjectName . "AcDbCircle") (Handle . "DEF") (Layer . "0") (Color . 1) (Linetype . "Continuous") (Center (50.0 50.0 0.0)) (Radius . 25.0))))');
      const result = await readResource('atlisp://dwg/entities?type=LINE');
      expect(result.total).toBe(2);
      expect(result.entities).toHaveLength(2);
      expect(result.entities[0]).toMatchObject({ ObjectName: 'AcDbLine', Handle: 'ABC', Layer: '0', Color: 256, Linetype: 'ByLayer' });
      expect(result.entities[1]).toMatchObject({ ObjectName: 'AcDbCircle', Handle: 'DEF', Layer: '0', Color: 1, Linetype: 'Continuous' });
    });

    it('returns entity:properties for filtered type', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue(
        '(1 (((ObjectName . "AcDbLine") (Handle . "ABC") (Layer . "0") (Color . 256) (Linetype . "ByLayer"))))');
      const result = await readResource('atlisp://dwg/entities?type=LINE');
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0]).toMatchObject({ ObjectName: 'AcDbLine', Handle: 'ABC' });
    });

    it('TEXT entities include TextString property', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue(
        '(1 (((ObjectName . "AcDbText") (Handle . "ABC") (Layer . "0") (Color . 256) (Linetype . "ByLayer") (TextString . "Hello CAD"))))');
      const result = await readResource('atlisp://dwg/entities?type=TEXT');
      expect(result.entities[0]).toHaveProperty('TextString', 'Hello CAD');
    });

    it('CIRCLE entities include Center and Radius', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue(
        '(1 (((ObjectName . "AcDbCircle") (Handle . "DEF") (Layer . "0") (Color . 256) (Linetype . "ByLayer") (Center (10.0 20.0 0.0)) (Radius . 5.0) (Diameter . 10.0) (Area . 78.5398))))');
      const result = await readResource('atlisp://dwg/entities?type=CIRCLE');
      expect(result.entities[0]).toMatchObject({
        ObjectName: 'AcDbCircle',
        Center: [10, 20, 0],
        Radius: 5,
        Diameter: 10,
      });
    });

    it('INSERT entities include Name property', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue(
        '(1 (((ObjectName . "AcDbBlockReference") (Handle . "GHI") (Layer . "0") (Color . 256) (Linetype . "ByLayer") (Name . "MyBlock") (InsertionPoint (0.0 0.0 0.0)))))');
      const result = await readResource('atlisp://dwg/entities?type=INSERT');
      expect(result.entities[0]).toMatchObject({ ObjectName: 'AcDbBlockReference', Name: 'MyBlock' });
    });

    it('provides all properties as flat key-value map', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue(
        '(1 (((ObjectName . "AcDbHatch") (Handle . "GHI") (Layer . "0") (Color . 256) (Linetype . "ByLayer") (PatternName . "ANSI31") (Area . 100.0))))');
      const result = await readResource('atlisp://dwg/entities?type=HATCH');
      expect(result.entities[0]).toMatchObject({
        ObjectName: 'AcDbHatch',
        Handle: 'GHI',
        PatternName: 'ANSI31',
        Area: 100,
      });
      expect(result.entities[0]).not.toHaveProperty('type');
      expect(result.entities[0]).not.toHaveProperty('text');
      expect(result.entities[0]).not.toHaveProperty('points');
      expect(result.entities[0]).not.toHaveProperty('blockName');
    });
  });

  describe('readResource atlisp://dwg/tbl', () => {
    it('returns layer data from parsed Lisp result', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue(
        '((TABLE . LAYER) (TOTAL . 3) (DATA (((2 . "0") (62 . 7) (6 . "Continuous") (70 . 0) (60 . 0)) ((2 . "1") (62 . 1) (6 . "Dashed") (70 . 4) (60 . 0)) ((2 . "Defpoints") (62 . 7) (6 . "Continuous") (70 . 1) (60 . 1)))))');
      const result = await readResource('atlisp://dwg/tbl/layer');
      expect(result.table).toBe('layer');
      expect(result.total).toBe(3);
      expect(result.data).toHaveLength(3);
      expect(result.data[0]).toMatchObject({ name: '0', color: 7, linetype: 'Continuous', frozen: false, locked: false, on: true });
      expect(result.data[1]).toMatchObject({ name: '1', color: 1, linetype: 'Dashed', frozen: false, locked: true, on: true });
      expect(result.data[2]).toMatchObject({ name: 'Defpoints', color: 7, linetype: 'Continuous', frozen: true, locked: false, on: false });
    });

    it('supports atlisp://dwg/tbl/block path', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue(
        '((TABLE . BLOCK) (TOTAL . 2) (DATA (((2 . "*Model_Space") (70 . 0)) ((2 . "*Paper_Space") (70 . 0)))))');
      const result = await readResource('atlisp://dwg/tbl/block');
      expect(result.table).toBe('block');
      expect(result.total).toBe(2);
      expect(result.data).toHaveLength(2);
      expect(result.data[0].name).toBe('*Model_Space');
      expect(result.data[1].name).toBe('*Paper_Space');
    });

    it('accepts type parameter as alias for tbl (backward compat)', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue(
        '((TABLE . LAYER) (TOTAL . 1) (DATA (((2 . "Test") (62 . 3) (6 . "Continuous") (70 . 0) (60 . 0)))))');
      const result = await readResource('atlisp://dwg/tbl?type=layer');
      expect(result.table).toBe('layer');
      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('Test');
      expect(result.data[0].color).toBe(3);
    });

    it('returns all tables with TOTAL and DATA parsed correctly', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue(
        '((LAYER (TOTAL . 2) (DATA (((2 . "0") (62 . 7) (6 . "Continuous") (70 . 0) (60 . 0)) ((2 . "1") (62 . 1) (6 . "Dashed") (70 . 4) (60 . 0))))) (BLOCK (TOTAL . 1) (DATA (((2 . "*Model_Space") (70 . 0))))))');
      const result = await readResource('atlisp://dwg/tbl');
      expect(result.layer).toMatchObject({ total: 2, data: [{ name: '0' }, { name: '1' }] });
      expect(result.block).toMatchObject({ total: 1, data: [{ name: '*Model_Space' }] });
    });

    it('throws when CAD not connected', async () => {
      mockConnect.mockResolvedValue(false);
      await expect(readResource('atlisp://dwg/tbl/layer')).rejects.toThrow('未连接 CAD');
    });

    it('returns empty data on CAD nil response', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('nil');
      const result = await readResource('atlisp://dwg/tbl/layer');
      expect(result).toEqual({ table: 'layer', data: [] });
    });
  });

  describe('readResource atlisp://dwg/block-refs/{blockName}', () => {
    it('routes to getBlockRefs with correct blockName from path', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue(
        '((total . 0) (blockRefs . nil))');
      const result = await readResource('atlisp://dwg/block-refs/MyBlock');
      expect(result).toEqual({ total: 0, blockRefs: [] });
      expect(mockSendCommandWithResult).toHaveBeenCalled();
      const code = mockSendCommandWithResult.mock.calls[0][0];
      expect(code).toContain('"MyBlock"');
    });

    it('throws when CAD not connected for path-based block-refs', async () => {
      mockConnect.mockResolvedValue(false);
      await expect(readResource('atlisp://dwg/block-refs/MyBlock')).rejects.toThrow('未连接 CAD');
    });
  });
});
