import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendCommandWithResult = vi.fn();
const mockSendCommand = vi.fn();
const mockConnect = vi.fn();
const mockCad = { connected: false, connect: mockConnect, sendCommandWithResult: mockSendCommandWithResult, sendCommand: mockSendCommand };

vi.mock('../src/cad.js', () => ({ cad: mockCad, resolveCadConnection: () => mockCad }));
vi.mock('../src/logger.js', () => ({ log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), closeLog: vi.fn() }));

const { plotToPdf, plotToPrinter, createGroup, deleteGroup, listGroups, getGroupEntities, measureDistance, measureArea, getEntityInfo } = await import('../src/handlers/query-print-handlers.js');

describe('query-print-handlers', () => {
  beforeEach(() => { vi.clearAllMocks(); mockCad.connected = false; });

  describe('plotToPdf', () => {
    it('returns error when not connected', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await plotToPdf('C:/out.pdf');
      expect(result.isError).toBe(true);
    });

    it('works with layout and paperSize', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"EXPORTED"');
      const result = await plotToPdf('C:/out.pdf', 'Layout1', { paperSize: 'A3', plotScale: '1:1', orientation: 'Landscape' });
      expect(result.content[0].text).toContain('已打印');
    });

    it('falls back to default paperSize', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"EXPORTED"');
      const result = await plotToPdf('C:/out.pdf');
      expect(result.content[0].text).toContain('已打印');
    });
  });

  describe('plotToPrinter', () => {
    it('works', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('PRINTED');
      const result = await plotToPrinter('PDF Printer', 'Layout1');
      expect(result.content[0].text).toBe('已发送到打印机');
    });
  });

  describe('group operations', () => {
    it('createGroup', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"CREATED"');
      const result = await createGroup('G1', ['1F', '2A']);
      expect(result.content[0].text).toContain('已创建');
    });

    it('deleteGroup', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"DELETED"');
      const result = await deleteGroup('G1');
      expect(result.content[0].text).toContain('已删除');
    });

    it('listGroups', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('("G1" "G2")');
      const result = await listGroups();
      expect(result.content[0].text).toContain('G1');
    });

    it('getGroupEntities', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('("1F" "2A")');
      const result = await getGroupEntities('G1');
      expect(result.content[0].text).toContain('1F');
    });
  });

  describe('measure', () => {
    it('measureDistance', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('100.0');
      const result = await measureDistance('0,0', '100,0');
      expect(result.content[0].text).toContain('100');
    });

    it('measureArea', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('10000.0');
      const result = await measureArea('0,0 100,0 100,100 0,100');
      expect(result.content[0].text).toContain('10000');
    });
  });

  describe('getEntityInfo', () => {
    it('returns entity info', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('(("type" "LINE") ("layer" "0"))');
      const result = await getEntityInfo('1F');
      expect(result.content[0].text).toContain('LINE');
    });

    it('handles nil result', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('nil');
      const result = await getEntityInfo('999');
      expect(result.isError).toBe(true);
    });
  });
});
