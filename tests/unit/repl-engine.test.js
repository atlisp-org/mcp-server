import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/cad.js', () => ({
  cad: {
    sendCommandWithResult: vi.fn().mockResolvedValue('(setq result ok)'),
  },
}));

vi.mock('../../src/lint-analyzer.js', () => ({
  analyzeLispCode: vi.fn().mockReturnValue({ valid: true, errors: [] }),
}));

const importRepl = () => import('../../src/repl-engine.js');

describe('repl-engine', () => {
  let repl;
  let cadMock;

  beforeEach(async () => {
    vi.resetModules();
    repl = await importRepl();
    const cadMod = await import('../../src/cad.js');
    cadMock = cadMod.cad.sendCommandWithResult;
    cadMock.mockClear().mockResolvedValue('42');
  });

  it('createSession 返回会话 ID 且可获取', () => {
    const id = repl.createSession();
    expect(id).toBeTruthy();
    expect(repl.getSession(id)).toBeTruthy();
    expect(repl.getSession(id).sessionId).toBe(id);
    expect(repl.getSession('nonexistent')).toBeNull();
  });

  it('executeInSession 执行代码并记录历史与 setq 变量', async () => {
    const { sessionId } = await repl.executeInSession(null, '(setq x (+ 1 2))');
    expect(cadMock).toHaveBeenCalledWith('(setq x (+ 1 2))');
    const session = repl.getSession(sessionId);
    expect(session.history).toHaveLength(1);
    expect(session.history[0].code).toBe('(setq x (+ 1 2))');
    expect(session.variables.get("x")).toBe("42");
  });

  it('未知 sessionId 自动创建新会话', async () => {
    const { sessionId } = await repl.executeInSession('ghost-session', '(princ "hi")');
    expect(sessionId).not.toBe('ghost-session');
    expect(repl.getSession(sessionId)).toBeTruthy();
  });

  it('lint 不通过的代码抛出安全错误且不发送 CAD', async () => {
    const lintMod = await import('../../src/lint-analyzer.js');
    lintMod.analyzeLispCode.mockReturnValueOnce({
      valid: false,
      errors: [{ line: 1, rule: 'quit_exit', message: '禁止 quit' }],
    });

    await expect(repl.executeInSession(null, '(quit)')).rejects.toThrow(/代码存在安全问题.*quit_exit/s);
    expect(cadMock).not.toHaveBeenCalled();
  });

  it('parseSetq 捕获多个变量（含命名空间与单字符形式）', () => {
    const session = new repl.ReplSession('s-parse');
    session.parseSetq('(setq a 1)(setq b:c 2)(setq x 3)', 'R');
    expect(session.variables.get('a')).toBe('R');
    expect(session.variables.get('b:c')).toBe('R');
    expect(session.variables.get('x')).toBe('R');
    // 数字开头的非法变量名不匹配
    session.parseSetq('(setq 9bad 1)', 'R2');
    expect(session.variables.has('9bad')).toBe(false);
  });

  it('getHistory 返回历史数组，未知会话返回 null', async () => {
    const { sessionId } = await repl.executeInSession(null, '(princ 1)');
    expect(repl.getHistory(sessionId)).toHaveLength(1);
    expect(repl.getHistory('nope')).toBeNull();
  });

  it('listSessions 输出概要信息', async () => {
    const { sessionId } = await repl.executeInSession(null, '(setq v 1)');
    const list = repl.listSessions();
    expect(list).toHaveLength(1);
    expect(list[0].sessionId).toBe(sessionId);
    expect(list[0].historyCount).toBe(1);
    expect(list[0].variables.v).toBe("42");
    expect(typeof list[0].createdAt).toBe('number');
  });

  it('closeSession 关闭已有会话，重复关闭返回 false', async () => {
    const { sessionId } = await repl.executeInSession(null, '(princ 1)');
    expect(repl.closeSession(sessionId)).toBe(true);
    expect(repl.getSession(sessionId)).toBeNull();
    expect(repl.closeSession(sessionId)).toBe(false);
  });

  it('超过 MAX_SESSIONS 时淘汰最久活跃的会话', async () => {
    const first = repl.createSession();
    for (let i = 0; i < 49; i++) repl.createSession();
    expect(repl.listSessions()).toHaveLength(50);

    // 第 51 个创建后最旧的被淘汰
    repl.createSession();
    expect(repl.listSessions()).toHaveLength(50);
    expect(repl.getSession(first)).toBeNull();
  });

  it('历史条数有上限，超出的旧条目被淘汰', async () => {
    const config = (await import('../../src/config.js')).default;
    const max = config.replHistoryMax;
    const { sessionId } = await repl.executeInSession(null, '(setq x 1)');
    const last = max + 19;
    for (let i = 0; i < max + 20; i++) {
      await repl.executeInSession(sessionId, `(setq x ${i})`);
    }
    const history = repl.getHistory(sessionId);
    expect(history).toHaveLength(max);
    expect(history[history.length - 1].code).toBe(`(setq x ${last})`);
  });

  it('超长结果入库时截断，但返回值仍是完整结果', async () => {
    const config = (await import('../../src/config.js')).default;
    const long = 'r'.repeat(config.replResultMaxChars + 500);
    cadMock.mockResolvedValueOnce(long);
    const { sessionId, result } = await repl.executeInSession(null, '(setq big 1)');
    expect(result).toBe(long);
    const entry = repl.getHistory(sessionId)[0];
    expect(entry.result.length).toBe(config.replResultMaxChars);
    expect(entry.truncated).toBe(true);
  });
});
