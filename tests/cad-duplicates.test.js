import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();
const mockCad = { connected: true, sendCommandWithResult: mockSend };

vi.mock('../src/cad.js', () => ({ cad: mockCad }));
vi.mock('../src/logger.js', () => ({
  log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), closeLog: vi.fn(),
}));
vi.mock('../src/handlers/resource-utils.js', () => ({
  ensureCad: vi.fn(async () => {}),
}));

const { cadDuplicates } = await import('../src/handlers/analysis-handlers.js');

describe('cadDuplicates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue('重复实体组: 2（最多显示 50 组；tol=0.000001）\\nLINE => ("A1" "A2")');
  });

  it('返回确定性分组文本', async () => {
    const result = await cadDuplicates({});
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('重复实体组: 2');
    expect(result.content[0].text).toContain('A1');
  });

  it('生成只读扫描代码，不删除任何实体', async () => {
    await cadDuplicates({});
    const lisp = mockSend.mock.calls[0][0];
    expect(lisp).toContain('@dup:key');
    expect(lisp).toContain('(ssget "_X")');
    expect(lisp).not.toContain('entdel');
  });

  it('type 过滤会进入 ssget 过滤器，tolerance/maxGroups 进入代码', async () => {
    await cadDuplicates({ types: ['line', 'circle'], tolerance: 0.001, maxGroups: 10 });
    const lisp = mockSend.mock.calls[0][0];
    expect(lisp).toContain('(cons 0 "LINE")');
    expect(lisp).toContain('(cons 0 "CIRCLE")');
    expect(lisp).toContain('tol 0.001');
    expect(lisp).toContain('最多显示 10 组');
  });

  it('CAD 异常返回错误而不是抛异常', async () => {
    mockSend.mockRejectedValueOnce(new Error('boom'));
    const result = await cadDuplicates({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('boom');
  });
});
