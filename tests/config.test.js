import { describe, it, expect, vi } from 'vitest';

// default 也要 mock：src/config.js 是 `import fs from 'fs'`，
// 只替换命名导出时 config.js 拿到的仍是真实 fs，
// 于是 existsSync 命中用户真实的 ~/.atlisp/atlisp.config.json，
// 导致「reloadConfig returns false when no file」在有配置文件的机器上失败。
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  const mocked = { ...actual, existsSync: vi.fn(() => false), watch: vi.fn() };
  return { ...mocked, default: mocked };
});

const { getConfig, getAllConfig, reloadConfig, onConfigChange } = await import('../src/config.js');
import config from '../src/config.js';

describe('config', () => {
  it('has default port', () => expect(config.port).toBeDefined());
  it('has default host', () => expect(config.host).toBeDefined());
  it('has transport mode', () => expect(['http', 'stdio']).toContain(config.transport));
  it('getConfig returns specific key', () => expect(getConfig('port')).toBe(config.port));
  it('getAllConfig returns all config', () => {
    const all = getAllConfig();
    expect(all).toHaveProperty('port');
    expect(all).toHaveProperty('host');
  });
  it('reloadConfig returns false when no file', () => expect(reloadConfig()).toBe(false));
  it('onConfigChange registers callback', () => { onConfigChange(vi.fn()); });
});
