// 官方示例插件冒烟测试（examples/plugins/）：
// 1) 动态 import 每个示例 → 校验结构（name/setup/onInit 合法）
// 2) 用 mock context（log/registerTool/tools）调用 default.setup() → 校验注册参数
// 3) 把示例拷入插件目录，走 plugin-loader 的真实加载路径（loadPlugins → initPlugins）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const TEST_HOME = `/tmp/opencode/examples-plugins-${process.pid}`;

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: { ...actual.default, homedir: () => TEST_HOME },
    homedir: () => TEST_HOME,
  };
});

vi.mock('../../src/logger.js', () => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  closeLog: vi.fn(),
}));

const loader = await import('../../src/plugin-loader.js');
const { error: logError } = await import('../../src/logger.js');

const EXAMPLES_DIR = fileURLToPath(new URL('../../examples/plugins/', import.meta.url));
const EXAMPLE_FILES = ['example-custom-tool.js', 'example-audit-hook.js', 'example-event-logger.js'];
const PLUGIN_DIR = loader.getPluginDir();

/** 与核心 initPlugins(context) 相同形状的 mock 上下文 */
function makeContext() {
  const logs = [];
  const context = {
    cad: {
      connected: true,
      getPlatform: () => 'AutoCAD',
      getVersion: () => '2026.1',
      sendCommand: vi.fn(async () => true),
      sendCommandWithResult: vi.fn(async () => 'cad-result'),
    },
    config: { transport: 'http', port: 8110 },
    log: (msg) => logs.push(String(msg)),
    registerTool: null,
    tools: [],
  };
  // 模拟核心 registerTool：推入同一个 tools 数组（与 src/tool-registry.js 行为一致）
  context.registerTool = vi.fn((toolDef, _handler) => {
    context.tools.push(toolDef);
    return true;
  });
  return { context, logs };
}

async function importExample(file) {
  const mod = await import(path.join(EXAMPLES_DIR, file));
  return mod.default;
}

beforeEach(() => {
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
});

afterEach(() => {
  loader.stopPluginWatcher();
  vi.clearAllMocks();
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('示例插件结构（动态 import → default 导出）', () => {
  it('三个示例都导出合法插件对象（name / setup / onInit）', async () => {
    const expectedNames = {
      'example-custom-tool.js': 'example-custom-tool',
      'example-audit-hook.js': 'example-audit-hook',
      'example-event-logger.js': 'example-event-logger',
    };
    for (const file of EXAMPLE_FILES) {
      const plugin = await importExample(file);
      expect(plugin, `${file} 缺少 default 导出`).toBeTruthy();
      expect(typeof plugin.name).toBe('string');
      expect(plugin.name.length).toBeGreaterThan(0);
      expect(typeof plugin.setup, `${file} 的 setup 不是函数`).toBe('function');
      expect(typeof plugin.onInit, `${file} 缺少 onInit`).toBe('function');
      expect(plugin.name).toBe(expectedNames[file]);
      expect(file.startsWith('_')).toBe(false); // 下划线前缀会被 loader 跳过
    }
  });
});

describe('示例插件 setup()（mock context）', () => {
  it('example-custom-tool: 注册 echo_debug，参数含 name/inputSchema 与 handler', async () => {
    const plugin = await importExample('example-custom-tool.js');
    const { context } = makeContext();

    const ok = plugin.setup(context);

    expect(ok).toBe(true);
    expect(context.registerTool).toHaveBeenCalledTimes(1);
    const [toolDef, handler] = context.registerTool.mock.calls[0];
    expect(typeof toolDef.name).toBe('string');
    expect(toolDef.name).toBe('echo_debug');
    expect(toolDef.inputSchema).toBeTruthy();
    expect(toolDef.inputSchema.type).toBe('object');
    expect(toolDef.inputSchema.properties).toHaveProperty('message');
    expect(toolDef.inputSchema.required).toContain('message');
    expect(typeof handler).toBe('function');
    expect(toolDef.annotations?.readOnlyHint).toBe(true);
  });

  it('example-custom-tool: handler 是只读回显，不触碰 CAD', async () => {
    const plugin = await importExample('example-custom-tool.js');
    const { context } = makeContext();
    plugin.setup(context);
    const [, handler] = context.registerTool.mock.calls[0];

    const result = await handler({ message: 'hello-plugin' });
    expect(result).toEqual({ content: [{ type: 'text', text: 'hello-plugin' }] });
    // 只读：handler 不向 CAD 发送任何命令
    expect(context.cad.sendCommand).not.toHaveBeenCalled();
    expect(context.cad.sendCommandWithResult).not.toHaveBeenCalled();
  });

  it('example-custom-tool: onInit 幂等转发 setup，只注册一次并打日志', async () => {
    const plugin = await importExample('example-custom-tool.js');
    const { context, logs } = makeContext();

    plugin.setup(context);
    plugin.onInit(context);

    expect(context.registerTool).toHaveBeenCalledTimes(1);
    expect(logs.some((m) => m.includes('[example-custom-tool] echo_debug 已注册'))).toBe(true);
    expect(logs.some((m) => m.includes('[example-custom-tool] 初始化完成'))).toBe(true);
  });

  it('example-custom-tool: 缺少 registerTool 的 context 下安全返回不抛错', async () => {
    const plugin = await importExample('example-custom-tool.js');
    expect(plugin.setup(null)).toBe(false);
    expect(plugin.setup({ log: () => {} })).toBe(false);
  });

  it('example-audit-hook: onToolCall / onToolExecuted 记录生命周期审计', async () => {
    const plugin = await importExample('example-audit-hook.js');
    const { context, logs } = makeContext();
    plugin.onInit(context);
    expect(logs.some((m) => m.includes('[example-audit-hook]'))).toBe(true);

    const before = plugin.onToolCall('draw_line', { x: 1, y: 2 });
    expect(before).toEqual({ observed: true, tool: 'draw_line' });
    plugin.onToolExecuted({
      name: 'draw_line',
      args: { x: 1, y: 2 },
      result: { content: [{ type: 'text', text: 'ok' }] },
      duration: 12,
      success: true,
    });

    const records = plugin.getRecords();
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ phase: 'before', tool: 'draw_line' });
    expect(records[1]).toMatchObject({ phase: 'after', tool: 'draw_line', duration: 12, success: true });
    expect(records[0].timestamp).toBeTruthy();
    // getRecords 返回副本，外部修改不影响内部状态
    records.pop();
    expect(plugin.getRecords()).toHaveLength(2);
  });

  it('example-event-logger: onInit 记录 CAD 初始状态，事件钩子记录并打日志', async () => {
    const plugin = await importExample('example-event-logger.js');
    const { context, logs } = makeContext();

    plugin.onInit(context);
    expect(logs.some((m) => m.includes('[example-event-logger] 初始化完成'))).toBe(true);
    const initEvents = plugin.getEvents();
    expect(initEvents).toHaveLength(1);
    expect(initEvents[0]).toMatchObject({
      type: 'init',
      payload: { connected: true, platform: 'AutoCAD', transport: 'http' },
    });

    plugin.onCadConnected({ platform: 'AutoCAD', version: '2026.1' });
    plugin.onCadDisconnected({ reason: 'user disconnect' });
    plugin.onDocumentChanged({ name: 'demo.dwg', action: 'opened' });
    plugin.onError({ message: 'boom', source: 'test', code: 'E1' });

    const events = plugin.getEvents();
    expect(events).toHaveLength(5);
    expect(events.map((e) => e.type)).toEqual([
      'init', 'cad-connected', 'cad-disconnected', 'document-changed', 'error',
    ]);
    expect(logs.some((m) => m.includes('CAD 已连接: AutoCAD'))).toBe(true);
    expect(logs.some((m) => m.includes('图纸变更: demo.dwg (opened)'))).toBe(true);
    expect(logs.some((m) => m.includes('错误事件 [test]: boom'))).toBe(true);
  });

  it('example-event-logger: onInit 之前收到事件不抛错', async () => {
    const plugin = await importExample('example-event-logger.js');
    plugin.setup(); // 复位共享模块实例的状态（setup 不依赖 context）
    expect(() => plugin.onCadConnected({ platform: 'ZWCAD' })).not.toThrow();
    expect(plugin.getEvents()).toHaveLength(1);
  });
});

