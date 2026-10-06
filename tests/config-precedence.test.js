// 固化配置优先级契约：CLI 参数 > 配置文件 > 环境变量 > 默认值
// 回归背景：cliArgs 曾排在 fileConfig 之后，配置文件一旦写了 port/host/
// transport/lintPreset 等键，命令行传值被静默忽略（--port 传了不起作用）。
//
// 用真实临时配置文件 + CONFIG_FILE 指向它，不 mock fs 读路径——
// 之前 mock readFileSync 时 config.js 实际拿到的是真实 fs，测试等于没生效。
import { describe, it, expect, vi, afterAll } from 'vitest';
import realFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 注意：必须同时提供 default。src/config.js 用的是 `import fs from 'fs'`，
// 只 mock 命名导出的话 default 仍是真实 fs —— watch 会真的监听文件、
// existsSync 也会读到用户真实的 ~/.atlisp/atlisp.config.json。
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  const mocked = { ...actual, watch: vi.fn() };
  return { ...mocked, default: mocked };
});

const FILE_CONFIG = {
  port: 3000,
  host: '10.0.0.1',
  transport: 'ws',
  lintPreset: 'strict',
  lintLevel: 'error',
  securityLevel: 'strict',
  noLint: true,
  sslKey: '/from/file.key',
  sslCert: '/from/file.crt',
};

const tmpDir = realFs.mkdtempSync(path.join(os.tmpdir(), 'atlisp-config-prec-'));
const realConfigPath = path.join(tmpDir, 'atlisp.config.json');
const emptyConfigPath = path.join(tmpDir, 'empty.config.json');
realFs.writeFileSync(realConfigPath, JSON.stringify(FILE_CONFIG), 'utf-8');
realFs.writeFileSync(emptyConfigPath, JSON.stringify({}), 'utf-8');

const ENV_KEYS = ['PORT', 'HOST', 'TRANSPORT', 'LINT_PRESET', 'LINT_LEVEL',
  'SECURITY_LEVEL', 'NO_LINT', 'SSL_KEY_PATH', 'SSL_CERT_PATH', 'CONFIG_FILE'];

afterAll(() => {
  try { realFs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* 清理失败不影响测试结论 */ }
});

async function loadConfig({ argv = [], env = {}, configFile = realConfigPath } = {}) {
  vi.resetModules();
  const savedArgv = process.argv;
  const savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.CONFIG_FILE = configFile;
  Object.assign(process.env, env);
  process.argv = ['node', 'atlisp-mcp', ...argv];
  try {
    const mod = await import('../src/config.js');
    return { ...mod.default };
  } finally {
    process.argv = savedArgv;
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('配置优先级：CLI 参数 > 配置文件 > 环境变量', () => {

  it('无 CLI、无环境变量时用配置文件的值', async () => {
    const c = await loadConfig();
    expect(c.port).toBe(3000);
    expect(c.host).toBe('10.0.0.1');
    expect(c.transport).toBe('ws');
    expect(c.lintPreset).toBe('strict');
    expect(c.securityLevel).toBe('strict');
  });

  it('--port 覆盖配置文件（回归：曾被静默忽略）', async () => {
    const c = await loadConfig({ argv: ['--port', '8199'] });
    expect(c.port).toBe(8199);
  });

  it('--host / --transport / --stdio 覆盖配置文件', async () => {
    const c = await loadConfig({ argv: ['--host', '127.0.0.1', '--transport', 'http'] });
    expect(c.host).toBe('127.0.0.1');
    expect(c.transport).toBe('http');

    const stdio = await loadConfig({ argv: ['--stdio'] });
    expect(stdio.transport).toBe('stdio');
  });

  it('--lint-preset / --lint-level / --no-lint / --security-level 覆盖配置文件', async () => {
    const c = await loadConfig({
      argv: ['--lint-preset', 'relaxed', '--lint-level', 'warn', '--security-level', 'standard'],
    });
    expect(c.lintPreset).toBe('relaxed');
    expect(c.lintLevel).toBe('warn');
    expect(c.securityLevel).toBe('standard');

    const off = await loadConfig({ argv: ['--no-lint'] });
    expect(off.noLint).toBe(true);
  });

  it('--ssl-key / --ssl-cert 覆盖配置文件', async () => {
    const c = await loadConfig({ argv: ['--ssl-key', '/from/cli.key', '--ssl-cert', '/from/cli.crt'] });
    expect(c.sslKey).toBe('/from/cli.key');
    expect(c.sslCert).toBe('/from/cli.crt');
  });

  it('CLI 参数同时压过环境变量与配置文件', async () => {
    const c = await loadConfig({
      argv: ['--port', '7777', '--host', '192.168.1.1'],
      env: { PORT: '9000', HOST: '172.16.0.1' },
    });
    expect(c.port).toBe(7777);
    expect(c.host).toBe('192.168.1.1');
  });

  it('当前契约：环境变量仍低于配置文件（PORT 有 .default()，无法区分未设置）', async () => {
    // 这条断言锁定现状而非理想行为。若将来要让 env 高于 file，
    // 必须先去掉 envSchema 里 PORT/HOST/TRANSPORT 的 .default()，
    // 否则 env.PORT 恒为 8110 会永久盖掉配置文件。
    const c = await loadConfig({ env: { PORT: '9000' } });
    expect(c.port).toBe(3000);
  });

  it('配置文件为空时回落到环境变量', async () => {
    const c = await loadConfig({ configFile: emptyConfigPath, env: { PORT: '9000', HOST: '10.1.1.1' } });
    expect(c.port).toBe(9000);
    expect(c.host).toBe('10.1.1.1');
  });

  it('配置文件不存在时回落到环境变量', async () => {
    const c = await loadConfig({ configFile: path.join(tmpDir, 'missing.json'), env: { PORT: '9000' } });
    expect(c.port).toBe(9000);
  });

  it('两者都没有时用内置默认值', async () => {
    const c = await loadConfig({ configFile: path.join(tmpDir, 'missing.json') });
    expect(c.port).toBe(8110);
    expect(c.host).toBe('0.0.0.0');
    expect(c.transport).toBe('http');
    expect(c.securityLevel).toBe('relaxed');
  });
});
