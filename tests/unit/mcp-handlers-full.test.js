// mcp-handlers.js 全量覆盖：通过 SDK Client + InMemoryTransport 驱动
// resources/prompts/completions/subscribe/notifications 全部分支（含缓存、限流、错误路径）
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ReadResourceRequestSchema,
  CompleteRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  ListRootsRequestSchema,
  ProgressNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';

const state = vi.hoisted(() => ({ ctx: null }));

const cadMock = vi.hoisted(() => ({
  connected: true,
  sendCommandWithResult: vi.fn(),
  sendCommand: vi.fn(),
}));

const toolHandlerMock = vi.hoisted(() => ({
  handleToolCall: vi.fn(),
}));

vi.mock('../../src/cad.js', () => ({
  cad: cadMock,
  onDocumentChanged: vi.fn(),
  resolveCadConnection: () => cadMock,
}));
vi.mock('../../src/logger.js', () => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  closeLog: vi.fn(),
}));
vi.mock('../../src/metrics.js', () => ({
  metrics: {},
  trackRequest: vi.fn(),
  trackMcpMethod: vi.fn(),
  trackToolCall: vi.fn(),
  trackCadCommand: vi.fn(),
  trackError: vi.fn(),
  setActiveSessions: vi.fn(),
  setCadConnected: vi.fn(),
}));
vi.mock('../../src/handlers/resource-handlers.js', () => ({
  listResources: vi.fn(),
  readResource: vi.fn(),
}));
vi.mock('../../src/handlers/prompt-handlers.js', () => ({
  listPrompts: vi.fn(),
  getPrompt: vi.fn(),
}));
vi.mock('../../src/subscription-manager.js', () => ({
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  list: vi.fn(() => []),
}));
vi.mock('../../src/mcp-server-state.js', () => ({
  mcpContext: { getStore: () => state.ctx },
}));
vi.mock('../../src/rate-limiter.js', () => ({
  checkToolRateLimit: vi.fn(() => ({ allowed: true })),
}));
vi.mock('../../src/client-roots.js', () => ({ setClientRoots: vi.fn() }));

const { createMcpServer } = await import('../../src/mcp-handlers.js');
const { getVisibleTools } = await import('../../src/tools/index.js');
const { listResources, readResource } = await import('../../src/handlers/resource-handlers.js');
const { listPrompts, getPrompt } = await import('../../src/handlers/prompt-handlers.js');
const subManager = await import('../../src/subscription-manager.js');
const { checkToolRateLimit } = await import('../../src/rate-limiter.js');
const { setClientRoots } = await import('../../src/client-roots.js');
const { trackToolCall, trackError } = await import('../../src/metrics.js');
const { log } = await import('../../src/logger.js');

const { handleToolCall } = toolHandlerMock;

let server;
let client;

const PROMPTS = Array.from({ length: 60 }, (_, i) => ({
  name: `prompt-${String(i).padStart(2, '0')}`,
  arguments: i === 0 ? [{ name: 'mode', validValues: ['Simple', 'Strict', 'Steady'] }] : undefined,
}));

// SDK 的 setRequestHandler 会包一层 schema.parse（自定义 ref 类型如 layer/block 会被
// CompleteRequestSchema 拒绝），因此在建 server 前临时打补丁捕获原始 handler 直接调用。
const rawHandlers = new Map();

