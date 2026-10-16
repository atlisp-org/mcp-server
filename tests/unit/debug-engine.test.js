// debug-engine.js 单测：mock cad，覆盖会话创建校验/淘汰/单步/快进/继续/求值。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockCad = {
  connected: true,
  connect: vi.fn(async () => false),
  sendCommand: vi.fn(async () => ''),
  sendCommandWithResult: vi.fn(async () => 'nil'),
};

vi.mock('../../src/cad.js', () => ({ cad: mockCad }));
vi.mock('../../src/logger.js', () => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  closeLog: vi.fn(),
}));

const dbg = await import('../../src/debug-engine.js');

function chunk(id, extra = {}) {
  return { id, code: `(setq x${id} ${id})`, line: id, ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCad.connected = true;
  mockCad.sendCommandWithResult.mockResolvedValue('nil');
});

afterEach(async () => {
  for (const s of dbg.listSessions()) {
    await dbg.closeSession(s.sessionId).catch(() => {});
  }
});

describe('createSession 校验与淘汰', () => {
  it('chunks 为空抛错', async () => {
    await expect(dbg.createSession('code', [])).rejects.toThrow('Chunks array is empty');
    await expect(dbg.createSession('code', null)).rejects.toThrow('Chunks array is empty');
  });

  it('超过 500 个 chunk 抛错', async () => {
    const chunks = Array.from({ length: 501 }, (_, i) => chunk(i));
    await expect(dbg.createSession('code', chunks)).rejects.toThrow('Too many chunks: 501 (max 500)');
  });

  it('chunk 形状非法抛错', async () => {
    await expect(dbg.createSession('code', [{ id: 'a', code: 'x' }]))
      .rejects.toThrow('Each chunk must have id (number) and code (string)');
    await expect(dbg.createSession('code', [{ id: 1 }]))
      .rejects.toThrow('Each chunk must have id (number) and code (string)');
  });

  it('合法 chunk 创建会话，getSession 可取回', async () => {
    const id = await dbg.createSession('code', [chunk(0), chunk(1)], 'gbk');
    const s = dbg.getSession(id);
    expect(s).toBeInstanceOf(dbg.DebugSession);
    expect(s.totalChunks).toBe(2);
    expect(s.state).toBe('ready');
    expect(s.encoding).toBe('gbk');
    expect(dbg.getSession('nope')).toBeNull();
  });

  it('超过 MAX_SESSIONS 时淘汰最旧会话', async () => {
    const ids = [];
    for (let i = 0; i < 11; i++) {
      ids.push(await dbg.createSession('code', [chunk(i)]));
    }
    expect(dbg.listSessions()).toHaveLength(10);
    expect(dbg.getSession(ids[0])).toBeNull();
    expect(dbg.getSession(ids[10])).not.toBeNull();
  });
});

describe('executeStep', () => {
  it('解析 CAD 返回的 (result ((var value)...)) 快照', async () => {
    const id = await dbg.createSession('code', [chunk(0, { vars: ['x'] }), chunk(1)], 'gbk');
    const s = dbg.getSession(id);
    mockCad.sendCommandWithResult.mockResolvedValue('("42" (("x" "10")))');

    const r1 = await dbg.executeStep(s);
    expect(mockCad.sendCommandWithResult).toHaveBeenCalledWith(expect.stringContaining('(setq x0 0)'), 'gbk');
    expect(r1.done).toBe(false);
    expect(r1.checkpoint).toEqual({
      id: 0, line: 0,
      variables: [{ name: 'x', value: '10' }],
      result: '42',
    });
    expect(s.state).toBe('paused');

    const r2 = await dbg.executeStep(s);
    expect(r2.done).toBe(true);
    expect(s.state).toBe('done');
    expect(r2.finalResult).toBe('42'); // finalResult 为最后原始返回值
  });

  it('vars 为空时变量捕获为 nil', async () => {
    const id = await dbg.createSession('code', [chunk(0)]);
    const s = dbg.getSession(id);
    mockCad.sendCommandWithResult.mockResolvedValue('("1" nil)');
    const r = await dbg.executeStep(s);
    expect(r.checkpoint.variables).toEqual([]);
  });

  it('非法状态抛错', async () => {
    const id = await dbg.createSession('code', [chunk(0)]);
    const s = dbg.getSession(id);
    s.state = 'error';
    await expect(dbg.executeStep(s)).rejects.toThrow('Invalid state: error');
  });

  it('执行已到末尾直接 done', async () => {
    const id = await dbg.createSession('code', [chunk(0)]);
    const s = dbg.getSession(id);
    s.currentIndex = s.totalChunks; // 模拟已执行完
    const r = await dbg.executeStep(s);
    expect(r).toEqual({ done: true, finalResult: null });
    expect(s.state).toBe('done');
  });

  it('CAD 抛错 → 状态 error 并带上下文', async () => {
    const id = await dbg.createSession('code', [chunk(7)]);
    const s = dbg.getSession(id);
    mockCad.sendCommandWithResult.mockRejectedValue(new Error('cad-explode'));
    await expect(dbg.executeStep(s)).rejects.toThrow('Step error at chunk 7: cad-explode');
    expect(s.state).toBe('error');
    expect(s.error).toContain('cad-explode');
  });
});

