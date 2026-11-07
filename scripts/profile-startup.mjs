#!/usr/bin/env node
// 逐模块测量冷启动 import 耗时。
//
// 为什么要为每个模块单独起一个 node 进程：ESM 有模块缓存，在同一个进程里
// 顺序 import 时后面模块的耗时会被前面已经加载的依赖掩盖，量不出真实成本。
//
// 用法：npm run profile:startup [-- --top 15]
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MODULES = [
  'config.js',
  'constants.js',
  'logger.js',
  'tools/index.js',
  'cad.js',
  'mcp-tools.js',
  'mcp-handlers.js',
  'mcp-server-state.js',
  'handler-utils.js',
  'routes.js',
  'streamable-http.js',
  'websocket-transport.js',
  'relay-client.js',
  'peer-manager.js',
  'plugin-loader.js',
  'lint-analyzer.js',
  'sampling.js',
  'task-engine.js',
];

const topArg = process.argv.indexOf('--top');
const top = topArg >= 0 ? Number(process.argv[topArg + 1]) || MODULES.length : MODULES.length;

const samples = [];
for (const mod of MODULES) {
  const code = `
    const t = process.hrtime.bigint();
    import(${JSON.stringify(`./src/${mod}`)})
      .then(() => { process.stdout.write(String(Number(process.hrtime.bigint() - t) / 1e6)); process.exit(0); })
      .catch((e) => { process.stderr.write(e.message); process.exit(1); });
  `;
  try {
    const out = execFileSync(process.execPath, ['-e', code], {
      cwd: root,
      env: { ...process.env, VITEST: '1', NODE_ENV: 'test' },
      encoding: 'utf8',
      timeout: 60000,
    });
    samples.push({ mod, ms: Number(out) || 0 });
  } catch (e) {
    samples.push({ mod, ms: NaN, error: e.stderr || e.message });
  }
}

samples.sort((a, b) => (b.ms || 0) - (a.ms || 0));
console.log('模块冷启动 import 耗时（每次独立进程）');
console.log('------------------------------------------------');
for (const { mod, ms, error } of samples.slice(0, top)) {
  const value = Number.isFinite(ms) ? `${ms.toFixed(0).padStart(5)} ms` : '  ERR ';
  console.log(`${value}  src/${mod}${error ? `  (${error.trim().split('\n')[0]})` : ''}`);
}
console.log('------------------------------------------------');
console.log('提示：单模块耗时包含其全部依赖；比较时看同一依赖链上的增量。');
