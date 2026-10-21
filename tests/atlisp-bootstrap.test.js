import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCad = {
  connected: true,
  connectionEpoch: 1,
  getConnectionId: vi.fn(() => 'conn-1'),
  isBusy: vi.fn(async () => false),
  sendCommandWithResult: vi.fn(),
  /** 由 onCadConnected 注册的连接事件回调（测试里手动触发） */
  connectHandler: null,
};

vi.mock('../src/cad.js', () => ({
  cad: mockCad,
  resolveCadConnection: () => mockCad,
  onCadConnected: (cb) => { mockCad.connectHandler = cb; },
}));
vi.mock('../src/logger.js', () => ({ log: vi.fn(), error: vi.fn() }));
vi.mock('../src/config.js', () => ({
  default: {
    autoInstallAtlisp: true,
    atlispBootstrapTimeout: 5000,
    atlispBootstrapRetry: 60000,
  },
}));

const {
  ensureAtlispReady, installAtlispCore, initAtlispLibrary,
  getAtlispStatus, probeAtlisp, resetAtlispReady, installAtlispConnectHook,
  ATLISP_PROBE_CODE, ATLISP_UNSAVED_PROBE_CODE,
} = await import('../src/atlisp-bootstrap.js');

function classify(code) {
  if (code.includes('@mcp-unsaved')) return 'unsaved';
  if (code.includes('atoms-family') && code.includes('BASE:INIT')) return 'probe';
  if (code.includes('/cloud')) return 'init';
  if (code.includes('/@')) return 'install';
  return 'other';
}

let core;
let ready;
let unsaved;
let failInstall;
let failInit;
let probeUnknown;
let calls;

