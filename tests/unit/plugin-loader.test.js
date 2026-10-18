// plugin-loader.js 单测：mock homedir 到临时目录，写真实插件文件验证
// 加载 / 下划线跳过 / 语法错误容错 / 钩子调用 / 监听器热重载。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const TEST_HOME = `/tmp/opencode/pl-test-${process.pid}`;

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
const { log, error: logError } = await import('../../src/logger.js');

const PLUGIN_DIR = loader.getPluginDir();

function writePlugin(file, content) {
  fs.writeFileSync(path.join(PLUGIN_DIR, file), content, 'utf-8');
}

beforeEach(() => {
  vi.clearAllMocks();
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
});

afterEach(() => {
  loader.stopPluginWatcher();
  vi.restoreAllMocks();
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('getPluginDir', () => {
  it('基于 homedir 计算插件目录', () => {
    expect(PLUGIN_DIR).toBe(path.join(TEST_HOME, '.atlisp', 'mcp-plugins'));
  });
});

describe('loadPlugins', () => {
  it('目录不存在时自动创建并返回空数组', async () => {
    expect(fs.existsSync(PLUGIN_DIR)).toBe(false);
    const result = await loader.loadPlugins();
    expect(result).toEqual([]);
    expect(fs.existsSync(PLUGIN_DIR)).toBe(true);
  });

  it('加载合法插件（default.setup 导出），跳过下划线与非 .js 文件', async () => {
    fs.mkdirSync(PLUGIN_DIR, { recursive: true });
    writePlugin('good.js', `export default { name: 'good', setup() { return 1; }, onInit() {} };`);
    writePlugin('_skip.js', `export default { name: 'skipped', setup() {} };`);
    writePlugin('notes.txt', 'not a plugin');

    const result = await loader.loadPlugins();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('good');
    expect(result[0]._file).toBe('good.js');
    expect(typeof result[0].setup).toBe('function');
    expect(loader.getPlugins()).toBe(result);
  });

  it('语法错误插件被容错跳过并记录错误', async () => {
    fs.mkdirSync(PLUGIN_DIR, { recursive: true });
    writePlugin('bad.js', `export default { name: 'bad', setup( };`);
    writePlugin('good.js', `export default { name: 'good', setup() {} };`);

    const result = await loader.loadPlugins();
    expect(result.map(p => p.name)).toEqual(['good']);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('Failed to load plugin bad.js'));
  });

  it('缺少 default.setup 导出的插件返回 null 并记录错误', async () => {
    fs.mkdirSync(PLUGIN_DIR, { recursive: true });
    writePlugin('nosetup.js', `export const name = 'nosetup';`);
    const result = await loader.loadPlugins();
    expect(result).toEqual([]);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('has no default.setup() export'));
  });
});

describe('initPlugins / callPluginHook', () => {
  it('onInit 挂载并传入 context；抛错被记录但不中断', async () => {
    fs.mkdirSync(PLUGIN_DIR, { recursive: true });
    writePlugin('p1.js', `export default { name: 'p1', setup() {}, onInit(ctx) { globalThis.__p1ctx = ctx; } };`);
    writePlugin('p2.js', `export default { name: 'p2', setup() {}, onInit() { throw new Error('boom'); } };`);
    await loader.loadPlugins();

    loader.initPlugins({ server: 'test' });
    expect(globalThis.__p1ctx).toEqual({ server: 'test' });
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("Plugin init error [p2]"));
    delete globalThis.__p1ctx;
  });

  it('callPluginHook 收集返回值与抛错信息', async () => {
    fs.mkdirSync(PLUGIN_DIR, { recursive: true });
    writePlugin('ok.js', `export default { name: 'ok', setup() {}, onToolCall(name, args) { return name + ':' + args.x; } };`);
    writePlugin('err.js', `export default { name: 'err', setup() {}, onToolCall() { throw new Error('hook-fail'); } };`);
    writePlugin('silent.js', `export default { name: 'silent', setup() {} };`);
    await loader.loadPlugins();

    const results = loader.callPluginHook('onToolCall', 'draw_line', { x: 1 });
    expect(results).toContainEqual({ plugin: 'ok', result: 'draw_line:1' });
    expect(results).toContainEqual({ plugin: 'err', error: 'hook-fail' });
    expect(results).toHaveLength(2); // silent.js 无该钩子，不参与

    expect(loader.callPluginHook('nonexistentHook')).toEqual([]);
  });
});