describe('示例通过 plugin-loader 的加载路径', () => {
  it('拷入插件目录后 loadPlugins 加载全部 3 个，_ 前缀文件被跳过', async () => {
    fs.mkdirSync(PLUGIN_DIR, { recursive: true });
    for (const file of EXAMPLE_FILES) {
      fs.copyFileSync(path.join(EXAMPLES_DIR, file), path.join(PLUGIN_DIR, file));
    }
    // 下划线前缀的副本应被跳过（禁用示例的方式）
    fs.copyFileSync(
      path.join(EXAMPLES_DIR, 'example-custom-tool.js'),
      path.join(PLUGIN_DIR, '_example-custom-tool.js'),
    );

    const loaded = await loader.loadPlugins();

    expect(loaded.map((p) => p.name).sort()).toEqual([
      'example-audit-hook',
      'example-custom-tool',
      'example-event-logger',
    ]);
    for (const plugin of loaded) {
      expect(typeof plugin.setup).toBe('function');
      expect(typeof plugin.onInit).toBe('function');
    }
    expect(logError).not.toHaveBeenCalledWith(expect.stringContaining('has no default.setup()'));
    expect(logError).not.toHaveBeenCalledWith(expect.stringContaining('Failed to load plugin'));
  });

  it('initPlugins 触发各示例 onInit：日志齐全且 echo_debug 只注册一次', async () => {
    fs.mkdirSync(PLUGIN_DIR, { recursive: true });
    for (const file of EXAMPLE_FILES) {
      fs.copyFileSync(path.join(EXAMPLES_DIR, file), path.join(PLUGIN_DIR, file));
    }
    await loader.loadPlugins();

    const { context, logs } = makeContext();
    loader.initPlugins(context);

    expect(context.registerTool).toHaveBeenCalledTimes(1);
    expect(context.registerTool.mock.calls[0][0].name).toBe('echo_debug');
    expect(context.tools.map((t) => t.name)).toContain('echo_debug');
    expect(logs.some((m) => m.includes('[example-custom-tool]'))).toBe(true);
    expect(logs.some((m) => m.includes('[example-audit-hook]'))).toBe(true);
    expect(logs.some((m) => m.includes('[example-event-logger]'))).toBe(true);
    expect(logError).not.toHaveBeenCalledWith(expect.stringContaining('Plugin init error'));
  });
});
