import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendCommandWithResult = vi.fn();
const mockSendCommand = vi.fn();
const mockConnect = vi.fn();
const mockCad = { connected: false, connect: mockConnect, sendCommandWithResult: mockSendCommandWithResult, sendCommand: mockSendCommand };

vi.mock('../src/cad.js', () => ({ cad: mockCad }));
vi.mock('../src/logger.js', () => ({ log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), closeLog: vi.fn() }));

const { createSheetSet, openSheetSet, listSheetSets, addSheet, listSheets, deleteSheet, publishSheetSet, getSheetSetProperty, createSheetSetArchive } = await import('../src/handlers/sheetset-handlers.js');

describe('sheetset-handlers', () => {
  beforeEach(() => { vi.clearAllMocks(); mockCad.connected = false; });

  const testJsonHandler = (fn, args, expectedKey) => {
    it(`${fn.name} returns JSON with ${expectedKey}`, async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('ok');
      const result = await fn(...args);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty(expectedKey);
    });
  };

  testJsonHandler(createSheetSet, ['MySet', 'desc'], 'name');
  testJsonHandler(openSheetSet, ['C:/test.dst'], 'filePath');
  testJsonHandler(addSheet, ['MySet', 'Sheet1', 'Model'], 'sheetSetName');
  testJsonHandler(deleteSheet, ['MySet', 'Sheet1'], 'sheetSetName');
  testJsonHandler(publishSheetSet, ['MySet', 'C:/out', 'PDF'], 'sheetSetName');
  testJsonHandler(getSheetSetProperty, ['MySet', 'Description'], 'sheetSetName');
  testJsonHandler(createSheetSetArchive, ['MySet', 'C:/arc.zip'], 'sheetSetName');

  describe('list functions', () => {
    it('listSheetSets', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('("A" "B")');
      const result = await listSheetSets();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('sheetSets');
    });

    it('listSheets', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('("S1" "S2")');
      const result = await listSheets('MySet');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('sheets');
    });
  });

  describe('not connected', () => {
    it('returns error', async () => {
      mockConnect.mockResolvedValue(false);
      expect((await createSheetSet('S')).isError).toBe(true);
      expect((await openSheetSet('C:/f.dst')).isError).toBe(true);
    });
  });
});
