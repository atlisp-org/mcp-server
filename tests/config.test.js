import { describe, it, expect, vi } from 'vitest';

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return { ...actual, existsSync: vi.fn(() => false), watch: vi.fn() };
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
