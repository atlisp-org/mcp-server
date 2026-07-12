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
  createBlock,
  insertBlock,
  getBlocks,
  explodeBlock,
} = await import('../src/handlers/block-handlers.js');

describe('block-handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCad.connected = false;
  });

  describe('createBlock', () => {
    it('returns error when CAD not connected', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await createBlock('MyBlock');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('未连接');
    });

    it('creates block successfully', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"CREATED"');
      const result = await createBlock('MyBlock');
      expect(result.content[0].text).toContain('已创建');
    });

    it('returns error when block exists', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"EXISTS"');
      const result = await createBlock('MyBlock');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('已存在');
    });

    it('creates block with entities', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"CREATED"');
      const result = await createBlock('MyBlock', '(entmake (list (cons 0 "CIRCLE")))');
      expect(mockSendCommandWithResult).toHaveBeenCalled();
    });
  });

  describe('insertBlock', () => {
    it('returns error when CAD not connected', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await insertBlock('MyBlock', '0,0');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('未连接');
    });

    it('inserts block successfully with string point', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"INSERTED"');
      const result = await insertBlock('MyBlock', '100,200');
      expect(result.content[0].text).toContain('已插入');
    });

    it('inserts block successfully with array point', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"INSERTED"');
      const result = await insertBlock('MyBlock', [100, 200, 0]);
      expect(result.content[0].text).toContain('已插入');
    });

    it('inserts block with scale and rotation', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"INSERTED"');
      const result = await insertBlock('MyBlock', '0,0', 2, 45);
      expect(mockSendCommandWithResult).toHaveBeenCalled();
    });

    it('returns error when block not found', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"NOTFOUND"');
      const result = await insertBlock('NonExistent', '0,0');
      expect(result.isError).toBe(true);
    });

    it('returns error for invalid point format', async () => {
      mockCad.connected = true;
      const result = await insertBlock('MyBlock', 'invalid');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('格式错误');
    });
  });

  describe('getBlocks', () => {
    it('returns error when CAD not connected', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await getBlocks();
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('未连接');
    });

    it('returns block list', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('("Block1" "Block2" "Block3")');
      const result = await getBlocks();
      expect(result.content[0].text).toContain('Block1');
      expect(result.content[0].text).toContain('Block2');
    });

    it('returns empty message when no blocks', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('nil');
      const result = await getBlocks();
      expect(result.content[0].text).toContain('没有块定义');
    });
  });

  describe('explodeBlock', () => {
    it('returns error when CAD not connected', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await explodeBlock('1F');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('未连接');
    });

    it('explodes block successfully', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"EXPLODED"');
      const result = await explodeBlock('1F');
      expect(result.content[0].text).toContain('已炸开');
    });

    it('returns error when entity not found', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"NOTFOUND"');
      const result = await explodeBlock('999');
      expect(result.isError).toBe(true);
    });
  });
});