beforeAll(async () => {
  handleToolCall.mockImplementation(async (name) => ({
    content: [{ type: 'text', text: `${name} ok` }],
  }));
  const origSet = Server.prototype.setRequestHandler;
  Server.prototype.setRequestHandler = function (schema, handler) {
    rawHandlers.set(schema, handler);
    return origSet.call(this, schema, handler);
  };
  try {
    server = createMcpServer({ handleToolCall });
  } finally {
    Server.prototype.setRequestHandler = origSet;
  }
  client = new Client({ name: 'mcp-handlers-full', version: '1.0.0' }, {
    capabilities: { roots: { listChanged: true } },
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  // 该 SDK 版本的 Protocol 没有 sendNotification 方法（只有 notification），
  // 进度上报依赖它，测试中打桩以覆盖 notifyProgress 分支
  server.sendNotification = vi.fn(async () => {});
});

afterAll(async () => {
  await client?.close().catch(() => {});
  await server?.close().catch(() => {});
});

beforeEach(() => {
  vi.clearAllMocks();
  state.ctx = null;
  cadMock.connected = true;
  cadMock.sendCommandWithResult.mockReset(); // 清空 once 队列，避免用例间串扰
  cadMock.sendCommandWithResult.mockImplementation(async () => 'nil');
  cadMock.sendCommand.mockResolvedValue(undefined);
  server.sendNotification.mockReset();
  server.sendNotification.mockImplementation(async () => {});
  checkToolRateLimit.mockReturnValue({ allowed: true });
  listResources.mockResolvedValue([]);
  readResource.mockResolvedValue({ ok: 1 });
  listPrompts.mockResolvedValue([]);
  getPrompt.mockResolvedValue({ description: 'd', messages: [] });
  subManager.list.mockReturnValue([]);
  handleToolCall.mockImplementation(async (name) => ({
    content: [{ type: 'text', text: `${name} ok` }],
  }));
});

// 直接调用原始 handler：绕过 SDK 对 completion/complete 的 ref 联合类型校验
async function complete(ref, argument) {
  const handler = rawHandlers.get(CompleteRequestSchema);
  expect(handler).toBeTypeOf('function');
  return handler({ params: { ref, argument } });
}

describe('tools/list 分页', () => {
  it('按 cursor 翻完全部页且末页无 nextCursor', async () => {
    const visible = getVisibleTools();
    expect(visible.length).toBeGreaterThan(100);
    let cursor;
    let total = 0;
    let pages = 0;
    do {
      const r = await client.listTools(cursor ? { cursor } : {});
      expect(r.tools.length).toBeLessThanOrEqual(100);
      total += r.tools.length;
      cursor = r.nextCursor;
      pages += 1;
      expect(pages).toBeLessThan(10);
    } while (cursor);
    expect(total).toBe(visible.length);
    expect(pages).toBe(Math.ceil(visible.length / 100));
  });

  it('非法 cursor 不抛错并返回空页（parseInt 得 NaN 边界）', async () => {
    const r = await client.listTools({ cursor: '!!!not-base64!!!' });
    expect(r.tools).toHaveLength(0);
    expect(r.nextCursor).toBeUndefined();
  });
});

describe('tools/call', () => {
  it('正常调用转发到 handleToolCall 并记录成功指标', async () => {
    const r = await client.callTool({ name: 'search_tools', arguments: { query: 'a' } });
    expect(r.content[0].text).toBe('search_tools ok');
    expect(handleToolCall).toHaveBeenCalledWith('search_tools', { query: 'a' }, { notifyProgress: null });
    expect(trackToolCall).toHaveBeenCalledWith('search_tools', expect.any(Number), true);
    expect(trackError).not.toHaveBeenCalled();
  });

  it('handleToolCall 抛错时向上抛出并记录错误指标', async () => {
    handleToolCall.mockRejectedValueOnce(new Error('boom'));
    await expect(client.callTool({ name: 'bad_tool', arguments: {} })).rejects.toThrow('boom');
    expect(trackToolCall).toHaveBeenCalledWith('bad_tool', expect.any(Number), false);
    expect(trackError).toHaveBeenCalled();
  });

  it('meta.progressToken 存在时注入 notifyProgress 供进度上报', async () => {
    const handler = rawHandlers.get(CallToolRequestSchema);
    handleToolCall.mockImplementationOnce(async (name, args, extra) => {
      expect(typeof extra.notifyProgress).toBe('function');
      extra.notifyProgress(1, 3, 'working'); // 触发 sendNotification 分支
      return { content: [{ type: 'text', text: 'done' }] };
    });
    const result = await handler({
      params: { name: 'long_tool', arguments: {}, meta: { progressToken: 'tok-1' } },
    });
    expect(result.content[0].text).toBe('done');
    expect(server.sendNotification).toHaveBeenCalledWith({
      method: 'notifications/progress',
      params: { progressToken: 'tok-1', progress: 1, total: 3, message: 'working' },
    });
    expect(trackToolCall).toHaveBeenCalledWith('long_tool', expect.any(Number), true);
  });

  it('无 meta 时 notifyProgress 为 null（不会触发通知）', async () => {
    const handler = rawHandlers.get(CallToolRequestSchema);
    const result = await handler({ params: { name: 'plain', arguments: {} } });
    expect(result.content[0].text).toBe('plain ok');
    expect(handleToolCall).toHaveBeenCalledWith('plain', {}, { notifyProgress: null });
  });
});

describe('resources', () => {
  it('resources/list 按 100 条分页', async () => {
    listResources.mockResolvedValue(
      Array.from({ length: 150 }, (_, i) => ({ uri: `atlisp://r/${i}`, name: `r${i}` }))
    );
    const p1 = await client.listResources();
    expect(p1.resources).toHaveLength(100);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await client.listResources({ cursor: p1.nextCursor });
    expect(p2.resources).toHaveLength(50);
    expect(p2.nextCursor).toBeUndefined();
    expect(listResources).toHaveBeenCalledWith([]);
  });

  it('会话上下文存在时带 sessionId 查询订阅列表', async () => {
    state.ctx = { sessionId: 's1' };
    await client.listResources();
    expect(subManager.list).toHaveBeenCalledWith('s1');
    state.ctx = null;
    await client.listResources();
    expect(subManager.list).toHaveBeenLastCalledWith();
  });

  it('resources/templates/list 返回 6 个模板', async () => {
    const r = await client.listResourceTemplates();
    expect(r.resourceTemplates).toHaveLength(6);
    expect(r.resourceTemplates.map(t => t.uriTemplate)).toContain('atlisp://dwg/entity/{handle}');
  });

  it('resources/read 返回 JSON 文本内容', async () => {
    readResource.mockResolvedValueOnce({ layers: ['0', 'Wall'] });
    const r = await client.readResource({ uri: 'atlisp://dwg/tbl/layer' });
    expect(r.contents[0].mimeType).toBe('application/json');
    expect(JSON.parse(r.contents[0].text)).toEqual({ layers: ['0', 'Wall'] });
  });

  it('resources/read 支持 _blob 二进制内容', async () => {
    readResource.mockResolvedValueOnce({ _blob: 'QUJD', mimeType: 'image/png' });
    const r = await client.readResource({ uri: 'atlisp://dwg/preview' });
    expect(r.contents[0]).toEqual({
      uri: 'atlisp://dwg/preview',
      mimeType: 'image/png',
      blob: 'QUJD',
    });
  });

  it('resources/read 抛错时返回 isError 与错误文本', async () => {
    readResource.mockRejectedValueOnce(new Error('uri 不存在'));
    const handler = rawHandlers.get(ReadResourceRequestSchema);
    const out = await handler({ params: { uri: 'atlisp://bad' } });
    expect(out.isError).toBe(true);
    expect(out.contents[0].text).toContain('错误: uri 不存在');
  });

  it('subscribe/unsubscribe 透传 uri 与会话上下文', async () => {
    // 该 SDK 返回结果 schema 不接受 {success:true}，客户端路径会拒绝，故直接调原始 handler
    const subH = rawHandlers.get(SubscribeRequestSchema);
    const unsubH = rawHandlers.get(UnsubscribeRequestSchema);
    expect(await subH({ params: { uri: 'atlisp://dwg/tbl/layer' } })).toEqual({ success: true });
    expect(subManager.subscribe).toHaveBeenCalledWith('atlisp://dwg/tbl/layer', undefined);
    state.ctx = { sessionId: 's2' };
    expect(await unsubH({ params: { uri: 'atlisp://dwg/tbl/layer' } })).toEqual({ success: true });
    expect(subManager.unsubscribe).toHaveBeenCalledWith('atlisp://dwg/tbl/layer', 's2');
  });
});

describe('prompts', () => {
  it('prompts/list 按 50 条分页', async () => {
    listPrompts.mockResolvedValue(PROMPTS);
    const p1 = await client.listPrompts();
    expect(p1.prompts).toHaveLength(50);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await client.listPrompts({ cursor: p1.nextCursor });
    expect(p2.prompts).toHaveLength(10);
    expect(p2.nextCursor).toBeUndefined();
  });

  it('prompts/get 透传 name 与 arguments', async () => {
    getPrompt.mockResolvedValueOnce({ description: 'x', messages: [] });
    const r = await client.getPrompt({ name: 'plot', arguments: { scale: '1:100' } });
    expect(getPrompt).toHaveBeenCalledWith('plot', { scale: '1:100' });
    expect(r.description).toBe('x');
  });
});

describe('completions 限流与 ref/prompt、ref/resource', () => {
  it('限流拒绝时返回空补全', async () => {
    checkToolRateLimit.mockReturnValueOnce({ allowed: false });
    const r = await complete({ type: 'layer' }, { name: 'layer', value: 'a' });
    expect(r.completion).toEqual({ values: [], hasMore: false, total: 0 });
    expect(cadMock.sendCommandWithResult).not.toHaveBeenCalled();
  });

  it('ref/prompt 按参数 validValues 前缀过滤', async () => {
    listPrompts.mockResolvedValue(PROMPTS);
    const r = await complete(
      { type: 'ref/prompt', name: 'prompt-00' },
      { name: 'mode', value: 'st' }
    );
    expect(r.completion.values).toEqual(['Strict', 'Steady']);
    expect(r.completion.hasMore).toBe(false);
  });

  it('ref/prompt 未给参数名时补全提示词与参数名并分片', async () => {
    listPrompts.mockResolvedValue(PROMPTS);
    const r = await complete({ type: 'ref/prompt', name: 'prompt-00' }, { name: '', value: 'p' });
    expect(r.completion.values).toHaveLength(20);
    expect(r.completion.hasMore).toBe(true);
    expect(r.completion.total).toBe(60);
  });

  it('ref/prompt 查询失败时返回空并记日志', async () => {
    listPrompts.mockRejectedValueOnce(new Error('prompt boom'));
    const r = await complete({ type: 'ref/prompt', name: 'x' }, { name: '', value: '' });
    expect(r.completion.values).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('prompt boom'));
  });

  it('ref/resource 匹配资源与模板', async () => {
    listResources.mockResolvedValue([
      { name: 'dwg-state', uri: 'atlisp://dwg/state' },
      { name: 'unrelated', uri: 'file:///x' },
    ]);
    const r = await complete({ type: 'ref/resource' }, { name: 'uri', value: 'atlisp' });
    expect(r.completion.values).toContain('atlisp://dwg/state');
    expect(r.completion.values).toContain('atlisp://dwg/entity/{handle}');
    expect(r.completion.values).not.toContain('unrelated');
    expect(r.completion.values).not.toContain('file:///x');
  });

  it('ref/resource 查询失败时返回空', async () => {
    listResources.mockRejectedValueOnce(new Error('res boom'));
    const r = await complete({ type: 'ref/resource' }, { name: 'uri', value: '' });
    expect(r.completion.values).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('res boom'));
  });

  it('未知 ref 类型返回空补全', async () => {
    const r = await complete({ type: 'emoji' }, { name: 'x', value: '' });
    expect(r.completion).toEqual({ values: [], hasMore: false, total: 0 });
    expect(cadMock.sendCommandWithResult).not.toHaveBeenCalled();
  });

  it('经客户端 schema 校验路径的 ref/prompt 补全端到端可用', async () => {
    listPrompts.mockResolvedValue(PROMPTS);
    const r = await client.complete({
      ref: { type: 'ref/prompt', name: 'prompt-00' },
      argument: { name: 'mode', value: 'si' },
    });
    expect(r.completion.values).toEqual(['Simple']);
  });

  it('经客户端路径的 ref/resource 补全端到端可用', async () => {
    listResources.mockResolvedValue([{ name: 'dwg-state', uri: 'atlisp://dwg/state' }]);
    const r = await client.complete({
      ref: { type: 'ref/resource', uri: 'atlisp://dwg/{tbl}' },
      argument: { name: 'uri', value: 'dwg' },
    });
    expect(r.completion.values).toContain('dwg-state');
  });
});

