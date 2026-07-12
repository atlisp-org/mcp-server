import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendCommandWithResult = vi.fn();
const mockSendCommand = vi.fn();
const mockConnect = vi.fn();
const mockCad = { connected: false, connect: mockConnect, sendCommandWithResult: mockSendCommandWithResult, sendCommand: mockSendCommand };

vi.mock('../src/cad.js', () => ({ cad: mockCad, resolveCadConnection: () => mockCad }));
vi.mock('../src/logger.js', () => ({ log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), closeLog: vi.fn() }));

const { getXdata, setXdata, deleteXdata, listXdataApps, getAllEntityXdata, copyXdata, searchByXdata, exportXdataToFile, importXdataFromFile } = await import('../src/handlers/xdata-handlers.js');

describe('xdata-handlers', () => {
  beforeEach(() => { vi.clearAllMocks(); mockCad.connected = false; });

  describe('getXdata', () => {
    it('returns error when not connected', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await getXdata('1F', 'ACAD');
      expect(result.isError).toBe(true);
    });

    it('returns xdata JSON', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('(("key" "value"))');
      const result = await getXdata('1F', 'ACAD');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('handle', '1F');
    });

    it('handles nil result', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('nil');
      const result = await getXdata('1F');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.xdata).toBeNull();
    });
  });

  describe('setXdata', () => {
    it('sets xdata', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('ok');
      const result = await setXdata('1F', 'ACAD', '(1000 . "data")');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.set).toBe(true);
    });
  });

  describe('deleteXdata', () => {
    it('deletes xdata', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('deleted');
      const result = await deleteXdata('1F', 'ACAD');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.deleted).toBe(true);
    });
  });

  describe('listXdataApps', () => {
    it('returns apps', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('("ACAD" "MYAPP")');
      const result = await listXdataApps('1F');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.apps).toContain('"ACAD"');
    });
  });

  describe('getAllEntityXdata', () => {
    it('returns all xdata', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('(("ACAD" (1000 . "data")))');
      const result = await getAllEntityXdata('1F');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('handle', '1F');
    });
  });

  describe('copyXdata', () => {
    it('copies xdata', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('ok');
      const result = await copyXdata('1F', '2A', 'ACAD');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('handle');
    });
  });

  describe('searchByXdata', () => {
    it('searches by xdata', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('("1F" "2A")');
      const result = await searchByXdata('ACAD', 'key', 'value');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(0);
    });
  });

  describe('export/import', () => {
    it('exportXdataToFile returns result', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('("DATA")');
      const result = await exportXdataToFile('1F', 'C:/test.json');
      expect(result.content[0].text).toBeDefined();
    });
  });
});
