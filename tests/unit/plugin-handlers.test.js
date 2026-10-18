// plugin_list / plugin_reload 处理器：诊断已加载插件、手动重载。
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPlugins: vi.fn(),
  getPluginTools: vi.fn(),
  reloadPlugins: vi.fn(),
}));

vi.mock('../../src/plugin-loader.js', () => ({
  getPlugins: mocks.getPlugins,
  getPluginTools: mocks.getPluginTools,
  reloadPlugins: mocks.reloadPlugins,
}));

const { pluginList, pluginReload } = await import('../../src/handlers/plugin-handlers.js');

describe('pluginList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('汇总插件名/文件/钩子/工具', async () => {
    const plugin = {
      name: 'demo',
      _file: 'demo.js',
      onInit: () => {},
      onToolExecuted: () => {},
      onUnload: () => {},
    };
    mocks.getPlugins.mockReturnValue([plugin]);
    mocks.getPluginTools.mockReturnValue(['echo_debug']);

    const result = await pluginList();
    expect(mocks.getPluginTools).toHaveBeenCalledWith(plugin);
    expect(result.structuredContent).toEqual({
      count: 1,
      plugins: [{
        name: 'demo',
        file: 'demo.js',
        hooks: ['onInit', 'onUnload', 'onToolExecuted'],
        tools: ['echo_debug'],
      }],
    });
    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
  });

  it('无插件时返回空清单', async () => {
    mocks.getPlugins.mockReturnValue([]);
    const result = await pluginList();
    expect(result.structuredContent).toEqual({ count: 0, plugins: [] });
  });
});

describe('pluginReload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('返回重载后的插件名与数量', async () => {
    mocks.reloadPlugins.mockResolvedValue(2);
    mocks.getPlugins.mockReturnValue([
      { name: 'a', _file: 'a.js' },
      { _file: 'b.js' },
    ]);

    const result = await pluginReload();
    expect(mocks.reloadPlugins).toHaveBeenCalled();
    expect(result.structuredContent).toEqual({ count: 2, plugins: ['a', 'b.js'] });
  });

  it('重载失败返回 isError', async () => {
    mocks.reloadPlugins.mockRejectedValue(new Error('disk error'));
    const result = await pluginReload();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('disk error');
  });
});
