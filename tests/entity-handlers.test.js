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
  getEntity,
  setEntityProperty,
  deleteEntity,
  selectEntities,
} = await import('../src/handlers/entity-handlers.js');

describe('entity-handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCad.connected = false;
  });

  describe('getEntity', () => {
    it('returns error when CAD not connected', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await getEntity('1F');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('未连接');
    });

    it('returns entity data when found', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('(list "type" "LINE" "handle" "1F" "layer" "0")');
      const result = await getEntity('1F');
      expect(result.content[0].text).toContain('LINE');
      expect(result.content[0].text).toContain('1F');
    });

    it('returns error when entity not found', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('nil');
      const result = await getEntity('999');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('未找到');
    });
  });

  describe('setEntityProperty', () => {
    it('returns error when CAD not connected', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await setEntityProperty('1F', 'layer', 'MyLayer');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('未连接');
    });

    it('sets layer property successfully', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await setEntityProperty('1F', 'layer', 'MyLayer');
      expect(result.content[0].text).toContain('已设置');
    });

    it('returns error for unsupported property', async () => {
      mockCad.connected = true;
      const result = await setEntityProperty('1F', 'unknown', 'value');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('不支持');
    });

    it('sets color property', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await setEntityProperty('1F', 'color', '3');
      expect(result.content[0].text).toContain('已设置');
    });

    it('sets linetype property', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await setEntityProperty('1F', 'linetype', 'DASHED');
      expect(result.content[0].text).toContain('已设置');
    });

    it('sets elevation property', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await setEntityProperty('1F', 'elevation', '100');
      expect(result.content[0].text).toContain('已设置');
    });
  });

  describe('deleteEntity', () => {
    it('returns error when CAD not connected', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await deleteEntity('1F');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('未连接');
    });

    it('deletes entity successfully', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"DELETED"');
      const result = await deleteEntity('1F');
      expect(result.content[0].text).toContain('已删除');
    });

    it('returns error when entity not found', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"NOTFOUND"');
      const result = await deleteEntity('999');
      expect(result.isError).toBe(true);
    });
  });

  describe('selectEntities', () => {
    it('returns error when CAD not connected', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await selectEntities({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('未连接');
    });

    it('returns handles with type filter', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('("1F" "2A" "3B")');
      const result = await selectEntities({ type: 'LINE' });
      expect(result.content[0].text).toContain('1F');
    });

    it('returns handles with layer filter', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('("1F")');
      const result = await selectEntities({ layer: '0' });
      expect(result.content[0].text).toContain('1F');
    });

    it('returns empty when no entities found', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('nil');
      const result = await selectEntities({ type: 'CIRCLE' });
      expect(result.content[0].text).toContain('未找到');
    });

    it('returns all entities without filter', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('("1F" "2A")');
      const result = await selectEntities(null);
      expect(result.content[0].text).toContain('1F');
    });
  });
});