import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import os from 'node:os';

process.env.MESSAGE_TIMEOUT = '200';
process.env.CAD_COMMAND_TIMEOUT = '80';
process.env.STALL_COOLDOWN = '5000';
process.env.HEARTBEAT_PING_TIMEOUT = '100';

vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid'),
}));

const mockWorker = {
  connected: true,
  stdin: { write: vi.fn(), on: vi.fn() },
  stdout: { on: vi.fn(), off: vi.fn() },
  stderr: { on: vi.fn() },
  kill: vi.fn(),
  on: vi.fn(),
};

vi.mock('child_process', () => ({
  spawn: vi.fn(() => mockWorker),
}));

const { cad } = await import('../src/cad.js');

function captureHandler() {
  let handler;
  mockWorker.stdout.on.mockImplementation((event, fn) => {
    if (event === 'data') handler = fn;
  });
  return () => handler;
}

function mockResponse(data) {
  return Buffer.from(JSON.stringify({ ...data, requestId: 'test-uuid' }) + '\n');
}

describe('CadConnection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    cad._reset();
  });

  describe('isAvailable', () => {
    it('returns false on non-Windows platforms', () => {
      const orig = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });
      expect(cad.isAvailable()).toBe(false);
      Object.defineProperty(process, 'platform', { value: orig });
    });

    it('returns true on Windows', () => {
      const orig = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });
      expect(cad.isAvailable()).toBe(true);
      Object.defineProperty(process, 'platform', { value: orig });
    });
  });

  describe('connect', () => {
    let origPlatform;
    beforeEach(() => {
      origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });
    });
    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: origPlatform });
    });

    it('returns false when not available', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      const result = await cad.connect();
      expect(result).toBe(false);
    });

    it('updates state on success', async () => {
      const getHandler = captureHandler();
      const connectPromise = cad.connect();
      const handler = getHandler();
      expect(handler).toBeTruthy();
      handler(mockResponse({ success: true, platform: 'AutoCAD', version: '24.0' }));
      const result = await connectPromise;

      expect(result).toBe(true);
      expect(cad.connected).toBe(true);
      expect(cad.product).toBe('AutoCAD');
      expect(cad.version).toBe('24.0');
    });

    it('keeps connected false on failure', async () => {
      const getHandler = captureHandler();
      const connectPromise = cad.connect();
      const handler = getHandler();
      expect(handler).toBeTruthy();
      handler(mockResponse({ success: false }));
      const result = await connectPromise;

      expect(result).toBe(false);
      expect(cad.connected).toBe(false);
    });

    it('keeps connected false on error response', async () => {
      const getHandler = captureHandler();
      const connectPromise = cad.connect();
      const handler = getHandler();
      expect(handler).toBeTruthy();
      handler(mockResponse({ error: 'No CAD found' }));
      const result = await connectPromise;

      expect(result).toBe(false);
      expect(cad.connected).toBe(false);
    });

    it('sends forceLaunch flag when requested', async () => {
      const getHandler = captureHandler();
      const connectPromise = cad.connect('AutoCAD', { forceLaunch: true });
      const handler = getHandler();
      expect(handler).toBeTruthy();
      handler(mockResponse({ success: true, platform: 'AutoCAD', version: '24.0', launched: true }));
      const result = await connectPromise;

      expect(result).toBe(true);
      expect(cad.connected).toBe(true);
      const writeCall = JSON.parse(mockWorker.stdin.write.mock.calls[0][0]);
      expect(writeCall.type).toBe('connect');
      expect(writeCall.platform).toBe('AutoCAD');
      expect(writeCall.forceLaunch).toBe(true);
    });

    it('does not set forceLaunch flag by default', async () => {
      const getHandler = captureHandler();
      const connectPromise = cad.connect('AutoCAD');
      const handler = getHandler();
      expect(handler).toBeTruthy();
      handler(mockResponse({ success: true, platform: 'AutoCAD', version: '24.0' }));
      await connectPromise;

      const writeCall = JSON.parse(mockWorker.stdin.write.mock.calls[0][0]);
      expect(writeCall.type).toBe('connect');
      expect(writeCall.forceLaunch).toBeUndefined();
    });

    it('以临时目录为工作目录拉起 worker（避免 Windows 锁住 npm 包目录）', async () => {
      const getHandler = captureHandler();
      const connectPromise = cad.connect();
      const handler = getHandler();
      expect(handler).toBeTruthy();

      const options = spawn.mock.calls.at(-1)[2];
      expect(options.cwd).toBe(os.tmpdir());

      handler(mockResponse({ success: true, platform: 'AutoCAD', version: '24.0' }));
      await connectPromise;
    });
  });

  describe('sendCommand', () => {
    it('throws when not connected', async () => {
      await expect(cad.sendCommand('(princ "hello")')).rejects.toThrow('未连接 CAD');
    });

    it('sends command message when connected', async () => {
      cad.connected = true;
      const getHandler = captureHandler();
      const sendPromise = cad.sendCommand('(princ "hello")');
      const handler = getHandler();
      expect(handler).toBeTruthy();
      handler(mockResponse({ success: true }));
      const result = await sendPromise;

      expect(result).toBe(true);
      const writeCall = JSON.parse(mockWorker.stdin.write.mock.calls[0][0]);
      expect(writeCall.type).toBe('send');
      expect(writeCall.code).toBe('(princ "hello")');
    });
  });

  describe('sendCommandWithResult', () => {
    it('throws when not connected', async () => {
      await expect(cad.sendCommandWithResult('(+ 1 2)')).rejects.toThrow('未连接 CAD');
    });

    it('returns result on success', async () => {
      cad.connected = true;
      const getHandler = captureHandler();
      const resultPromise = cad.sendCommandWithResult('(+ 1 2)');
      const handler = getHandler();
      expect(handler).toBeTruthy();
      handler(mockResponse({ success: true, result: '3' }));
      const result = await resultPromise;

      expect(result).toBe('3');
    });

    it('throws error on failure', async () => {
      cad.connected = true;
      const getHandler = captureHandler();
      const resultPromise = cad.sendCommandWithResult('(+ 1 2)');
      const handler = getHandler();
      expect(handler).toBeTruthy();
      handler(mockResponse({ success: false }));
      
      await expect(resultPromise).rejects.toThrow();
    });
  });

  describe('isBusy / hasDoc / newDoc', () => {
    it('isBusy returns false when not connected', async () => {
      const result = await cad.isBusy();
      expect(result).toBe(false);
    });

    it('isBusy returns worker result', async () => {
      cad.connected = true;
      const getHandler = captureHandler();
      const busyPromise = cad.isBusy();
      const handler = getHandler();
      expect(handler).toBeTruthy();
      handler(mockResponse({ isBusy: true }));
      const result = await busyPromise;

      expect(result).toBe(true);
    });

    it('hasDoc returns defaults when not connected', async () => {
      const result = await cad.hasDoc();
      expect(result).toEqual({ hasDoc: false, docCount: 0 });
    });

    it('newDoc throws when not connected', async () => {
      await expect(cad.newDoc()).rejects.toThrow('未连接 CAD');
    });
  });

  describe('getInfo', () => {
    it('returns not connected message when not connected', async () => {
      const result = await cad.getInfo();
      expect(result).toBe('CAD 未连接');
    });

    it('returns platform info when connected', async () => {
      cad.connected = true;
      cad.product = 'AutoCAD';
      cad.version = '24.0';
      const result = await cad.getInfo();
      expect(result).toBe('Platform: AutoCAD, Version: 24.0, Status: Connected');
    });
  });

  describe('getVersion / getPlatform', () => {
    it('returns stored values', () => {
      cad.version = '25.0';
      cad.product = 'ZWCAD';
      expect(cad.getVersion()).toBe('25.0');
      expect(cad.getPlatform()).toBe('ZWCAD');
    });
  });

  describe('disconnect', () => {
    it('resets state', () => {
      cad.connected = true;
      cad.version = '24.0';
      cad.product = 'AutoCAD';

      cad.disconnect();
      expect(cad.connected).toBe(false);
      expect(cad.version).toBeNull();
      expect(cad.product).toBeNull();
    });
  });

  describe('stall detection', () => {
    let origPlatform;
    beforeEach(() => {
      origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });
    });
    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: origPlatform });
    });

    it('marks stalled and rejects with CAD_BUSY on command timeout', async () => {
      cad.connected = true;
      const getHandler = captureHandler();
      const promise = cad.sendCommandWithResult('(+ 1 2)');
      const handler = getHandler();
      expect(handler).toBeTruthy();
      // deliberately do NOT respond → times out at CAD_COMMAND_TIMEOUT (80ms)

      await expect(promise).rejects.toThrow('停滞');
      expect(cad.isStalled()).toBe(true);
      expect(cad.getStallInfo().stalled).toBe(true);
      expect(cad.getStallInfo().reason).toContain('超时');
    }, 5000);

    it('fails fast with CAD_BUSY during stall cooldown without touching worker', async () => {
      cad.connected = true;
      const getHandler = captureHandler();
      const promise = cad.sendCommandWithResult('(+ 1 2)');
      getHandler();
      await expect(promise).rejects.toThrow('停滞');
      expect(cad.isStalled()).toBe(true);

      const writesBefore = mockWorker.stdin.write.mock.calls.length;
      await expect(cad.sendCommand('(princ "x")')).rejects.toThrow('停滞');
      await expect(cad.sendCommandWithResult('(+ 1 1)')).rejects.toThrow('停滞');
      await expect(cad.isBusy()).resolves.toBe(true);
      expect(mockWorker.stdin.write.mock.calls.length).toBe(writesBefore);
    }, 5000);

    it('clears stall after successful connect', async () => {
      cad.connected = true;
      const getHandler = captureHandler();
      const promise = cad.sendCommandWithResult('(+ 1 2)');
      const handler = getHandler();
      expect(handler).toBeTruthy();
      await expect(promise).rejects.toThrow('停滞');
      expect(cad.isStalled()).toBe(true);

      const connectPromise = cad.connect('AutoCAD');
      handler(mockResponse({ success: true, platform: 'AutoCAD', version: '24.0' }));
      await connectPromise;

      expect(cad.isStalled()).toBe(false);
      expect(cad.getStallInfo().stalled).toBe(false);
    }, 5000);
  });
});
