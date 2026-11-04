// 回归守卫：cad-rot-helper 曾把 `import edge from 'edge-js'` 写在模块顶层，
// 而 edge-js 只有 Windows/macOS 的原生模块，Linux 上 require 直接 throw。
// 该模块经 cad-pool → mcp-tools 被主进程静态引入，于是整个服务器在 Linux 容器里
// 启动即崩溃（Docker e2e 卡在 initialize 上不返回）。
import { describe, it, expect } from 'vitest';

describe('cad-rot-helper', () => {
  it('导入模块不依赖 edge-js 原生模块', async () => {
    const mod = await import('../../src/cad-rot-helper.js');
    expect(typeof mod.discoverCadInstances).toBe('function');
  });

  it('非 Windows 平台直接返回空列表', async () => {
    const { discoverCadInstances } = await import('../../src/cad-rot-helper.js');
    if (process.platform === 'win32') return; // Windows 上会真的尝试 ROT 枚举
    await expect(discoverCadInstances()).resolves.toEqual([]);
  });
});
