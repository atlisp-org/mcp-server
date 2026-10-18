import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSendCommand = vi.fn();
const mockSendCommandWithResult = vi.fn();
const mockConnect = vi.fn();
const mockGetInfo = vi.fn();
const mockGetPlatform = vi.fn();
const mockGetVersion = vi.fn();
const mockNewDoc = vi.fn();
const mockPing = vi.fn();
const mockIsBusy = vi.fn();
const mockHasDoc = vi.fn();
const mockBringToFront = vi.fn();
const mockDisconnect = vi.fn();

const mockCad = {
  connected: false,
  connect: mockConnect,
  sendCommand: mockSendCommand,
  sendCommandWithResult: mockSendCommandWithResult,
  getInfo: mockGetInfo,
  getPlatform: mockGetPlatform,
  getVersion: mockGetVersion,
  newDoc: mockNewDoc,
  ping: mockPing,
  isBusy: mockIsBusy,
  hasDoc: mockHasDoc,
  bringToFront: mockBringToFront,
  disconnect: mockDisconnect,
};

vi.mock('../src/cad.js', () => ({
  cad: mockCad,
  onDocumentChanged: vi.fn(),
  resolveCadConnection: () => mockCad,
}));

vi.mock('../src/logger.js', () => ({ log: vi.fn(), error: vi.fn(), closeLog: vi.fn() }));

vi.mock('../src/lint-analyzer.js', () => ({
  analyzeLispCode: vi.fn(() => ({ valid: true, errors: [] })),
}));

const {
  evalLisp, getCadInfo, openCad, connectCad,
  newDocument, bringToFront, installAtlisp,
  getSystemStatus, initAtlisp, getSystemVariable,
  setSystemVariable, atCommand,
} = await import('../src/handlers/cad-handlers.js');
const { resetAtlispReady } = await import('../src/atlisp-bootstrap.js');

