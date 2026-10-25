import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const mockSendCommand = vi.fn();
const mockSendCommandWithResult = vi.fn();
const mockConnect = vi.fn();
const mockGetInfo = vi.fn();
const mockGetPlatform = vi.fn();
const mockGetVersion = vi.fn();
const mockNewDoc = vi.fn();
const mockPing = vi.fn();
const mockIsBusy = vi.fn();
const mockHasDoc = vi.fn();
const mockBringToFront = vi.fn();

const mockCad = {
  connected: false,
  connect: mockConnect,
  sendCommand: mockSendCommand,
  sendCommandWithResult: mockSendCommandWithResult,
  getInfo: mockGetInfo,
  getPlatform: mockGetPlatform,
  getVersion: mockGetVersion,
  newDoc: mockNewDoc,
  ping: mockPing,
  isBusy: mockIsBusy,
  hasDoc: mockHasDoc,
  bringToFront: mockBringToFront,
};

vi.mock('../src/cad.js', () => ({
  cad: mockCad,
  onDocumentChanged: vi.fn(),
  resolveCadConnection: () => mockCad,
}));

const originalFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error('fetch disabled in tests'));
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

const MOCK_PACKAGES = [
  { name: 'base', description: '基础函数库', version: '1.0.0' },
  { name: 'at-pm', description: '工程项目管理', version: '2.1.0' },
  { name: 'network', description: '网络功能模块', version: '1.5.0' },
  { name: 'userman', description: '用户管理', version: '1.2.0' },
  { name: 'pkgman', description: '包管理器', version: '2.0.0' },
  { name: 'sidebar', description: '侧边栏工具', version: '1.0.0' },
  { name: 'aibot', description: 'AI 助手', version: '0.9.0' },
  { name: 'tips', description: '每日提示', version: '1.0.0' },
  { name: 'function', description: '函数库', version: '3.0.0' }
];

vi.mock('../src/constants.js', () => ({
  CAD_PLATFORMS: ['AutoCAD', 'ZWCAD', 'GStarCAD', 'BricsCAD'],
  FILE_EXTENSIONS: {
    'AutoCAD': ['.fas', '.vlx'],
    'ZWCAD': ['.zelx', '.vls'],
    'GStarCAD': ['.fas', '.vlx'],
    'BricsCAD': ['.des']
  },
  MOCK_PACKAGES,
  PROTOCOL_VERSION: '2024-11-05',
  SERVER_NAME: 'atlisp-mcp-server',
  SERVER_VERSION: '1.0.10',
  BUILD_META: { version: '1.0.10', commit: 'test', builtAt: '2026-01-01T00:00:00.000Z' },
  SERVER_CAPABILITIES: {
    tools: { listChanged: true },
    resources: { subscribe: true, listChanged: true },
    prompts: { listChanged: true },
    logging: {},
    completions: {},
    experimental: {
      pipeline_engine: true,
      triggers: true,
      repl: true,
      webhooks: true,
      agent_context: true,
      rate_limiting: true,
      request_dedup: true,
    },
  },
  AUTO_LAUNCH_PLATFORMS: ['AutoCAD', 'ZWCAD', 'GStarCAD', 'BricsCAD'],
  CAD_REGISTRY_PATHS: {
    'AutoCAD': { root: 'SOFTWARE\\Autodesk\\AutoCAD', keyPattern: /^R\d+(\.\d+)?$/, subKey: 'ACAD-\\d+:\\d+', exe: 'acad.exe' },
    'ZWCAD': { root: 'SOFTWARE\\ZWSOFT\\ZWCAD', keyPattern: /^\d+(\.\d+)?$/, subKey: null, exe: 'zwcad.exe' },
    'GStarCAD': { root: 'SOFTWARE\\GStarSoft\\GStarCAD', keyPattern: /^\d+(\.\d+)?$/, subKey: null, exe: 'gstarcad.exe' },
    'BricsCAD': { root: 'SOFTWARE\\Bricsys\\BricsCAD', keyPattern: /^\d+(\.\d+)?$/, subKey: null, exe: 'bricscad.exe' },
  },
}));

vi.mock('../src/logger.js', () => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  closeLog: vi.fn(),
}));

const {
  handleToolCall,
  tools,
  CAD_PLATFORMS,
  FILE_EXTENSIONS,
} = await import('../src/atlisp-mcp.js');

const { createMcpServer } = await import('../src/mcp-handlers.js');

