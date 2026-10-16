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
  findText,
  replaceText,
  setTextHeight,
  setTextStyleName,
  justifyText,
  convertTextToMtext,
  explodeText,
} = await import('../src/handlers/text-handlers.js');

describe('text-handlers', () => {
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

  describe('findText', () => {
    it('returns error when CAD not connected', () => expectDisconnected(findText, { pattern: 'test' }));

    it('returns not found when no matches', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('nil');
      const result = await findText({ pattern: 'nonexistent' });
      expect(result.content[0].text).toContain('未找到');
    });

    it('returns found text', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('((("A1" "Hello")))');
      const result = await findText({ pattern: 'Hello' });
      expect(result.content[0].text).toContain('A1');
    });
  });

  describe('replaceText', () => {
    it('returns error when CAD not connected', () => expectDisconnected(replaceText, { pattern: 'old', replacement: 'new' }));

    it('replaces text successfully', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('3');
      const result = await replaceText({ pattern: 'old', replacement: 'new' });
      expect(result.content[0].text).toContain('已替换 3 处');
    });
  });

  describe('setTextHeight', () => {
    const params = { handle: 'A1', height: 10 };

    it('returns error when CAD not connected', () => expectDisconnected(setTextHeight, params));

    it('sets height successfully', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await setTextHeight(params);
      expect(result.content[0].text).toContain('已设置文字高度');
    });

    it('returns error when entity not found', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"NOTFOUND"');
      const result = await setTextHeight(params);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('设置失败');
    });
  });

  describe('setTextStyleName', () => {
    const params = { handle: 'A1', styleName: 'Standard' };

    it('returns error when CAD not connected', () => expectDisconnected(setTextStyleName, params));

    it('sets style successfully', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await setTextStyleName(params);
      expect(result.content[0].text).toContain('已设置文字样式');
    });

    it('returns error when entity not found', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"NOTFOUND"');
      const result = await setTextStyleName(params);
      expect(result.isError).toBe(true);
    });
  });

  describe('justifyText', () => {
    const params = { handle: 'A1', justification: 'MC' };

    it('returns error when CAD not connected', () => expectDisconnected(justifyText, params));

    it('sets justification successfully', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await justifyText(params);
      expect(result.content[0].text).toContain('已设置文字对齐方式');
    });

    it('returns error when entity not found', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"NOTFOUND"');
      const result = await justifyText(params);
      expect(result.isError).toBe(true);
    });
  });

  describe('convertTextToMtext', () => {
    const params = { handles: ['A1', 'B1'] };

    it('returns error when CAD not connected', () => expectDisconnected(convertTextToMtext, params));

    it('converts successfully', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await convertTextToMtext(params);
      expect(result.content[0].text).toContain('已转换');
    });

    it('returns error when no entities', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"NO_ENTITIES"');
      const result = await convertTextToMtext(params);
      expect(result.isError).toBe(true);
    });
  });

  describe('explodeText', () => {
    const params = { handle: 'A1' };

    it('returns error when CAD not connected', () => expectDisconnected(explodeText, params));

    it('explodes text successfully', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"OK"');
      const result = await explodeText(params);
      expect(result.content[0].text).toContain('已分解');
    });

    it('returns error when entity not found', async () => {
      mockCad.connected = true;
      mockSendCommandWithResult.mockResolvedValue('"NOTFOUND"');
      const result = await explodeText(params);
      expect(result.isError).toBe(true);
    });
  });
});
