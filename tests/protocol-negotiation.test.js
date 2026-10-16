import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js';

const mockSendCommandWithResult = vi.fn();
const mockCad = {
  connected: true,
  connect: vi.fn().mockResolvedValue(true),
  sendCommand: vi.fn(),
  sendCommandWithResult: mockSendCommandWithResult,
  ping: vi.fn().mockResolvedValue(true),
  getInfo: vi.fn().mockResolvedValue('atlisp-mcp ok'),
  getPlatform: vi.fn().mockReturnValue('AutoCAD'),
  getVersion: vi.fn().mockReturnValue('2025.1'),
  isBusy: vi.fn().mockResolvedValue(false),
  hasDoc: vi.fn().mockResolvedValue({ hasDoc: true }),
  bringToFront: vi.fn().mockResolvedValue(true),
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

const originalFetch = globalThis.fetch;

const { createMcpServer } = await import('../src/mcp-handlers.js');
const { PROTOCOL_VERSION, SERVER_NAME, SERVER_VERSION } = await import('../src/constants.js');
const { getVisibleTools } = await import('../src/tools/index.js');
const { handleToolCall } = await import('../src/tool-executor.js');

const visible = getVisibleTools();
const PAGE_SIZE = 100;

/**
 * 通过 InMemoryTransport 发送一次裸 initialize 请求，返回握手结果（不经 Client 类，
 * 以便指定任意 protocolVersion 验证版本协商/回退行为）。
 */
async function rawInitialize(requestedVersion) {
  const rawServer = createMcpServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const replies = [];
  ct.onmessage = (msg) => {
    if (msg && msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) replies.push(msg);
  };
  await rawServer.connect(st);
  await ct.start();
  await ct.send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: requestedVersion,
      capabilities: {},
      clientInfo: { name: 'legacy-test-client', version: '1.0.0' },
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  const reply = replies.find((m) => m.id === 1);
  await ct.close();
  await rawServer.close().catch(() => {});
  return reply?.result;
}

describe('MCP 协议协商 + 结构化输出', () => {
  let client;
  let clientTransport;
  let server;

  beforeAll(async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fetch disabled in tests'));
    server = createMcpServer({ handleToolCall });
    client = new Client({ name: 'protocol-test-client', version: '1.0.0' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    clientTransport = ct;
    await Promise.all([server.connect(st), client.connect(ct)]);
  });

  afterAll(async () => {
    await client?.close().catch(() => {});
    await server?.close().catch(() => {});
    globalThis.fetch = originalFetch;
  });

  describe('协议版本', () => {
    it('PROTOCOL_VERSION 来自 SDK 最新版本而非写死', () => {
      expect(PROTOCOL_VERSION).toBe(LATEST_PROTOCOL_VERSION);
      expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(PROTOCOL_VERSION);
      // 兼容性红线：旧版客户端仍可回退协商
      expect(SUPPORTED_PROTOCOL_VERSIONS).toContain('2024-11-05');
    });

    it('InMemory 握手成功并返回服务器信息与能力', () => {
      expect(client.getServerVersion()?.name).toBe(SERVER_NAME);
      expect(client.getServerVersion()?.version).toBe(SERVER_VERSION);
      expect(client.getServerCapabilities()?.tools).toBeTruthy();
      expect(client.getInstructions()).toContain('MCP');
    });

    it('旧客户端请求 2024-11-05 时按请求版本协商', async () => {
      const result = await rawInitialize('2024-11-05');
      expect(result).toBeTruthy();
      expect(result.protocolVersion).toBe('2024-11-05');
      expect(result.serverInfo.name).toBe(SERVER_NAME);
      expect(result.capabilities?.tools).toBeTruthy();
    });

    it('不受支持的协议版本回退到 SDK 最新版', async () => {
      const result = await rawInitialize('1999-01-01');
      expect(result).toBeTruthy();
      expect(result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
    });
  });

  describe('tools/list：title 与分页', () => {
    it('每页最多 100 个工具且全部带 title', async () => {
      const page1 = await client.listTools();
      expect(page1.tools.length).toBe(Math.min(PAGE_SIZE, visible.length));
      expect(page1.tools.length).toBeGreaterThan(0);
      for (const tool of page1.tools) {
        expect(typeof tool.title, `${tool.name} 缺少 title`).toBe('string');
        expect(tool.title.trim().length).toBeGreaterThan(0);
      }
      // title 是人类可读名，与工具名不同
      expect(page1.tools.filter((t) => t.title !== t.name).length).toBeGreaterThan(0);
      if (visible.length > PAGE_SIZE) {
        expect(page1.nextCursor).toBeTruthy();
      }
    });

    it('cursor 分页可遍历全部工具且不重复', async () => {
      const seen = new Set();
      let cursor;
      let pages = 0;
      do {
        const page = await client.listTools(cursor ? { cursor } : {});
        for (const tool of page.tools) {
          expect(seen.has(tool.name), `重复工具: ${tool.name}`).toBe(false);
          seen.add(tool.name);
          expect(typeof tool.title).toBe('string');
        }
        cursor = page.nextCursor;
        pages += 1;
        expect(pages).toBeLessThan(20);
      } while (cursor);

      expect(seen.size).toBe(visible.length);
      expect(seen.size).toBeGreaterThanOrEqual(PAGE_SIZE);
    });

    it('只读查询工具声明了 outputSchema', () => {
      for (const name of ['get_entity', 'get_blocks', 'list_ucs', 'get_system_status']) {
        const def = visible.find((t) => t.name === name);
        expect(def, `${name} 未找到`).toBeTruthy();
        expect(def.outputSchema?.type, `${name} 缺少 outputSchema`).toBe('object');
        expect(Object.keys(def.outputSchema.properties || {}).length).toBeGreaterThan(0);
      }
    });
  });

  describe('工具调用：structuredContent', () => {
    it('声明 outputSchema 的工具同时返回 content 与 structuredContent', async () => {
      await client.listTools(); // 刷新客户端 outputSchema 校验缓存
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue(
        '("type" "LINE" "handle" "1F" "layer" "0" "color" 256 "linetype" "Continuous" "elevation" 0.0)'
      );

      // client.callTool 会按 outputSchema 校验 structuredContent，校验不通过会抛错
      const result = await client.callTool({ name: 'get_entity', arguments: { handle: '1F' } });

      expect(result.isError).toBeFalsy();
      expect(result.content?.[0]?.text).toContain('LINE'); // 向后兼容的文本内容
      expect(result.structuredContent).toMatchObject({
        type: 'LINE',
        handle: '1F',
        layer: '0',
        color: 256,
      });
    });

    it('列表类工具返回 count/数组形式的 structuredContent', async () => {
      await client.listTools();
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('("World" "MyUCS")');

      const result = await client.callTool({ name: 'list_ucs', arguments: {} });

      expect(result.isError).toBeFalsy();
      expect(result.content?.[0]?.text).toContain('World');
      expect(result.structuredContent).toMatchObject({ count: 2, ucs: ['World', 'MyUCS'] });
    });

    it('未声明 outputSchema 的工具不返回 structuredContent', async () => {
      await client.listTools();
      const result = await client.callTool({ name: 'get_platform_info', arguments: {} });
      expect(result.isError).toBeFalsy();
      expect(result.content?.[0]?.text).toContain('AutoCAD');
      expect(result.structuredContent).toBeUndefined();
    });

    it('携带 progressToken 的调用可正常执行', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('("World")');
      // 服务器在 progressToken 存在时会发送 notifications/progress，不应影响调用结果
      const result = await client.callTool(
        { name: 'list_ucs', arguments: {}, _meta: { progressToken: 'tok-1' } }
      );
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({ count: 1, ucs: ['World'] });
    });
  });
});
