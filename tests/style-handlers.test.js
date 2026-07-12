import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendCommandWithResult = vi.fn();
const mockSendCommand = vi.fn();
const mockConnect = vi.fn();
const mockCad = { connected: false, connect: mockConnect, sendCommandWithResult: mockSendCommandWithResult, sendCommand: mockSendCommand };

vi.mock('../src/cad.js', () => ({ cad: mockCad, resolveCadConnection: () => mockCad }));
vi.mock('../src/logger.js', () => ({ log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), closeLog: vi.fn() }));

const {
  createDimensionStyle, setDimensionStyleVariable, listDimensionStyles,
  createTextStyle, listTextStyles, createLinetype, loadLinetype,
  listLinetypes, createMLeaderStyle, setMLeaderStyleProperty, listMLeaderStyles,
  createCloudLine, convertToCloudLine,
} = await import('../src/handlers/style-handlers.js');

describe('style-handlers', () => {
  beforeEach(() => { vi.clearAllMocks(); mockCad.connected = false; });

  const testJsonHandler = (fn, args, expectedKey) => {
    it(`${fn.name} returns JSON`, async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('ok');
      const result = await fn(...args);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty(expectedKey);
    });
  };

  testJsonHandler(createDimensionStyle, ['MyStyle'], 'name');
  testJsonHandler(setDimensionStyleVariable, ['MyStyle', 'DIMCLR', '3'], 'styleName');
  testJsonHandler(createTextStyle, ['MyFont', 'simplex.shx', 10, 1, 0], 'name');
  testJsonHandler(createLinetype, ['DASHED', 'dashed', 'A,12,-6'], 'name');
  testJsonHandler(loadLinetype, ['DASHED', 'C:/acad.lin'], 'linetypeName');
  testJsonHandler(createMLeaderStyle, ['MyLeader'], 'name');
  testJsonHandler(setMLeaderStyleProperty, ['MyLeader', 'arrowSize', '5'], 'styleName');
  testJsonHandler(createCloudLine, ['0,0', '100,100', 0.5, 10], 'startPoint');
  testJsonHandler(convertToCloudLine, ['1F'], 'handle');

  describe('list functions', () => {
    it('listDimensionStyles', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('("Standard" "MyStyle")');
      const result = await listDimensionStyles();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('styles');
    });

    it('listTextStyles', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('("Standard" "MyFont")');
      const result = await listTextStyles();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('styles');
    });

    it('listLinetypes', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('("ByLayer" "Continuous" "DASHED")');
      const result = await listLinetypes();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('linetypes');
    });

    it('listMLeaderStyles', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('("Standard" "MyLeader")');
      const result = await listMLeaderStyles();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('styles');
    });
  });

  describe('not connected', () => {
    const testNotConnected = (fn, args) => {
      it(`${fn.name} returns error`, async () => {
        mockConnect.mockResolvedValue(false);
        const result = await fn(...args);
        expect(result.isError).toBe(true);
      });
    };

    testNotConnected(createDimensionStyle, ['S']);
    testNotConnected(createTextStyle, ['F', 'font.shx']);
    testNotConnected(createLinetype, ['L', 'desc', 'pat']);
    testNotConnected(createMLeaderStyle, ['M']);
    testNotConnected(createCloudLine, ['0,0', '100,100']);
  });
});