describe('tools definition', () => {
  it('exports tools array', () => {
    expect(tools.length).toBeGreaterThan(100);
  });

  it('each tool has name, description, and inputSchema', () => {
    for (const tool of tools) {
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('description');
      expect(tool).toHaveProperty('inputSchema');
    }
  });

  it('every tool has a valid industry and priority', () => {
    const validPrio = ['core', 'common', 'rare'];
    for (const tool of tools) {
      const ann = tool.annotations;
      expect(Array.isArray(ann.industry) && ann.industry.length >= 1).toBe(true);
      expect(validPrio).toContain(ann.priority);
    }
  });

  it('exposes the new grouping meta-tools', () => {
    const names = new Set(tools.map(t => t.name));
    expect(names.has('list_tools_by_industry')).toBe(true);
    expect(names.has('list_tools_by_priority')).toBe(true);
  });
});

describe('handleToolCall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCad.connected = false;
  });

  describe('connect_cad', () => {
    it('returns error when connection fails', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await handleToolCall('connect_cad', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('未能连接或启动');
    });

    it('returns success when connection succeeds', async () => {
      mockConnect.mockResolvedValue(true);
      mockGetPlatform.mockReturnValue('AutoCAD');
      mockGetVersion.mockReturnValue('24.0');
      const result = await handleToolCall('connect_cad', {});
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('已连接到');
      expect(result.content[0].text).toContain('AutoCAD');
    });
  });

  describe('eval_lisp', () => {
    it('returns error when CAD not connected', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await handleToolCall('eval_lisp', { code: '(princ "hi")' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('未连接');
    });

    it('sends command when connected', async () => {
      mockCad.connected = true;
      const result = await handleToolCall('eval_lisp', { code: '(princ "hi")' });
      expect(mockSendCommand).toHaveBeenCalledWith('(princ "hi")\n');
      expect(result.content[0].text).toContain('已发送命令');
    });
  });

  describe('eval_lisp_with_result', () => {
    it('returns error when CAD not connected', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await handleToolCall('eval_lisp_with_result', { code: '(+ 1 2)' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('未连接');
    });

    it('returns result from CAD when connected', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('3');
      const result = await handleToolCall('eval_lisp_with_result', { code: '(+ 1 2)' });
      expect(result.content[0].text).toBe('3');
    });

    it('returns error when CAD returns null', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue(null);
      const result = await handleToolCall('eval_lisp_with_result', { code: '(bad)' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('失败');
    });
  });

  describe('get_cad_info', () => {
    it('returns CAD info when connected', async () => {
      mockCad.connected = true;
      mockGetInfo.mockReturnValue('Platform: AutoCAD, Version: 24.0, Status: Connected');
      const result = await handleToolCall('get_cad_info', {});
      expect(result.content[0].text).toContain('AutoCAD');
    });

    it('returns not connected message', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await handleToolCall('get_cad_info', {});
      expect(result.content[0].text).toContain('未连接');
    });
  });

  describe('list_packages', () => {
    it('returns mock package list', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('nil');
      const result = await handleToolCall('list_packages', {});
      expect(result.content[0].text).toContain('已安装');
      for (const pkg of MOCK_PACKAGES) {
        expect(result.content[0].text).toContain(pkg.name);
      }
    });
  });

  describe('search_packages', () => {
    it('finds packages by name', async () => {
      const result = await handleToolCall('search_packages', { query: 'base' });
      expect(result.content[0].text).toContain('搜索结果');
    });

    it('finds packages by description', async () => {
      const result = await handleToolCall('search_packages', { query: '函数库' });
      expect(result.content[0].text).toContain('搜索结果');
    });

    it('returns empty message when no match', async () => {
      const result = await handleToolCall('search_packages', { query: 'zzznotexist' });
      expect(result.content[0].text).toContain('未找到');
    });
  });

  describe('install_package', () => {
    it('finds existing package', async () => {
      const result = await handleToolCall('install_package', { packageName: 'base' });
      expect(result.content[0].text).toContain('base');
      expect(result.content[0].text).toContain('安装');
    });

    it('returns error for non-existing package', async () => {
      const result = await handleToolCall('install_package', { packageName: 'no-such-pkg' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('不存在');
    });

    it('loads package directly when already installed', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('((:NAME . "base"))');
      const result = await handleToolCall('install_package', { packageName: 'base' });
      expect(mockSendCommand).toHaveBeenCalledWith(expect.stringContaining('@::load-pkg "base"'));
      expect(result.content[0].text).toContain('已安装');
    });

    it('installs via package manager API before loading', async () => {
      mockCad.connected = true;
      // 第一次轮询未就绪，第二次命中——覆盖 waitForInstall 的重试路径。
      mockSendCommandWithResult
        .mockResolvedValueOnce('nil')
        .mockResolvedValue('((:NAME . "base"))');
      const result = await handleToolCall('install_package', { packageName: 'base' });
      expect(mockSendCommand).toHaveBeenCalledWith(expect.stringContaining('@::package-install "base"'));
      expect(result.content[0].text).toContain('已安装并加载');
    });
  });

  describe('get_platform_info', () => {
    it('returns platform list', async () => {
      const result = await handleToolCall('get_platform_info', {});
      for (const platform of CAD_PLATFORMS) {
        expect(result.content[0].text).toContain(platform);
      }
    });
  });

  describe('at_command', () => {
    it('returns error when CAD not connected', async () => {
      const result = await handleToolCall('at_command', { command: '@H' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('未连接');
    });

    it('sends command when connected', async () => {
      mockCad.connected = true;
      const result = await handleToolCall('at_command', { command: '@H' });
      expect(mockSendCommand).toHaveBeenCalledWith('@H\n');
      expect(result.content[0].text).toContain('已发送');
    });
  });

  describe('new_document', () => {
    it('returns error when not connected', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await handleToolCall('new_document', {});
      expect(result.isError).toBe(true);
    });

    it('returns success when connected', async () => {
      mockCad.connected = true;
      mockNewDoc.mockResolvedValue(true);
      const result = await handleToolCall('new_document', {});
      expect(result.content[0].text).toContain('新建');
    });
  });

  describe('install_atlisp', () => {
    it('returns error when not connected', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await handleToolCall('install_atlisp', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('未连接');
    });

    it('installs @lisp core when connected', async () => {
      mockCad.connected = true;
      let installed = false;
      mockSendCommandWithResult.mockImplementation(async (code) => {
        if (code.includes('@mcp-unsaved')) return 'ATLISP-SAVED';
        if (code.includes('atoms-family') && code.includes('BASE:INIT')) {
          return installed ? 'ATLISP-CORE' : 'ATLISP-NONE';
        }
        if (code.includes('/@')) {
          installed = true;
          return 'ok';
        }
        return 'ok';
      });

      const result = await handleToolCall('install_atlisp', {});
      expect(mockSendCommandWithResult).toHaveBeenCalled();
      expect(result.content[0].text).toContain('核心安装完成');
    });
  });

  describe('bring_to_front', () => {
    it('returns error when not connected', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await handleToolCall('bring_to_front', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('未连接');
    });

    it('returns success when connected', async () => {
      mockCad.connected = true;
      mockBringToFront.mockResolvedValue(true);
      const result = await handleToolCall('bring_to_front', {});
      expect(result.content[0].text).toContain('前台');
    });
  });

  describe('init_atlisp', () => {
    it('returns error when not connected', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await handleToolCall('init_atlisp', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('未连接');
    });

    it('loads the function library when connected', async () => {
      mockCad.connected = true;
      let initialized = false;
      mockSendCommandWithResult.mockImplementation(async (code) => {
        if (code.includes('@mcp-unsaved')) return 'ATLISP-SAVED';
        if (code.includes('atoms-family') && code.includes('BASE:INIT')) {
          return initialized ? 'ATLISP-READY' : 'ATLISP-CORE';
        }
        if (code.includes('/cloud')) {
          initialized = true;
          return 'ok';
        }
        return 'ok';
      });

      const result = await handleToolCall('init_atlisp', {});
      expect(mockSendCommandWithResult).toHaveBeenCalled();
      expect(result.content[0].text).toContain('函数库');
    });
  });

  describe('get_function_usage', () => {
    it('returns error for non-existent function', async () => {
      const result = await handleToolCall('get_function_usage', { name: 'nonExistentFunc' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('未找到');
    });
  });

  describe('list_symbols', () => {
    it('returns function list', async () => {
      const result = await handleToolCall('list_symbols', {});
      expect(result.content[0].text).toBeDefined();
    });

    it('returns function list for specific package', async () => {
      mockCad.connected = true;
      mockCad.functions = { 'string:test': '测试函数' };
      const result = await handleToolCall('list_symbols', { package: 'string' });
      mockCad.connected = false;
      expect(result.content[0].text).toBeDefined();
    });
  });

  describe('import_funlib', () => {
    it('returns JSON format by default', async () => {
      const result = await handleToolCall('import_funlib', {});
      expect(result.content[0].text).toBeDefined();
    });

    it('returns list format when specified', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ all_functions: { 'test:fn': { name: 'test:fn', description: 'desc' } } })
      });
      const result = await handleToolCall('import_funlib', { format: 'list' });
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('fetch disabled in tests'));
      expect(result.content[0].text).toContain(':');
    });
  });

  describe('get_system_status', () => {
    it('returns status object with all fields defined', async () => {
      mockCad.connected = true;
      mockCad.product = 'AutoCAD';
      mockCad.version = '24.0';
      const result = await handleToolCall('get_system_status', {});
      const text = result.content[0].text;
      expect(text).toContain('mcp');
      expect(text).toContain('worker');
      expect(text).toContain('cad');
      expect(text).toContain('lisp');
      expect(text).toContain('packages');
    });
  });

  describe('connect_cad with platform', () => {
    it('passes platform to cad.connect', async () => {
      mockConnect.mockResolvedValue(true);
      mockGetPlatform.mockReturnValue('ZWCAD');
      mockGetVersion.mockReturnValue('25.0');
      await handleToolCall('connect_cad', { platform: 'ZWCAD' });
      expect(mockConnect).toHaveBeenCalledWith('ZWCAD');
    });
  });

  describe('unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await handleToolCall('nonexistent_tool', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('未知工具');
    });
  });
});