describe('插件目录监听（fs.watch 被 mock，手动驱动回调）', () => {
  it('startPluginWatcher 注册一次；新增/更新/删除插件触发回调；下划线文件被忽略', async () => {
    fs.mkdirSync(PLUGIN_DIR, { recursive: true });
    let watcherCb = null;
    const fakeWatcher = { close: vi.fn() };
    const watchSpy = vi.spyOn(fs, 'watch').mockImplementation((dir, cb) => {
      watcherCb = cb;
      return fakeWatcher;
    });

    const changes = [];
    loader.onPluginChange((type, name) => changes.push([type, name]));

    loader.startPluginWatcher();
    loader.startPluginWatcher(); // 幂等：已有 watcher 直接返回
    expect(watchSpy).toHaveBeenCalledTimes(1);
    expect(watchSpy).toHaveBeenCalledWith(PLUGIN_DIR, expect.any(Function));

    // 新增插件
    writePlugin('hot.js', `export default { name: 'hot', setup() {} };`);
    await watcherCb('rename', 'hot.js');
    expect(loader.getPlugins().map(p => p.name)).toContain('hot');
    expect(changes).toContainEqual(['add', 'hot.js']);

    // 更新（同名重新加载，_file 记录文件名）。
    // loadSinglePlugin 用 ?t=Date.now() 破坏 import 缓存；vitest 下同路径模块可能复用缓存，
    // 因此这里断言「替换分支执行 + 日志」而非模块内容一定变化。
    await new Promise(r => setTimeout(r, 5));
    writePlugin('hot.js', `export default { name: 'hot2', setup() {} };`);
    await watcherCb('rename', 'hot.js');
    expect(loader.getPlugins().some(p => p._file === 'hot.js')).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Plugin reloaded'));
    expect(changes).toContainEqual(['update', 'hot.js']);

    // 原地保存（change）也要热重载——多数编辑器保存时只发 change 事件
    await new Promise(r => setTimeout(r, 5));
    writePlugin('inplace.js', `export default { name: 'inplace', setup() {} };`);
    await watcherCb('change', 'inplace.js');
    expect(loader.getPlugins().map(p => p.name)).toContain('inplace');
    expect(changes).toContainEqual(['add', 'inplace.js']);

    await new Promise(r => setTimeout(r, 5));
    writePlugin('inplace.js', `export default { name: 'inplace2', setup() {} };`);
    await watcherCb('change', 'inplace.js');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Plugin reloaded'));

    // 删除
    fs.unlinkSync(path.join(PLUGIN_DIR, 'hot.js'));
    await watcherCb('rename', 'hot.js');
    expect(loader.getPlugins().some(p => p._file === 'hot.js')).toBe(false);
    expect(changes).toContainEqual(['remove', 'hot.js']);

    // 删除同样是 change 事件时也能移除
    fs.unlinkSync(path.join(PLUGIN_DIR, 'inplace.js'));
    await watcherCb('change', 'inplace.js');
    expect(loader.getPlugins().some(p => p._file === 'inplace.js')).toBe(false);

    // 下划线文件与非 .js 被忽略
    writePlugin('_ignored.js', `export default { name: 'ignored', setup() {} };`);
    await watcherCb('rename', '_ignored.js');
    await watcherCb(null, null);
    expect(loader.getPlugins().some(p => p.name === 'ignored')).toBe(false);
    expect(changes).not.toContainEqual(['add', '_ignored.js']);

    loader.stopPluginWatcher();
    expect(fakeWatcher.close).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('Plugin watcher stopped');

    // stop 之后再次 start 可以重新注册
    loader.startPluginWatcher();
    expect(watchSpy).toHaveBeenCalledTimes(2);
    loader.stopPluginWatcher();
  });

  it('热加载的新插件收到 onInit；重载/删除前调用 onUnload', async () => {
    fs.mkdirSync(PLUGIN_DIR, { recursive: true });
    let watcherCb = null;
    vi.spyOn(fs, 'watch').mockImplementation((dir, cb) => {
      watcherCb = cb;
      return { close: vi.fn() };
    });

    const ctx = { log: vi.fn() };
    loader.initPlugins(ctx);
    globalThis.__lifeInit = 0;
    globalThis.__lifeUnload = 0;
    try {
      const body = (extra = '') => `export default {
        name: 'life', setup() {},
        onInit(c) { globalThis.__lifeInit += 1; globalThis.__lifeCtx = c; },
        onUnload() { globalThis.__lifeUnload += 1; }${extra}
      };`;
      writePlugin('life.js', body());
      loader.startPluginWatcher();
      await watcherCb('rename', 'life.js');

      // 热加载的新插件也要拿到 init 上下文并执行 onInit（否则不会注册工具）
      expect(globalThis.__lifeInit).toBe(1);
      expect(globalThis.__lifeCtx).toBe(ctx);

      await new Promise(r => setTimeout(r, 5));
      writePlugin('life.js', body());
      await watcherCb('change', 'life.js');
      expect(globalThis.__lifeUnload).toBe(1);
      expect(globalThis.__lifeInit).toBe(2);

      fs.unlinkSync(path.join(PLUGIN_DIR, 'life.js'));
      await watcherCb('rename', 'life.js');
      expect(globalThis.__lifeUnload).toBe(2);
    } finally {
      loader.stopPluginWatcher();
      delete globalThis.__lifeInit;
      delete globalThis.__lifeUnload;
      delete globalThis.__lifeCtx;
    }
  });
});
