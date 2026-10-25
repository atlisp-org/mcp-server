import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendCommandWithResult = vi.fn();
const mockSendCommand = vi.fn();
const mockConnect = vi.fn();
const mockCad = { connected: false, connect: mockConnect, sendCommandWithResult: mockSendCommandWithResult, sendCommand: mockSendCommand };

vi.mock('../src/cad.js', () => ({ cad: mockCad, resolveCadConnection: () => mockCad }));
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
    it('用包管理器 API 安装，并等到包真的出现在本地列表里', async () => {
      mockCad.connected = true;
      /* 第一次查询：还没装；安装后轮询：出现。 */
      mockSendCommandWithResult
        .mockResolvedValueOnce('((:NAME . base))')
        .mockResolvedValue('((:NAME . test2021) (:NAME . base))');

      const result = await installPackage('test2021');

      expect(result.content[0].text).toContain('已安装');
      const sent = mockSendCommand.mock.calls.map((c) => String(c[0])).join('\n');
      /* 包安装是 @::package-install；@::load-module 是内核模块加载器，
         对包名只会返回 T（旧实现的 bug）。 */
      expect(sent).toContain('@::package-install "test2021"');
      expect(sent).toContain('@::load-pkg "test2021"');
    });

    it('超时如实报错，不假装安装成功', async () => {
      process.env.PACKAGE_INSTALL_WAIT_MS = '50';
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('((:NAME . base))');

      const result = await installPackage('test2021');

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('超时');
      delete process.env.PACKAGE_INSTALL_WAIT_MS;
    });

    it('不存在的包直接拒绝', async () => {
      mockCad.connected = true;
      const result = await installPackage('no-such-pkg-xyz');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('不存在');
    });
  });
});
