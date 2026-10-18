// 真实 Node ESM 环境下的插件加载回归测试。
// 背景：旧版 clearModuleCache() 引用了 ESM 中不存在的 `require`，
// 在 vitest（注入 require）里能过，但在 `node src/atlisp-mcp.js` 下会抛
// ReferenceError，被 loadPlugins 的 catch 吞掉 → 所有插件静默失效。
// 这里用子进程跑纯 Node ESM，确保插件真的能加载。
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const LOADER_URL = new URL('../../src/plugin-loader.js', import.meta.url).href;
const TEST_HOME = path.join(os.tmpdir(), `opencode-plugin-esm-${process.pid}`);

describe('plugin-loader 在纯 Node ESM 下可用', () => {
  it('子进程加载插件成功（无 require 依赖）', () => {
    const pluginDir = path.join(TEST_HOME, '.atlisp', 'mcp-plugins');
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginDir, 'esm-plugin.js'),
      `export default { name: 'esm-plugin', setup() {} };\n`,
      'utf-8'
    );

    const script = `
      const m = await import(${JSON.stringify(LOADER_URL)});
      const plugins = await m.loadPlugins();
      process.stdout.write(JSON.stringify(plugins.map(p => p.name)));
    `;

    try {
      const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
        env: { ...process.env, HOME: TEST_HOME, USERPROFILE: TEST_HOME },
        encoding: 'utf-8',
        timeout: 30000,
      });
      expect(JSON.parse(out.trim())).toEqual(['esm-plugin']);
    } finally {
      fs.rmSync(TEST_HOME, { recursive: true, force: true });
    }
  });
});