describe('createMcpServer', () => {
  let server;

  beforeEach(() => {
    vi.clearAllMocks();
    server = createMcpServer({ tools, handleToolCall });
  });

  it('returns a server instance', () => {
    expect(server).toBeDefined();
  });

  it('handles ListToolsRequestSchema', async () => {
    const handler = server._requestHandlers?.get(ListToolsRequestSchema);
    if (!handler) {
      return;
    }
    const response = await handler();
    expect(response.tools).toBeDefined();
    expect(response.tools.length).toBeGreaterThan(100);
  });

  it('handles CallToolRequestSchema', async () => {
    const handler = server._requestHandlers?.get(CallToolRequestSchema);
    if (!handler) {
      return;
    }
    const request = { params: { name: 'list_packages', arguments: {} } };
    const response = await handler(request);
    expect(response.content[0].text).toContain('已安装');
  });
});

describe('constants', () => {
  it('CAD_PLATFORMS has all four platforms', () => {
    expect(CAD_PLATFORMS).toEqual(['AutoCAD', 'ZWCAD', 'GStarCAD', 'BricsCAD']);
  });

  it('FILE_EXTENSIONS has correct platforms', () => {
    expect(Object.keys(FILE_EXTENSIONS)).toEqual(['AutoCAD', 'ZWCAD', 'GStarCAD', 'BricsCAD']);
  });

  it('MOCK_PACKAGES has 9 packages', () => {
    expect(MOCK_PACKAGES).toHaveLength(9);
  });
});

