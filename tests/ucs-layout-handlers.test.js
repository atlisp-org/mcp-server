import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendCommandWithResult = vi.fn();
const mockSendCommand = vi.fn();
const mockConnect = vi.fn();
const mockCad = { connected: false, connect: mockConnect, sendCommandWithResult: mockSendCommandWithResult, sendCommand: mockSendCommand };

vi.mock('../src/cad.js', () => ({ cad: mockCad }));
vi.mock('../src/logger.js', () => ({ log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), closeLog: vi.fn() }));

const {
  createUcs, setUcs, listUcs, deleteUcs, getCurrentUcs,
  createLayout, setLayout, listLayouts, deleteLayout, getCurrentLayout, renameLayout,
} = await import('../src/handlers/ucs-layout-handlers.js');

describe('ucs-layout-handlers', () => {
  beforeEach(() => { vi.clearAllMocks(); mockCad.connected = false; });

  describe('UCS operations', () => {
    it('createUcs returns error when not connected', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await createUcs('MyUCS');
      expect(result.isError).toBe(true);
    });

    it('createUcs with origin', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"CREATED"');
      const result = await createUcs('MyUCS', '10,20,0', '1,0,0', '0,1,0');
      expect(result.content[0].text).toContain('已创建');
    });

    it('createUcs with defaults', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"CREATED"');
      const result = await createUcs('MyUCS');
      expect(result.content[0].text).toContain('已创建');
    });

    it('setUcs', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"SET"');
      const result = await setUcs('World');
      expect(result.content[0].text).toContain('已切换');
    });

    it('listUcs returns UCS list', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('("World" "MyUCS")');
      const result = await listUcs();
      expect(result.content[0].text).toContain('World');
    });

    it('deleteUcs', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"DELETED"');
      const result = await deleteUcs('MyUCS');
      expect(result.content[0].text).toContain('已删除');
    });

    it('getCurrentUcs returns current', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"World"');
      const result = await getCurrentUcs();
      expect(result.content[0].text).toBe('"World"');
    });
  });

  describe('Layout operations', () => {
    it('createLayout', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"CREATED"');
      const result = await createLayout('Layout1');
      expect(result.content[0].text).toContain('已创建');
    });

    it('setLayout', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"SET"');
      const result = await setLayout('Layout1');
      expect(result.content[0].text).toContain('已切换');
    });

    it('listLayouts returns layouts', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('("Model" "Layout1")');
      const result = await listLayouts();
      expect(result.content[0].text).toContain('Model');
    });

    it('deleteLayout', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"DELETED"');
      const result = await deleteLayout('Layout1');
      expect(result.content[0].text).toContain('已删除');
    });

    it('getCurrentLayout', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"Model"');
      const result = await getCurrentLayout();
      expect(result.content[0].text).toBe('"Model"');
    });

    it('renameLayout', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"RENAMED"');
      const result = await renameLayout('Old', 'New');
      expect(result.content[0].text).toBe('已将布局 Old 重命名为 New');
    });
  });
});
