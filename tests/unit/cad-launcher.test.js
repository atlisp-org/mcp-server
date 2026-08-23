import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  execFile: vi.fn(),
  execSync: vi.fn(() => { throw new Error('reg not available'); }),
}));

const importLauncher = () => import('../../src/cad-launcher.js');

describe('cad-launcher', () => {
  let launcher;

  beforeEach(async () => {
    vi.resetModules();
    launcher = await importLauncher();
  });

  it('非 Windows 平台返回空列表', () => {
    expect(launcher.detectInstalledPlatforms()).toEqual([]);
  });

  it('clearDetectCache 重置后可重新检测', async () => {
    launcher.detectInstalledPlatforms();
    expect(() => launcher.clearDetectCache()).not.toThrow();
    expect(launcher.detectInstalledPlatforms()).toEqual([]);
  });

  it('ensureCadInstance 无可用平台时返回 false', async () => {
    const result = await launcher.ensureCadInstance({});
    expect(result).toBe(false);
  });

  it('preferredPlatforms 为空优先级列表时返回 false', async () => {
    // detectInstalledPlatforms 在 linux 上为空 → 直接 false
    const result = await launcher.ensureCadInstance({ preferredPlatforms: ['AutoCAD'] });
    expect(result).toBe(false);
  });
});