describe('atlisp-bootstrap', () => {
  beforeEach(() => {
    resetAtlispReady();
    core = false;
    ready = false;
    unsaved = false;
    failInstall = false;
    failInit = false;
    probeUnknown = false;
    calls = [];
    mockCad.connected = true;
    mockCad.connectionEpoch = 1;
    mockCad.getConnectionId.mockReturnValue('conn-1');
    mockCad.isBusy.mockResolvedValue(false);
    mockCad.sendCommandWithResult.mockReset();
    mockCad.sendCommandWithResult.mockImplementation(async (code) => {
      const kind = classify(code);
      calls.push(kind);
      if (kind === 'unsaved') return unsaved ? 'ATLISP-UNSAVED' : 'ATLISP-SAVED';
      if (kind === 'probe') {
        if (probeUnknown) return 'unexpected';
        if (ready) return 'ATLISP-READY';
        if (core) return 'ATLISP-CORE';
        return 'ATLISP-NONE';
      }
      if (kind === 'install') {
        if (failInstall) throw new Error('install failed');
        core = true;
        return 'ok';
      }
      if (kind === 'init') {
        if (failInit) throw new Error('init failed');
        ready = core;
        return 'ok';
      }
      return 'ok';
    });
  });

  it('probes ready/core/none', async () => {
    expect((await probeAtlisp()).ready).toBe(false);

    core = true;
    expect(await probeAtlisp()).toMatchObject({ core: true, ready: false });

    ready = true;
    expect(await probeAtlisp()).toMatchObject({ core: true, ready: true });
  });

  // worker 只把表达式返回值写进结果文件，(princ "...") 的输出去不了服务端
  it('探测代码把 token 作为返回值，而不是靠 princ 输出', () => {
    expect(ATLISP_PROBE_CODE.trim().startsWith('(cond')).toBe(true);
    expect(ATLISP_PROBE_CODE).not.toContain('(princ');
    expect(ATLISP_UNSAVED_PROBE_CODE).not.toContain('(princ');
    expect(ATLISP_PROBE_CODE).toContain('"ATLISP-READY"');
  });

  // LISP 里 0 也是真值，标志位用 0 会把「已保存」误判成「未保存」
  it('未保存图纸检查用 nil 作标志位并返回 token', () => {
    expect(ATLISP_UNSAVED_PROBE_CODE).toContain('(setq @mcp-unsaved nil)');
    expect(ATLISP_UNSAVED_PROBE_CODE.trim().endsWith('@mcp-token)')).toBe(true);
  });

  it('returns quickly when already ready and caches the result', async () => {
    ready = true;
    const first = await ensureAtlispReady();
    expect(first).toMatchObject({ ok: true, ready: true });
    const probeCalls = calls.length;

    const second = await ensureAtlispReady();
    expect(second.cached).toBe(true);
    expect(calls.length).toBe(probeCalls);
  });

  it('loads the function library when only core is installed', async () => {
    core = true;
    const result = await ensureAtlispReady();
    expect(result).toMatchObject({ ok: true, ready: true, action: 'initialized' });
    expect(calls).toContain('init');
    expect(calls).not.toContain('install');
  });

  it('installs core and loads the library when nothing is installed', async () => {
    const result = await ensureAtlispReady();
    expect(result).toMatchObject({ ok: true, ready: true, action: 'installed' });
    expect(calls).toEqual(expect.arrayContaining(['unsaved', 'install', 'init']));
  });

  it('skips cloud init when the kernel installer already loaded the library', async () => {
    mockCad.sendCommandWithResult.mockImplementation(async (code) => {
      const kind = classify(code);
      calls.push(kind);
      if (kind === 'unsaved') return 'ATLISP-SAVED';
      if (kind === 'probe') return ready ? 'ATLISP-READY' : (core ? 'ATLISP-CORE' : 'ATLISP-NONE');
      if (kind === 'install') {
        core = true;
        ready = true; // 模拟 @::init-once 里的 @::loadlib 已加载 base:init
        return 'ok';
      }
      return 'ok';
    });

    const result = await ensureAtlispReady();
    expect(result).toMatchObject({ ok: true, ready: true, action: 'installed' });
    expect(calls).toContain('install');
    expect(calls).not.toContain('init');
  });

  it('blocks auto-install when there are unsaved drawings', async () => {
    unsaved = true;
    const result = await ensureAtlispReady();
    expect(result).toMatchObject({ ok: false, action: 'blocked', unsaved: true });
    expect(calls).not.toContain('install');
    expect(calls).not.toContain('init');
  });

  it('throttles repeated failures and retries when forced', async () => {
    failInstall = true;
    const first = await ensureAtlispReady();
    expect(first.ok).toBe(false);
    const attempts = calls.filter(c => c === 'install').length;

    const second = await ensureAtlispReady();
    expect(second.throttled).toBe(true);
    expect(calls.filter(c => c === 'install').length).toBe(attempts);

    const third = await ensureAtlispReady({ force: true });
    expect(third.ok).toBe(false);
    expect(calls.filter(c => c === 'install').length).toBe(attempts + 1);
  });

  it('re-probes after a new connection epoch', async () => {
    ready = true;
    await ensureAtlispReady();
    const firstProbeCount = calls.filter(c => c === 'probe').length;

    mockCad.connectionEpoch = 2;
    ready = false;
    core = true;
    const result = await ensureAtlispReady();
    expect(result).toMatchObject({ ok: true, action: 'initialized' });
    expect(calls.filter(c => c === 'probe').length).toBeGreaterThan(firstProbeCount);
  });

  it('installAtlispCore reports already installed', async () => {
    core = true;
    const result = await installAtlispCore();
    expect(result).toMatchObject({ ok: true, action: 'already', installed: true });
    expect(calls).not.toContain('install');
  });

  it('installAtlispCore installs when missing', async () => {
    const result = await installAtlispCore();
    expect(result).toMatchObject({ ok: true, installed: true, action: 'installed' });
    expect(calls).toContain('install');
    expect(calls).not.toContain('init');
  });

  it('initAtlispLibrary refuses when core is missing', async () => {
    const result = await initAtlispLibrary();
    expect(result).toMatchObject({ ok: false, action: 'not-installed' });
    expect(calls).not.toContain('init');
  });

  it('getAtlispStatus reflects the current CAD state', async () => {
    ready = true;
    const status = await getAtlispStatus();
    expect(status).toMatchObject({ connected: true, installed: true, ready: true, ok: true });

    mockCad.connected = false;
    const offline = await getAtlispStatus();
    expect(offline).toMatchObject({ connected: false, ready: false, ok: false });
  });

  it('CAD 连接成功事件触发检查，未安装则自动安装并加载函数库', async () => {
    await installAtlispConnectHook();
    expect(typeof mockCad.connectHandler).toBe('function');

    mockCad.connectHandler({
      connection: mockCad, platform: 'AutoCAD', version: '2026', reason: 'connect',
    });

    await vi.waitFor(() => expect(calls).toContain('install'), { timeout: 3000 });
    await vi.waitFor(() => expect(ready).toBe(true), { timeout: 3000 });
    expect(calls).toContain('probe');
    expect(calls).toContain('init');
  });

  it('CAD 连接成功事件在 @lisp 已就绪时只探测、不重复安装', async () => {
    await installAtlispConnectHook();
    ready = true;
    calls = [];

    mockCad.connectHandler({
      connection: mockCad, platform: 'AutoCAD', version: '2026', reason: 'activate',
    });

    await vi.waitFor(() => expect(calls).toContain('probe'), { timeout: 3000 });
    expect(calls).not.toContain('install');
    expect(calls).not.toContain('init');
  });
});