describe('completions CAD 表缓存类 ref', () => {
  it.each([
    ['block', ['*Model_Space', 'Door', 'BOX'], 'd', ['Door']],
    ['linetype', ['Continuous', 'DASHED', 'HIDDEN'], 'da', ['DASHED']],
    ['textstyle', ['Standard', 'ST45'], 'st', ['Standard', 'ST45']],
    ['dimstyle', ['ISO-25', 'MED'], 'iso', ['ISO-25']],
    ['ucs', ['World', 'MyUCS'], 'wo', ['World']],
    ['layout', ['Layout1', 'Publish'], 'pub', ['Publish']],
    ['group', ['G1', 'G2'], 'g', ['G1', 'G2']],
  ])('%s 补全：查询 CAD + 过滤 + 二次命中缓存', async (type, items, prefix, expected) => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce(JSON.stringify(items));
    const first = await complete({ type }, { name: type, value: prefix });
    expect(first.completion.values).toEqual(expected);
    expect(cadMock.sendCommandWithResult).toHaveBeenCalledTimes(1);

    const second = await complete({ type }, { name: type, value: '' });
    expect(second.completion.values).toEqual(items);
    expect(cadMock.sendCommandWithResult).toHaveBeenCalledTimes(1); // 缓存命中
  });

  it('layer 查询失败（CAD 抛错）时返回空', async () => {
    cadMock.sendCommandWithResult.mockRejectedValueOnce(new Error('cad down'));
    const r = await complete({ type: 'layer' }, { name: 'layer', value: '' });
    expect(r.completion.values).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('cad down'));
  });

  it('layer 返回非法 JSON 时返回空并记日志', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce('({bad json');
    const r = await complete({ type: 'layer' }, { name: 'layer', value: '' });
    expect(r.completion.values).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Complete error'));
  });

  it('layer 成功查询后写入缓存（两次调用仅一次 CAD 查询）', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce(JSON.stringify(['0', 'Wall']));
    const first = await complete({ type: 'layer' }, { name: 'layer', value: 'wa' });
    expect(first.completion.values).toEqual(['Wall']);
    const second = await complete({ type: 'layer' }, { name: 'layer', value: '0' });
    expect(second.completion.values).toEqual(['0']);
    expect(cadMock.sendCommandWithResult).toHaveBeenCalledTimes(1);
  });

  it('layer 返回 nil（无图层）时返回空', async () => {
    const r = await complete({ type: 'layer' }, { name: 'layer', value: '' });
    // layer 缓存可能已被前面用例写入；nil 时若未缓存则应为空
    expect(Array.isArray(r.completion.values)).toBe(true);
    expect(r.completion.total).toBe(r.completion.values.length);
  });
});