describe('SSE utilities', () => {
  let sseUtils;

  beforeEach(async () => {
    sseUtils = await import('../src/sse-session.js');
  });

  it('setupSseHeaders sets correct headers', () => {
    const mockRes = {
      headers: {},
      setHeader(name, value) { this.headers[name] = value; }
    };
    sseUtils.setupSseHeaders(mockRes);
    expect(mockRes.headers['Content-Type']).toBe('text/event-stream');
    expect(mockRes.headers['Cache-Control']).toBe('no-cache');
    expect(mockRes.headers['Connection']).toBe('keep-alive');
    expect(mockRes.headers['Transfer-Encoding']).toBe('chunked');
  });

  it('createSseResponseHandler works for JSON mode', () => {
    let ended = false;
    const mockRes = {
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      end() { ended = true; }
    };
    const { send } = sseUtils.createSseResponseHandler(mockRes, false);
    send({ test: 'data' }, true);
    expect(mockRes.headers['Content-Type']).toBe('application/json');
    expect(ended).toBe(true);
  });

  it('createSseResponseHandler works for SSE mode', () => {
    let ended = false;
    let written = '';
    const mockRes = {
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      write(data) { written += data; },
      flush() {},
      end() { ended = true; }
    };
    const { send } = sseUtils.createSseResponseHandler(mockRes, true);
    send({ test: 'data' }, true);
    expect(mockRes.headers['Content-Type']).toBe('text/event-stream');
    expect(written).toContain('data:');
    expect(ended).toBe(false);
  });
});