describe('cad-handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAtlispReady();
    mockCad.connected = true;
    mockGetPlatform.mockReturnValue('AutoCAD');
    mockGetVersion.mockReturnValue('2025');
    mockGetInfo.mockResolvedValue('AutoCAD 2025');
    mockSendCommandWithResult.mockImplementation(async (code) => {
      if (code.includes('(+ 1 2)')) return '3';
      if (code.includes('getvar')) return '"test.dwg"';
      return 'ok';
    });
    mockPing.mockResolvedValue(true);
    mockIsBusy.mockResolvedValue(false);
    mockHasDoc.mockResolvedValue({ hasDoc: true, docCount: 1 });
    mockConnect.mockResolvedValue(true);
    mockNewDoc.mockResolvedValue(true);
    mockBringToFront.mockResolvedValue(true);
  });

  describe('evalLisp', () => {
    it('returns success for empty code', async () => {
      const result = await evalLisp('');
      expect(result.content[0].text).toContain('命令为空');
    });

    it('sends trimmed code without result', async () => {
      const result = await evalLisp('  (princ "hi")  ');
      expect(mockSendCommand).toHaveBeenCalledWith('(princ "hi")\n');
      expect(result.content[0].text).toContain('已发送命令');
    });

    it('sends code and returns result', async () => {
      mockSendCommandWithResult.mockResolvedValue('3');
      const result = await evalLisp('(+ 1 2)', true);
      expect(mockSendCommandWithResult).toHaveBeenCalledWith('(+ 1 2)', null, false);
      expect(result.content[0].text).toBe('3');
    });

    it('returns error when result is null', async () => {
      mockSendCommandWithResult.mockResolvedValue(null);
      const result = await evalLisp('(bad)', true);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('执行失败');
    });

    it('handles encoding parameter', async () => {
      mockSendCommandWithResult.mockResolvedValue({ rawBase64: Buffer.from('中文').toString('base64') });
      const result = await evalLisp('(princ "中文")', true, 'gbk');
      expect(mockSendCommandWithResult).toHaveBeenCalledWith('(princ "中文")', 'gbk', true);
      expect(result.isError).toBeFalsy();
    });
  });

  describe('getCadInfo', () => {
    it('returns CAD info', async () => {
      mockGetInfo.mockResolvedValue('AutoCAD 2025');
      const result = await getCadInfo();
      expect(mockGetInfo).toHaveBeenCalled();
      expect(result.content[0].text).toBe('AutoCAD 2025');
    });
  });

  describe('openCad', () => {
    it('connects and brings CAD to front', async () => {
      mockConnect.mockResolvedValue(true);
      const result = await openCad('AutoCAD');
      expect(mockConnect).toHaveBeenCalledWith('AutoCAD');
      expect(mockBringToFront).toHaveBeenCalled();
      expect(result.isError).toBeFalsy();
    });

    it('returns error when connect fails', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await openCad();
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('未能打开');
    });
  });

  describe('connectCad', () => {
    it('connects successfully', async () => {
      mockConnect.mockResolvedValue(true);
      const result = await connectCad();
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('已连接到');
    });

    it('handles connect failure', async () => {
      mockConnect.mockResolvedValue(false);
      const result = await connectCad();
      expect(result.isError).toBe(true);
    });
  });

  describe('newDocument', () => {
    it('creates new document', async () => {
      mockNewDoc.mockResolvedValue(true);
      const result = await newDocument();
      expect(mockNewDoc).toHaveBeenCalled();
      expect(result.isError).toBeFalsy();
    });

    it('handles failure', async () => {
      mockNewDoc.mockResolvedValue(false);
      const result = await newDocument();
      expect(result.isError).toBe(true);
    });
  });

  describe('bringToFront', () => {
    it('brings CAD window forward', async () => {
      mockBringToFront.mockResolvedValue(true);
      const result = await bringToFront();
      expect(mockBringToFront).toHaveBeenCalled();
      expect(result.isError).toBeFalsy();
    });
  });

  describe('installAtlisp', () => {
    it('installs @lisp core when missing', async () => {
      let installed = false;
      mockSendCommandWithResult.mockImplementation(async (code) => {
        if (code.includes('@mcp-unsaved')) return 'ATLISP-SAVED';
        if (code.includes('atoms-family') && code.includes('BASE:INIT')) {
          return installed ? 'ATLISP-CORE' : 'ATLISP-NONE';
        }
        if (code.includes('/@')) {
          installed = true;
          return 'ok';
        }
        return 'ok';
      });

      const result = await installAtlisp();
      expect(mockSendCommandWithResult).toHaveBeenCalledWith(
        expect.stringContaining('vl-load-com'), null, false, expect.any(Number), true);
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('核心安装完成');
    });

    it('blocks installation when drawings are unsaved', async () => {
      mockSendCommandWithResult.mockImplementation(async (code) => {
        if (code.includes('@mcp-unsaved')) return 'ATLISP-UNSAVED';
        if (code.includes('atoms-family') && code.includes('BASE:INIT')) return 'ATLISP-NONE';
        return 'ok';
      });

      const result = await installAtlisp();
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('未保存');
    });
  });

  describe('getSystemStatus', () => {
    it('returns complete status object', async () => {
      mockPing.mockResolvedValue(true);
      mockGetPlatform.mockReturnValue('AutoCAD');
      mockGetVersion.mockReturnValue('2025');
      mockIsBusy.mockResolvedValue(false);
      mockHasDoc.mockResolvedValue({ hasDoc: true });
      mockSendCommandWithResult.mockImplementation(async (code) => {
        if (code.includes('(+ 1 2)')) return '3';
        return '((("base" . "1.0.0")))';
      });
      const result = await getSystemStatus();
      const status = JSON.parse(result.content[0].text);
      expect(status.worker.alive).toBe(true);
      expect(status.cad.connected).toBe(true);
      expect(status.cad.platform).toBe('AutoCAD');
      expect(status.lisp.available).toBe(true);
      expect(status.lisp.testResult).toBe('3');
    });

    it('handles disconnected state', async () => {
      mockCad.connected = false;
      const result = await getSystemStatus();
      const status = JSON.parse(result.content[0].text);
      expect(status.cad.connected).toBe(false);
      expect(status.lisp.available).toBe(false);
    });
  });

  describe('getSystemVariable', () => {
    it('reads a system variable', async () => {
      mockSendCommandWithResult.mockResolvedValue('"0"');
      const result = await getSystemVariable('CLAYER');
      expect(mockSendCommandWithResult).toHaveBeenCalledWith(expect.stringContaining('CLAYER'));
      expect(result.content[0].text).toBe('"0"');
    });
  });

  describe('setSystemVariable', () => {
    it('sets a system variable', async () => {
      const result = await setSystemVariable('CLAYER', '"MyLayer"');
      expect(mockSendCommand).toHaveBeenCalledWith(expect.stringContaining('CLAYER'));
      expect(result.isError).toBeFalsy();
    });
  });

  describe('initAtlisp', () => {
    it('loads the function library when core is installed', async () => {
      let initialized = false;
      mockSendCommandWithResult.mockImplementation(async (code) => {
        if (code.includes('@mcp-unsaved')) return 'ATLISP-SAVED';
        if (code.includes('atoms-family') && code.includes('BASE:INIT')) {
          return initialized ? 'ATLISP-READY' : 'ATLISP-CORE';
        }
        if (code.includes('/cloud')) {
          initialized = true;
          return 'ok';
        }
        return 'ok';
      });

      const result = await initAtlisp();
      expect(mockSendCommandWithResult).toHaveBeenCalledWith(
        expect.stringContaining('atlisp'), null, false, expect.any(Number), true);
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('函数库');
    });
  });

  describe('atCommand', () => {
    it('sends command', async () => {
      const result = await atCommand('@H');
      expect(mockSendCommand).toHaveBeenCalledWith('@H\n');
      expect(result.isError).toBeFalsy();
    });

    it('returns error for empty command', async () => {
      const result = await atCommand('');
      expect(result.content[0].text).toContain('命令为空');
    });
  });
});
