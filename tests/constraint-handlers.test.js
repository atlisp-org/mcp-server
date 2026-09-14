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
  addGeomConstraint,
  addDimConstraint,
  delConstraint,
  listConstraints,
} = await import('../src/handlers/constraint-handlers.js');

describe('constraint-handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCad.connected = false;
  });

  const expectDisconnected = async (fn, params) => {
    mockConnect.mockResolvedValue(false);
    const result = await fn(params);
    expect(result.content[0].text).toContain('未连接');
  };

  describe('addGeomConstraint', () => {
    const params = { type: 'Parallel', handle1: 'A1', handle2: 'B1' };

    it('returns error when CAD not connected', () => expectDisconnected(addGeomConstraint, params));

    it('adds constraint successfully', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('ok');
      const result = await addGeomConstraint(params);
      expect(result.content[0].text).toContain('几何约束已添加');
    });

    it('returns error on failure', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('error');
      const result = await addGeomConstraint(params);
      expect(result.content[0].text).toContain('添加约束失败');
    });
  });

  describe('addDimConstraint', () => {
    const params = { type: 'Horizontal', handle: 'A1', value: 100 };

    it('returns error when CAD not connected', () => expectDisconnected(addDimConstraint, params));

    it('adds dim constraint successfully', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('ok');
      const result = await addDimConstraint(params);
      expect(result.content[0].text).toContain('标注约束已添加');
    });

    it('returns error on failure', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('error');
      const result = await addDimConstraint(params);
      expect(result.content[0].text).toContain('添加标注约束失败');
    });
  });

  describe('delConstraint', () => {
    const params = { handle: 'A1' };

    it('returns error when CAD not connected', () => expectDisconnected(delConstraint, params));

    it('deletes constraint successfully', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('ok');
      const result = await delConstraint(params);
      expect(result.content[0].text).toContain('约束已删除');
    });

    it('returns error on failure', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('error');
      const result = await delConstraint(params);
      expect(result.content[0].text).toContain('删除约束失败');
    });
  });

  describe('listConstraints', () => {
    it('returns error when CAD not connected', () => expectDisconnected(listConstraints, {}));

    it('lists constraints successfully', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('((type . "Parallel"))');
      const result = await listConstraints({});
      expect(result.content[0].text).toContain('Parallel');
    });
  });
});