describe('fastForward', () => {
  it('执行到断点暂停并返回断点信息', async () => {
    const id = await dbg.createSession('code', [chunk(0), chunk(1, { isBreakpoint: true }), chunk(2)]);
    const s = dbg.getSession(id);
    const r = await dbg.fastForward(s);
    expect(mockCad.sendCommandWithResult).toHaveBeenCalledTimes(1);
    expect(r.done).toBe(false);
    expect(r.pausedAt).toEqual({ id: 1, line: 1 });
    expect(s.state).toBe('paused');
    expect(s.currentIndex).toBe(1);
  });

  it('无断点执行到底返回 done', async () => {
    const id = await dbg.createSession('code', [chunk(0), chunk(1)]);
    const s = dbg.getSession(id);
    const r = await dbg.fastForward(s);
    expect(r).toEqual({ done: true, finalResult: null });
    expect(s.state).toBe('done');
  });

  it('chunk 执行失败 → error 状态', async () => {
    const id = await dbg.createSession('code', [chunk(3)]);
    const s = dbg.getSession(id);
    mockCad.sendCommandWithResult.mockRejectedValue(new Error('ff-fail'));
    await expect(dbg.fastForward(s)).rejects.toThrow('Fast-forward error at chunk 3: ff-fail');
    expect(s.state).toBe('error');
  });
});

describe('continueExecution', () => {
  it('遇断点转为单步执行', async () => {
    const id = await dbg.createSession('code', [chunk(0), chunk(1, { isBreakpoint: true }), chunk(2)]);
    const s = dbg.getSession(id);
    mockCad.sendCommandWithResult.mockResolvedValue('("ok" nil)');
    const r = await dbg.continueExecution(s);
    expect(r.done).toBe(false);
    expect(r.checkpoint.id).toBe(1);
  });

  it('无断点直接跑完', async () => {
    const id = await dbg.createSession('code', [chunk(0), chunk(1)]);
    const s = dbg.getSession(id);
    const r = await dbg.continueExecution(s);
    expect(r.done).toBe(true);
    expect(s.state).toBe('done');
  });

  it('非法状态抛错，chunk 失败进入 error', async () => {
    const id = await dbg.createSession('code', [chunk(0)]);
    const s = dbg.getSession(id);
    s.state = 'running';
    await expect(dbg.continueExecution(s)).rejects.toThrow('Invalid state: running');

    s.state = 'paused';
    s.currentIndex = 0;
    mockCad.sendCommandWithResult.mockRejectedValue(new Error('cont-fail'));
    await expect(dbg.continueExecution(s)).rejects.toThrow('Continue error at chunk 0: cont-fail');
  });
});

describe('evaluateExpression / loadHelpers / closeSession', () => {
  it('仅 paused 状态可求值，成功返回 value', async () => {
    const id = await dbg.createSession('code', [chunk(0)]);
    const s = dbg.getSession(id);
    await expect(dbg.evaluateExpression(s, '(+ 1 2)')).rejects.toThrow('Invalid state: ready');

    s.state = 'paused';
    mockCad.sendCommandWithResult.mockResolvedValue('"3"');
    expect(await dbg.evaluateExpression(s, '(+ 1 2)')).toEqual({ value: '"3"' });
    expect(mockCad.sendCommandWithResult).toHaveBeenCalledWith('(vl-prin1-to-string (+ 1 2))', null);
  });

  it('CAD 求值失败返回 error 字段而不抛出', async () => {
    const id = await dbg.createSession('code', [chunk(0)]);
    const s = dbg.getSession(id);
    s.state = 'paused';
    mockCad.sendCommandWithResult.mockRejectedValue(new Error('bad expr'));
    expect(await dbg.evaluateExpression(s, '(oops)')).toEqual({ error: 'CAD error: bad expr' });
  });

  it('CAD 未连接时 loadHelpers 抛出连接错误', async () => {
    mockCad.connected = false;
    await expect(dbg.loadHelpers({})).rejects.toThrow('CAD 未连接');
  });

  it('loadHelpers 下发 helper defuns；sendCommand 失败时包装错误', async () => {
    await dbg.loadHelpers({});
    expect(mockCad.sendCommand).toHaveBeenCalledWith(expect.stringContaining('@::dbg/exec-chunk'));

    mockCad.sendCommand.mockRejectedValueOnce(new Error('helper-fail'));
    await expect(dbg.loadHelpers({})).rejects.toThrow('Failed to load debug helpers: helper-fail');
  });

  it('closeSession 发送清理代码并返回 true；未知会话返回 false', async () => {
    const id = await dbg.createSession('code', [chunk(0)]);
    expect(await dbg.closeSession(id)).toBe(true);
    expect(mockCad.sendCommand).toHaveBeenCalledWith(expect.stringContaining('@::dbg/result'));
    expect(dbg.getSession(id)).toBeNull();
    expect(await dbg.closeSession(id)).toBe(false);
  });

  it('清理代码执行失败仅告警', async () => {
    const id = await dbg.createSession('code', [chunk(0)]);
    mockCad.sendCommand.mockRejectedValueOnce(new Error('cleanup-fail'));
    expect(await dbg.closeSession(id)).toBe(true);
    const { log } = await import('../../src/logger.js');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('cleanup-fail'));
  });
});
