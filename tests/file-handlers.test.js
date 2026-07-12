import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendCommandWithResult = vi.fn();
const mockSendCommand = vi.fn();
const mockConnect = vi.fn();

const mockCad = {
  connected: false,
  connect: mockConnect,
  sendCommandWithResult: mockSendCommandWithResult,
  sendCommand: mockSendCommand,
};

vi.mock('../src/cad.js', () => ({
  cad: mockCad,
  resolveCadConnection: () => mockCad,
}));

vi.mock('../src/logger.js', () => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  closeLog: vi.fn(),
}));

const {
  openDwg,
  saveDwg,
  exportPdf,
  closeDwg,
} = await import('../src/handlers/file-handlers.js');

describe('file-handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCad.connected = false;
  });

  describe('openDwg', () => {
    it('returns error when CAD not connected', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await openDwg('C:\\test.dwg');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('未连接');
    });

    it('opens file successfully', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OPENED"');
      const result = await openDwg('C:\\Projects\\test.dwg');
      expect(result.content[0].text).toContain('已打开');
    });

    it('returns error when file not found', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"NOTFOUND"');
      const result = await openDwg('C:\\nonexistent.dwg');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('不存在');
    });

    it('returns error for invalid path', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"INVALIDPATH"');
      const result = await openDwg('Z:\\invalid\\path.dwg');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('路径无效');
    });
  });

  describe('saveDwg', () => {
    it('returns error when CAD not connected', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await saveDwg();
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('未连接');
    });

    it('saves current file', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"SAVED"');
      const result = await saveDwg();
      expect(result.content[0].text).toContain('已保存');
    });

    it('saves as new file', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"SAVED"');
      const result = await saveDwg('C:\\Projects\\new.dwg');
      expect(result.content[0].text).toContain('已保存为');
    });

    it('handles save failure', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"FAILED"');
      const result = await saveDwg();
      expect(result.isError).toBe(true);
    });
  });

  describe('exportPdf', () => {
    it('returns error when CAD not connected', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await exportPdf('C:\\output.pdf');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('未连接');
    });

    it('exports to PDF successfully', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"EXPORTED"');
      const result = await exportPdf('C:\\output.pdf');
      expect(result.content[0].text).toContain('已导出');
    });

    it('exports to specific layout', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"EXPORTED"');
      const result = await exportPdf('C:\\output.pdf', 'Layout1');
      expect(mockSendCommandWithResult).toHaveBeenCalled();
    });

    it('handles export failure', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"FAILED"');
      const result = await exportPdf('C:\\output.pdf');
      expect(result.isError).toBe(true);
    });
  });

  describe('closeDwg', () => {
    it('returns error when CAD not connected', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await closeDwg();
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('未连接');
    });

    it('closes without saving', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"CLOSED"');
      const result = await closeDwg(false);
      expect(result.content[0].text).toContain('已关闭');
    });

    it('closes with saving', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"CLOSED"');
      const result = await closeDwg(true);
      expect(mockSendCommandWithResult).toHaveBeenCalled();
    });
  });
});