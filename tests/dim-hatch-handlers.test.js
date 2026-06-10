import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendCommandWithResult = vi.fn();
const mockSendCommand = vi.fn();
const mockConnect = vi.fn();
const mockCad = { connected: false, connect: mockConnect, sendCommandWithResult: mockSendCommandWithResult, sendCommand: mockSendCommand };

vi.mock('../src/cad.js', () => ({ cad: mockCad }));
vi.mock('../src/logger.js', () => ({ log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), closeLog: vi.fn() }));

const {
  createDimension, getDimensionValue, createHatch, setHatchProperties,
  getBlockAttributes, setBlockAttribute, zoomToExtents, zoomToWindow,
  createNamedView, restoreNamedView, listNamedViews, exportDxf, exportDwf, batchSetLayer,
} = await import('../src/handlers/dim-hatch-handlers.js');

describe('dim-hatch-handlers', () => {
  beforeEach(() => { vi.clearAllMocks(); mockCad.connected = false; });

  describe('createDimension', () => {
    it('returns error when CAD not connected', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await createDimension('LINEAR', {});
      expect(result.isError).toBe(true);
    });

    it('returns error for unsupported type', async () => {
      mockCad.connected = true;
      const result = await createDimension('INVALID', {});
      expect(result.isError).toBe(true);
    });

    it('creates ALIGNED dimension', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"CREATED"');
      const result = await createDimension('ALIGNED', { pt1: '0,0', pt2: '100,0' });
      expect(result.content[0].text).toContain('已创建');
    });
  });

  describe('getDimensionValue', () => {
    it('returns dimension value', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('100.0');
      const result = await getDimensionValue('1F');
      expect(result.content[0].text).toBe('100.0');
    });
  });

  describe('createHatch', () => {
    it('creates hatch', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"CREATED"');
      const result = await createHatch('ANSI31');
      expect(result.content[0].text).toContain('已创建');
    });
  });

  describe('setHatchProperties', () => {
    it('sets pattern property', async () => {
      mockCad.connected = true;
      const result = await setHatchProperties('1F', { pattern: 'ANSI32', scale: '2', angle: '45', color: '3' });
      expect(result.content[0].text).toContain('已更新填充属性');
    });
  });

  describe('getBlockAttributes', () => {
    it('returns attributes', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('(("TAG1" "VAL1") ("TAG2" "VAL2"))');
      const result = await getBlockAttributes('1F');
      expect(result.content[0].text).toContain('TAG1');
    });
  });

  describe('setBlockAttribute', () => {
    it('sets attribute value', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"UPDATED"');
      const result = await setBlockAttribute('1F', 'TAG', 'VAL');
      expect(result.content[0].text).toContain('已设置');
    });
  });

  describe('zoom control', () => {
    it('zoomToExtents works', async () => {
      mockCad.connected = true;
      const result = await zoomToExtents();
      expect(result.content[0].text).toContain('已缩放');
    });

    it('zoomToWindow works', async () => {
      mockCad.connected = true;
      const result = await zoomToWindow('0,0', '100,100');
      expect(result.content[0].text).toContain('已缩放');
    });
  });

  describe('named views', () => {
    it('createNamedView works', async () => {
      mockCad.connected = true;
      const result = await createNamedView('MyView');
      expect(result.content[0].text).toContain('已创建');
    });

    it('restoreNamedView works', async () => {
      mockCad.connected = true;
      const result = await restoreNamedView('MyView');
      expect(result.content[0].text).toContain('已恢复');
    });

    it('listNamedViews returns views', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('("VIEW1" "VIEW2")');
      const result = await listNamedViews();
      expect(result.content[0].text).toContain('VIEW1');
    });
  });

  describe('export functions', () => {
    it('exportDxf works', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"EXPORTED"');
      const result = await exportDxf('C:/test.dxf');
      expect(result.content[0].text).toContain('已导出');
    });

    it('exportDwf works', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"EXPORTED"');
      const result = await exportDwf('C:/test.dwf');
      expect(result.content[0].text).toContain('已导出');
    });
  });

  describe('batchSetLayer', () => {
    it('sets layer for handles', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"Updated 2 entities"');
      const result = await batchSetLayer(['1F', '2A'], 'Layer1');
      expect(result.content[0].text).toContain('Updated');
    });

    it('returns error for empty handles', async () => {
      mockCad.connected = true;
      const result = await batchSetLayer([], 'Layer1');
      expect(result.isError).toBe(true);
    });
  });
});
