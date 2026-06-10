import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendCommandWithResult = vi.fn();
const mockConnect = vi.fn();

const mockCad = {
  connected: false,
  connect: mockConnect,
  sendCommandWithResult: mockSendCommandWithResult,
};

vi.mock('../src/cad.js', () => ({
  cad: mockCad,
}));

vi.mock('../src/logger.js', () => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  closeLog: vi.fn(),
}));

const {
  createLayer,
  deleteLayer,
  setLayerProperty,
  setCurrentLayer,
} = await import('../src/handlers/layer-handlers.js');

describe('layer-handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCad.connected = false;
  });

  describe('createLayer', () => {
    it('returns error when CAD not connected', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await createLayer('MyLayer');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('未连接');
    });

    it('creates layer successfully', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"CREATED"');
      const result = await createLayer('MyLayer');
      expect(result.content[0].text).toContain('已创建');
    });

    it('returns message when layer exists', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"EXISTS"');
      const result = await createLayer('MyLayer');
      expect(result.content[0].text).toContain('已存在');
    });

    it('creates layer with custom color', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"CREATED"');
      const result = await createLayer('MyLayer', '3', 'Continuous');
      expect(mockSendCommandWithResult).toHaveBeenCalled();
    });
  });

  describe('deleteLayer', () => {
    it('returns error when CAD not connected', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await deleteLayer('MyLayer');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('未连接');
    });

    it('deletes layer successfully', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"DELETED"');
      const result = await deleteLayer('MyLayer');
      expect(result.content[0].text).toContain('已删除');
    });

    it('returns error when deleting current layer', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"CURRENT"');
      const result = await deleteLayer('0');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('无法删除');
    });

    it('returns error when layer not found', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"NOTFOUND"');
      const result = await deleteLayer('NonExistent');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('不存在');
    });
  });

  describe('setLayerProperty', () => {
    it('returns error when CAD not connected', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await setLayerProperty('MyLayer', 'color', '3');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('未连接');
    });

    it('sets color property', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await setLayerProperty('MyLayer', 'color', '3');
      expect(result.content[0].text).toContain('已设置');
    });

    it('sets linetype property', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await setLayerProperty('MyLayer', 'linetype', 'DASHED');
      expect(result.content[0].text).toContain('已设置');
    });

    it('freezes layer', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await setLayerProperty('MyLayer', 'freeze', '');
      expect(result.content[0].text).toContain('已设置');
    });

    it('thaws layer', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await setLayerProperty('MyLayer', 'thaw', '');
      expect(result.content[0].text).toContain('已设置');
    });

    it('locks layer', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await setLayerProperty('MyLayer', 'lock', '');
      expect(result.content[0].text).toContain('已设置');
    });

    it('unlocks layer', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await setLayerProperty('MyLayer', 'unlock', '');
      expect(result.content[0].text).toContain('已设置');
    });

    it('returns error for unsupported property', async () => {
      mockCad.connected = true;
      const result = await setLayerProperty('MyLayer', 'unknown', 'value');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('不支持');
    });

    it('returns error when layer not found', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"NOTFOUND"');
      const result = await setLayerProperty('NonExistent', 'color', '3');
      expect(result.isError).toBe(true);
    });
  });

  describe('setCurrentLayer', () => {
    it('returns error when CAD not connected', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await setCurrentLayer('MyLayer');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('未连接');
    });

    it('sets current layer successfully', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await setCurrentLayer('MyLayer');
      expect(result.content[0].text).toContain('已设置');
    });

    it('returns error when layer not found', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"NOTFOUND"');
      const result = await setCurrentLayer('NonExistent');
      expect(result.isError).toBe(true);
    });
  });
});