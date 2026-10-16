// toolProfile 三层配置优先级：CLI --tool-profile > 配置文件 toolProfile > 环境变量 TOOL_PROFILE > 默认 full
// 复用 tests/config-precedence.test.js 的真实临时配置文件模式（不 mock readFileSync）。
import { describe, it, expect, vi, afterAll } from 'vitest';
import realFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  const mocked = { ...actual, watch: vi.fn() };
  return { ...mocked, default: mocked };
});

const tmpDir = realFs.mkdtempSync(path.join(os.tmpdir(), 'atlisp-toolprofile-'));
const minimalFilePath = path.join(tmpDir, 'minimal.config.json');
const emptyConfigPath = path.join(tmpDir, 'empty.config.json');
realFs.writeFileSync(minimalFilePath, JSON.stringify({ toolProfile: 'minimal' }), 'utf-8');
realFs.writeFileSync(emptyConfigPath, JSON.stringify({}), 'utf-8');

const ENV_KEYS = ['TOOL_PROFILE', 'CONFIG_FILE'];

afterAll(() => {
  try { realFs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* 清理失败不影响测试结论 */ }
});

async function loadConfig({ argv = [], env = {}, configFile = emptyConfigPath } = {}) {
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

describe('toolProfile 配置优先级：CLI > 配置文件 > 环境变量 > 默认 full', () => {
  it('三层都没有时默认 full（现有行为不变）', async () => {
    const c = await loadConfig();
    expect(c.toolProfile).toBe('full');
  });

  it('环境变量 TOOL_PROFILE 单独生效', async () => {
    const c = await loadConfig({ env: { TOOL_PROFILE: 'standard' } });
    expect(c.toolProfile).toBe('standard');
  });

  it('配置文件 toolProfile 压过环境变量', async () => {
    const c = await loadConfig({
      configFile: minimalFilePath,
      env: { TOOL_PROFILE: 'standard' },
    });
    expect(c.toolProfile).toBe('minimal');
  });

  it('--tool-profile 压过配置文件与环境变量', async () => {
    const c = await loadConfig({
      argv: ['--tool-profile', 'standard'],
      configFile: minimalFilePath,
      env: { TOOL_PROFILE: 'full' },
    });
    expect(c.toolProfile).toBe('standard');
  });

  it('只给环境变量 + 空配置文件时用环境变量', async () => {
    const c = await loadConfig({ env: { TOOL_PROFILE: 'minimal' } });
    expect(c.toolProfile).toBe('minimal');
  });
});
