import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendCommandWithResult = vi.fn();
const mockSendCommand = vi.fn();
const mockConnect = vi.fn();
const mockCad = { connected: false, connect: mockConnect, sendCommandWithResult: mockSendCommandWithResult, sendCommand: mockSendCommand };

vi.mock('../src/cad.js', () => ({ cad: mockCad }));
vi.mock('../src/logger.js', () => ({ log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), closeLog: vi.fn() }));

const { listPackages, searchPackages, installPackage } = await import('../src/handlers/package-handlers.js');

describe('package-handlers', () => {
  beforeEach(() => { vi.clearAllMocks(); mockCad.connected = false; });

  describe('listPackages', () => {
    it('works without CAD connected (uses registry)', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await listPackages();
      expect(result.content[0].text).toBeDefined();
    });

    it('lists packages from CAD result', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('("pkg1" "pkg2")');
      const result = await listPackages();
      expect(result.content[0].text).toContain('pkg1');
    });
  });

  describe('searchPackages', () => {
    it('returns search results', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('("result")');
      const result = await searchPackages('test');
      expect(result.content[0].text).toContain('搜索');
    });
  });

  describe('installPackage', () => {
    it('sends install command for known package', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"INSTALLED"');
      const result = await installPackage('test2021');
      expect(result.content[0].text).toContain('已发送');
    });
  });
});
