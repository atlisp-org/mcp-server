import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendCommandWithResult = vi.fn();
const mockSendCommand = vi.fn();
const mockConnect = vi.fn();
const mockCad = { connected: false, connect: mockConnect, sendCommandWithResult: mockSendCommandWithResult, sendCommand: mockSendCommand };

vi.mock('../src/cad.js', () => ({ cad: mockCad, resolveCadConnection: () => mockCad }));
vi.mock('../src/logger.js', () => ({ log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), closeLog: vi.fn() }));

const { attachPdf, listAttachedPdfs, reloadPdf, detachPdf, getPdfInfo, createDgnUnderlay, createDwfUnderlay, importDxf, importDgn, exportDgn, createHyperlink, removeHyperlink, batchAttachPdfs, savePdfLayout } = await import('../src/handlers/pdf-annotation-handlers.js');

describe('pdf-annotation-handlers', () => {
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

  testJsonHandler(attachPdf, ['0,0', 'C:/test.pdf', 1, 0], 'pdfPath');
  testJsonHandler(listAttachedPdfs, [], 'handles');
  testJsonHandler(reloadPdf, ['1F'], 'handle');
  testJsonHandler(detachPdf, ['1F'], 'handle');
  testJsonHandler(getPdfInfo, ['1F'], 'handle');
  testJsonHandler(createDgnUnderlay, ['C:/test.dgn', '0,0', 1], 'dgnPath');
  testJsonHandler(createDwfUnderlay, ['C:/test.dwf', '0,0', 1], 'dwfPath');
  testJsonHandler(importDxf, ['C:/test.dxf', false], 'dxfPath');
  testJsonHandler(importDgn, ['C:/test.dgn'], 'sourceFile');
  testJsonHandler(exportDgn, ['C:/out.dgn'], 'filePath');
  testJsonHandler(createHyperlink, ['1F', 'http://example.com', 'desc'], 'handle');
  testJsonHandler(removeHyperlink, ['1F'], 'handle');
  it('batchAttachPdfs returns array', async () => {
    mockCad.connected = true;
    mockSendCommandWithResult.mockResolvedValue('ok');
    const result = await batchAttachPdfs(['C:/a.pdf', 'C:/b.pdf'], '0,0', 10, 'x');
    const parsed = JSON.parse(result.content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
  });
  testJsonHandler(savePdfLayout, ['Layout1', 'C:/out.pdf'], 'layoutName');

  describe('not connected', () => {
    it('returns error', async () => {
      mockConnect.mockResolvedValue(false);
      expect((await attachPdf('0,0', 't.pdf')).isError).toBe(true);
    });
  });
});