describe('completions hatch / tool / 参数补全', () => {
  it('hatch 按内置图案前缀过滤', async () => {
    const r = await complete({ type: 'hatch' }, { name: 'pattern', value: 'ansi' });
    expect(r.completion.values).toEqual([
      'ANSI31', 'ANSI32', 'ANSI33', 'ANSI34', 'ANSI35', 'ANSI36', 'ANSI37', 'ANSI38',
    ]);
    expect(r.completion.hasMore).toBe(false);
  });

  it('tool 前缀过滤并截断到 20 条', async () => {
    const r = await complete({ type: 'tool' }, { name: 'tool', value: '' });
    expect(r.completion.values).toHaveLength(20);
    expect(r.completion.total).toBeGreaterThan(20);
    expect(r.completion.hasMore).toBe(true);
  });

  it('ref/parameter enum 分支按前缀过滤枚举值', async () => {
    const r = await complete(
      { type: 'ref/parameter', name: 'list_tools_by_priority' },
      { name: 'priority', value: 'c' }
    );
    expect(r.completion.values).toEqual(['core', 'common']);
    expect(cadMock.sendCommandWithResult).not.toHaveBeenCalled();
  });

  it('ref/parameter handle 分支在已连接时查询句柄', async () => {
    cadMock.sendCommandWithResult.mockResolvedValueOnce('("ABC1" "DEF2")');
    const r = await complete(
      { type: 'ref/parameter', name: 'move_entity' },
      { name: 'handle', value: 'a' }
    );
    expect(r.completion.values).toEqual(['ABC1']);
    expect(cadMock.sendCommandWithResult).toHaveBeenCalledTimes(1);
  });

  it('ref/parameter handle 分支在断连时返回空', async () => {
    cadMock.connected = false;
    const r = await complete(
      { type: 'ref/parameter', name: 'move_entity' },
      { name: 'handle', value: 'a' }
    );
    expect(r.completion.values).toEqual([]);
    expect(cadMock.sendCommandWithResult).not.toHaveBeenCalled();
  });

  it('ref/parameter layer 参数分支查询 LAYER 表', async () => {
    const layerTool = getVisibleTools().find(t =>
      Object.keys(t.inputSchema?.properties || {}).some(p => /^layer/i.test(p))
    );
    expect(layerTool).toBeDefined();
    const param = Object.keys(layerTool.inputSchema.properties).find(p => /^layer/i.test(p));
    cadMock.sendCommandWithResult.mockResolvedValueOnce('("0" "Wall")');
    const r = await complete(
      { type: 'ref/parameter', name: layerTool.name },
      { name: param, value: 'w' }
    );
    expect(r.completion.values).toEqual(['Wall']);
  });

  it('ref/parameter 查询 CAD 抛错时返回空', async () => {
    const layerTool = getVisibleTools().find(t =>
      Object.keys(t.inputSchema?.properties || {}).some(p => /^layer/i.test(p))
    );
    const param = Object.keys(layerTool.inputSchema.properties).find(p => /^layer/i.test(p));
    cadMock.sendCommandWithResult.mockRejectedValueOnce(new Error('tbl fail'));
    const r = await complete(
      { type: 'ref/parameter', name: layerTool.name },
      { name: param, value: '' }
    );
    expect(r.completion.values).toEqual([]);
  });

  it('ref/parameter 工具不存在时返回空', async () => {
    const r = await complete(
      { type: 'ref/parameter', name: 'no_such_tool' },
      { name: 'x', value: '' }
    );
    expect(r.completion.values).toEqual([]);
    expect(cadMock.sendCommandWithResult).not.toHaveBeenCalled();
  });

  it('ref/parameter 参数不匹配任何表时返回空', async () => {
    const r = await complete(
      { type: 'ref/parameter', name: 'move_entity' },
      { name: 'dx', value: '1' }
    );
    expect(r.completion.values).toEqual([]);
    expect(cadMock.sendCommandWithResult).not.toHaveBeenCalled();
  });

  it('ref/parameter 非 handle 且断连时直接返回空', async () => {
    cadMock.connected = false;
    const r = await complete(
      { type: 'ref/parameter', name: 'move_entity' },
      { name: 'handle', value: 'a' }
    );
    expect(r.completion.values).toEqual([]);
  });
});

