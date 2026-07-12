import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendCommandWithResult = vi.fn();
const mockSendCommand = vi.fn();
const mockConnect = vi.fn();

const mockCad = { connected: false, connect: mockConnect, sendCommandWithResult: mockSendCommandWithResult, sendCommand: mockSendCommand };

vi.mock('../src/cad.js', () => ({ cad: mockCad, resolveCadConnection: () => mockCad }));
vi.mock('../src/logger.js', () => ({ log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), closeLog: vi.fn() }));

const {
  batchRename, batchMove, batchCopy, batchDelete, batchSetColor, batchExplode,
  batchMirror, batchOffset, batchRotate, batchScale, batchSetLinetype,
  batchMatchProperties, batchCreateGroup, batchAddToGroup,
} = await import('../src/handlers/batch-handlers.js');

describe('batch-handlers', () => {
  beforeEach(() => { vi.clearAllMocks(); mockCad.connected = false; });

  describe('batchRename', () => {
    it('returns error when not connected', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await batchRename(['1F'], 'New-{n}');
      expect(result.isError).toBe(true);
    });

    it('succeeds when connected', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await batchRename(['1F'], 'New-{n}');
      expect(result.content[0].text).toContain('success');
    });
  });

  describe('batchMove', () => {
    it('succeeds when connected', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await batchMove(['1F', '2A'], 'Layer0', 'Layer1');
      expect(result.content[0].text).toContain('success');
    });
  });

  describe('batchCopy', () => {
    it('succeeds when connected', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await batchCopy(['1F'], 100, 200);
      expect(result.content[0].text).toContain('success');
    });
  });

  describe('batchDelete', () => {
    it('succeeds when connected', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await batchDelete(['1F', '2A']);
      expect(result.content[0].text).toContain('success');
    });
  });

  describe('batchSetColor', () => {
    it('succeeds when connected', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await batchSetColor(['1F'], 3);
      expect(result.content[0].text).toContain('success');
    });
  });

  describe('batchExplode', () => {
    it('succeeds when connected', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await batchExplode(['1F', '2A']);
      expect(result.content[0].text).toContain('success');
    });
  });

  describe('batchMirror', () => {
    it('succeeds', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await batchMirror(['1F'], '0,0', '100,0', false);
      expect(result.content[0].text).toContain('success');
    });

    it('works with deleteOriginal', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await batchMirror(['1F'], '0,0', '100,0', true);
      expect(result.content[0].text).toContain('success');
    });
  });

  describe('batchOffset', () => {
    it('succeeds', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await batchOffset(['1F'], 50);
      expect(result.content[0].text).toContain('success');
    });

    it('works with both sides', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await batchOffset(['1F'], 50, 'both');
      expect(result.content[0].text).toContain('success');
    });
  });

  describe('batchRotate', () => {
    it('succeeds', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await batchRotate(['1F'], 45);
      expect(result.content[0].text).toContain('success');
    });
  });

  describe('batchScale', () => {
    it('succeeds', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await batchScale(['1F'], 2);
      expect(result.content[0].text).toContain('success');
    });
  });

  describe('batchSetLinetype', () => {
    it('succeeds', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await batchSetLinetype(['1F'], 'DASHED');
      expect(result.content[0].text).toContain('success');
    });
  });

  describe('batchMatchProperties', () => {
    it('succeeds', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await batchMatchProperties('1F', ['2A', '3B']);
      expect(result.content[0].text).toContain('success');
    });
  });

  describe('batchCreateGroup', () => {
    it('succeeds', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await batchCreateGroup('G1', ['1F']);
      expect(result.content[0].text).toContain('G1');
    });
  });

  describe('batchAddToGroup', () => {
    it('succeeds', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await batchAddToGroup('G1', ['2A']);
      expect(result.content[0].text).toContain('success');
    });
  });
});
