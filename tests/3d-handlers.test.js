import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendCommandWithResult = vi.fn();
const mockSendCommand = vi.fn();
const mockConnect = vi.fn();
const mockCad = { connected: false, connect: mockConnect, sendCommandWithResult: mockSendCommandWithResult, sendCommand: mockSendCommand };

vi.mock('../src/cad.js', () => ({ cad: mockCad, resolveCadConnection: () => mockCad }));
vi.mock('../src/logger.js', () => ({ log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), closeLog: vi.fn() }));

const {
  createBox, createSphere, createCylinder, createCone, createTorus,
  createWedge, create3DFace, createMesh, extrudeSolid, revolveSolid,
  create3DPolyline, createRegion, booleanUnion, booleanSubtract, booleanIntersect,
  sliceSolid, createLoftSurface, get3DSolidInfo, thickenSurface, offsetSurface,
} = await import('../src/handlers/3d-handlers.js');

describe('3d-handlers', () => {
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

  const testNotConnected = (fn, args) => {
    it(`${fn.name} returns error when not connected`, async () => {
      mockConnect.mockResolvedValue(false);
      const result = await fn(...args);
      expect(result.isError).toBe(true);
    });
  };

  testNotConnected(createBox, ['0,0,0', 100, 50, 30]);
  testNotConnected(createSphere, ['0,0,0', 50]);
  testNotConnected(extrudeSolid, ['1F', 50]);

  testJsonHandler(createBox, ['0,0,0', 100, 50, 30], 'center');
  testJsonHandler(createSphere, ['0,0,0', 50], 'center');
  testJsonHandler(createCylinder, ['0,0,0', 30, 100], 'center');
  testJsonHandler(createCone, ['0,0,0', 30, 80], 'center');
  testJsonHandler(createTorus, ['0,0,0', 50, 10], 'center');
  testJsonHandler(createWedge, ['0,0,0', 100, 50, 30], 'center');
  testJsonHandler(create3DFace, ['0,0,0 100,0,0 100,100,0 0,100,0'], 'points');
  testJsonHandler(extrudeSolid, ['1F', 50], 'profileHandle');
  testJsonHandler(revolveSolid, ['1F', '0,0,0', '0,0,1', 180], 'profileHandle');
  testJsonHandler(create3DPolyline, ['0,0,0 100,0,0 100,100,0'], 'points');
  testJsonHandler(createRegion, [['1F', '2A']], 'handleCount');
  testJsonHandler(booleanUnion, [['1F', '2A']], 'operation');
  testJsonHandler(booleanSubtract, [['1F']], 'subtractFrom');
  testJsonHandler(booleanIntersect, [['1F', '2A']], 'operation');
  testJsonHandler(sliceSolid, ['1F', '0,0,0', '0,0,1', false], 'solidHandle');
  testJsonHandler(thickenSurface, ['1F', 10], 'surfaceHandle');
  testJsonHandler(offsetSurface, ['1F', 5], 'surfaceHandle');
  testJsonHandler(createMesh, [3, 3, '0,0,0 100,0,0 100,100,0 0,100,0'], 'rows');
  testJsonHandler(createLoftSurface, [['1F', '2A'], ['3B']], 'profileCount');
  testJsonHandler(get3DSolidInfo, ['1F'], 'handle');
});