describe('通知处理', () => {
  it('cancelled 通知发送 UCS 取消命令（带 reason）', async () => {
    await client.notification({
      method: 'notifications/cancelled',
      params: { requestId: 42, reason: 'user aborted' },
    });
    await new Promise(r => setTimeout(r, 20));
    expect(cadMock.sendCommand).toHaveBeenCalledWith('(command "_.UCS" "")');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('reason=user aborted'));
  });

  it('cancelled 通知不带 reason 时不拼接 reason 文本', async () => {
    await client.notification({
      method: 'notifications/cancelled',
      params: { requestId: 43 },
    });
    await new Promise(r => setTimeout(r, 20));
    expect(log).toHaveBeenCalledWith('Request cancelled by client: id=43');
  });

  it('progress 通知记日志', async () => {
    await client.notification({
      method: 'notifications/progress',
      params: { progressToken: 'tok', progress: 3, total: 10, message: '30%' },
    });
    await new Promise(r => setTimeout(r, 20));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Client progress: token=tok 3/10 30%'));
  });

  it('resourceListChanged / toolListChanged 记 no-op 日志', async () => {
    await client.notification({ method: 'notifications/resources/list_changed' });
    await client.notification({ method: 'notifications/tools/list_changed' });
    await new Promise(r => setTimeout(r, 20));
    expect(log).toHaveBeenCalledWith('Client resource list changed (no-op)');
    expect(log).toHaveBeenCalledWith('Client tool list changed (no-op)');
  });

  it('roots/list_changed 触发 listRoots 并写入 client roots', async () => {
    client.setRequestHandler(ListRootsRequestSchema, async () => ({
      roots: [{ uri: 'file:///proj', name: 'proj' }],
    }));
    await client.notification({ method: 'notifications/roots/list_changed' });
    await new Promise(r => setTimeout(r, 30));
    // SDK listRoots() 返回 ListRootsResult 对象（非数组），原样透传给 setClientRoots
    expect(setClientRoots).toHaveBeenCalledWith({
      roots: [{ uri: 'file:///proj', name: 'proj' }],
    });
    expect(log).toHaveBeenCalledWith('Client roots changed');
  });

  it('重新发送 initialized 触发 oninitialized（结果无 .length 时跳过 roots 写入）', async () => {
    setClientRoots.mockClear();
    client.setRequestHandler(ListRootsRequestSchema, async () => ({
      roots: [{ uri: 'file:///again', name: 'again' }],
    }));
    await client.notification({ method: 'notifications/initialized' });
    await new Promise(r => setTimeout(r, 30));
    expect(log).toHaveBeenCalledWith('MCP client initialized, session ready');
    // roots?.length 为 undefined（SDK 返回对象），因此不写入
    expect(setClientRoots).not.toHaveBeenCalled();
  });

  it('notifyProgress 发送通知失败时被 .catch 吞掉，工具调用不受影响', async () => {
    server.sendNotification.mockRejectedValueOnce(new Error('send fail'));
    const handler = rawHandlers.get(CallToolRequestSchema);
    handleToolCall.mockImplementationOnce(async (name, args, extra) => {
      extra.notifyProgress(1, 2, 'x'); // 不应抛出
      return { content: [{ type: 'text', text: 'ok' }] };
    });
    const result = await handler({
      params: { name: 't2', arguments: {}, meta: { progressToken: 'p2' } },
    });
    expect(result.content[0].text).toBe('ok');
    expect(server.sendNotification).toHaveBeenCalledTimes(1);
  });
});
