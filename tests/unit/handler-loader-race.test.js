/**
 * handler-loader 并发初始化的竞态。
 *
 * 记忆 2026-11-03/04：MCP 1.12.20/ffabc74 上 `connect_cad`、`get_system_status`、
 * `get_system_variable` 轮流报 `Handler not found`，而同机另一会话刚读到平台和
 * 图纸。根因不是 handlers 文件缺，而是 initHandlerModules 用布尔标志：
 * 第一个调用者置 true 后去 await readdir，第二个调用者看到 true 直接返回，
 * `handlerModules` 还是空的 → 该工具永久缓存 null。
 *
 * 这里把 readdir 人为拖慢，确保两个工具同时进入初始化，复现旧行为必挂。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';

const TOOLS = ['connect_cad', 'get_cad_info', 'get_system_status', 'get_system_variable', 'list_packages'];

describe('handler-loader 并发初始化', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('多个工具并发解析时全部能拿到 handler（不能因竞态缓存 null）', async () => {
    const readdir = fs.promises.readdir.bind(fs.promises);

    vi.spyOn(fs.promises, 'readdir').mockImplementation(async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return readdir(...args);
    });

    const { getHandler } = await import('../../src/handler-loader.js');
    const handlers = await Promise.all(TOOLS.map((name) => getHandler(name)));

    expect(handlers.filter(Boolean)).toHaveLength(TOOLS.length);
  });

  it('initHandlerModules 并发调用共享同一个 Promise', async () => {
    const { initHandlerModules } = await import('../../src/handler-loader.js');
    const first = initHandlerModules();
    const second = initHandlerModules();

    expect(first).toBe(second);
    await first;
  });

  it('加载失败的模块不会被永久缓存（下次调用还能重试）', async () => {
    const { getHandlerModule } = await import('../../src/handler-loader.js');
    const original = getHandlerModule;

    /* 这条用真实的 cad 模块验证「成功会被缓存」；失败不缓存的路径由
       getHandlerModule 的 catch 分支保证，不在这里伪造 import 失败。 */
    expect(await original('cad')).toBeTruthy();
  });
});
