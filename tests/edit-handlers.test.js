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
  trimEntity,
  extendEntity,
  fillet,
  chamfer,
  breakEntity,
  joinEntities,
  stretch,
} = await import('../src/handlers/edit-handlers.js');

describe('edit-handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCad.connected = false;
  });

  const expectDisconnected = async (fn, params) => {
    mockConnect.mockResolvedValue(false);
    const result = await fn(params);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('未连接');
  };

  const expectSuccess = async (fn, params, expectedText) => {
    mockCad.connected = true;
    mockSendCommandWithResult.mockResolvedValue('"OK"');
    const result = await fn(params);
    expect(result.content[0].text).toContain(expectedText);
  };

  const expectFailure = async (fn, params, mockReturn) => {
    mockCad.connected = true;
    mockSendCommandWithResult.mockResolvedValue(mockReturn);
    const result = await fn(params);
    expect(result.isError).toBe(true);
  };

  describe('trimEntity', () => {
    const params = { handle: 'A1', cuttingEdgeHandle: 'B1' };

    it('returns error when CAD not connected', () => expectDisconnected(trimEntity, params));
    it('trims entity successfully', () => expectSuccess(trimEntity, params, '已修剪'));
    it('returns error when entity not found', () => expectFailure(trimEntity, params, '"NOTFOUND"'));
    it('returns error when cutting edge not found', () => expectFailure(trimEntity, params, '"CUT_EDGE_NOT_FOUND"'));
  });

  describe('extendEntity', () => {
    const params = { handle: 'A1', boundaryHandle: 'B1' };

    it('returns error when CAD not connected', () => expectDisconnected(extendEntity, params));
    it('extends entity successfully', () => expectSuccess(extendEntity, params, '已延伸'));
    it('returns error when entity not found', () => expectFailure(extendEntity, params, '"NOTFOUND"'));
    it('returns error when boundary not found', () => expectFailure(extendEntity, params, '"BOUNDARY_NOT_FOUND"'));
  });

  describe('fillet', () => {
    const params = { handle1: 'A1', handle2: 'B1', radius: 5 };

    it('returns error when CAD not connected', () => expectDisconnected(fillet, params));
    it('creates fillet successfully', () => expectSuccess(fillet, params, '已圆角'));
    it('returns error when entities not found', () => expectFailure(fillet, params, '"NOTFOUND"'));
  });

  describe('chamfer', () => {
    const params = { handle1: 'A1', handle2: 'B1', distance1: 5, distance2: 3 };

    it('returns error when CAD not connected', () => expectDisconnected(chamfer, params));
    it('creates chamfer successfully', () => expectSuccess(chamfer, params, '已倒角'));
    it('returns error when entities not found', () => expectFailure(chamfer, params, '"NOTFOUND"'));
  });

  describe('breakEntity', () => {
    const params = { handle: 'A1', point1: '0,0', point2: '10,10' };

    it('returns error when CAD not connected', () => expectDisconnected(breakEntity, params));
    it('breaks entity successfully', () => expectSuccess(breakEntity, params, '已打断'));
    it('returns error when entity not found', () => expectFailure(breakEntity, params, '"NOTFOUND"'));
  });

  describe('joinEntities', () => {
    const params = { handles: ['A1', 'B1', 'C1'] };

    it('returns error when CAD not connected', () => expectDisconnected(joinEntities, params));
    it('joins entities successfully', () => expectSuccess(joinEntities, params, '已合并'));
    it('returns error when too few entities', () => expectFailure(joinEntities, params, '"TOO_FEW"'));
  });

  describe('stretch', () => {
    const params = { handles: ['A1', 'B1'], basePoint: '0,0', displacement: '10,10' };

    it('returns error when CAD not connected', () => expectDisconnected(stretch, params));
    it('stretches entities successfully', () => expectSuccess(stretch, params, '已拉伸'));
    it('returns error when no entities', () => expectFailure(stretch, params, '"NO_ENTITIES"'));
  });
});
