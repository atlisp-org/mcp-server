// audit-log.js 单测：mock homedir 到临时目录用真实文件系统，
// 覆盖写入/查询过滤/统计/轮转/压缩失败等分支。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const TEST_HOME = `/tmp/opencode/audit-test-${process.pid}`;

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: { ...actual.default, homedir: () => TEST_HOME },
    homedir: () => TEST_HOME,
  };
});

vi.mock('../../src/logger.js', () => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  closeLog: vi.fn(),
}));

const {
  writeAuditEntry, queryAuditLog, getAuditStats, AUDIT_FILE,
} = await import('../../src/audit-log.js');
const { error: logError } = await import('../../src/logger.js');

const LOG_DIR = path.join(TEST_HOME, '@lisp', 'logs');

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('writeAuditEntry', () => {
  it('写入 JSON 行并补全缺省字段', () => {
    writeAuditEntry({ tool: 'draw_line', args: { x: 1 }, duration: 12 });
    const lines = fs.readFileSync(AUDIT_FILE, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.tool).toBe('draw_line');
    expect(entry.args).toEqual({ x: 1 });
    expect(entry.duration).toBe(12);
    expect(entry.timestamp).toBeTruthy();
    expect(entry.sessionId).toBe('');
    expect(entry.result).toBeNull();
    expect(entry.error).toBeNull();
  });

  it('写入失败被容错（记录日志不抛出）', () => {
    vi.spyOn(fs, 'appendFileSync').mockImplementation(() => { throw new Error('disk full'); });
    expect(() => writeAuditEntry({ tool: 't' })).not.toThrow();
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('disk full'));
  });
});

describe('queryAuditLog', () => {
  beforeEach(() => {
    writeAuditEntry({ tool: 'draw_line', result: 'ok', user: 'alice', sessionId: 's1', timestamp: '2026-01-01T00:00:00.000Z' });
    writeAuditEntry({ tool: 'batch_delete', result: 'error', error: 'boom', user: 'bob', sessionId: 's2', timestamp: '2026-01-02T00:00:00.000Z' });
    writeAuditEntry({ tool: 'draw_line', result: 'ok', user: 'bob', sessionId: 's3', timestamp: '2026-01-03T00:00:00.000Z' });
  });

  it('文件不存在时返回空结果', () => {
    fs.rmSync(AUDIT_FILE, { force: true });
    expect(queryAuditLog()).toEqual({ total: 0, offset: 0, count: 0, entries: [] });
  });

  it('按时间倒序返回全部条目', () => {
    const { total, entries } = queryAuditLog();
    expect(total).toBe(3);
    expect(entries.map(e => e.tool)).toEqual(['draw_line', 'batch_delete', 'draw_line']);
  });

  it('按 tool / result / user / sessionId 过滤', () => {
    expect(queryAuditLog({ tool: 'draw_line' }).total).toBe(2);
    expect(queryAuditLog({ result: 'error' }).total).toBe(1);
    expect(queryAuditLog({ user: 'bob' }).total).toBe(2);
    expect(queryAuditLog({ sessionId: 's1' }).entries[0].tool).toBe('draw_line');
  });

  it('按日期范围过滤', () => {
    const r = queryAuditLog({ fromDate: '2026-01-02', toDate: '2026-01-02T23:59:59.999Z' });
    expect(r.total).toBe(1);
    expect(r.entries[0].tool).toBe('batch_delete');
  });

  it('offset/limit 分页', () => {
    const r = queryAuditLog({ offset: 1, limit: 1 });
    expect(r.total).toBe(3);
    expect(r.offset).toBe(1);
    expect(r.count).toBe(1);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].tool).toBe('batch_delete');
  });

  it('损坏的 JSON 行被跳过', () => {
    fs.appendFileSync(AUDIT_FILE, 'not-json\n', 'utf-8');
    expect(queryAuditLog().total).toBe(3);
  });
});

describe('getAuditStats', () => {
  it('文件不存在时返回零统计', () => {
    expect(getAuditStats()).toEqual({ totalEntries: 0, tools: {}, errors: 0 });
  });

  it('统计工具调用次数、错误数与文件大小', () => {
    writeAuditEntry({ tool: 'a', result: 'ok' });
    writeAuditEntry({ tool: 'a', error: 'x' });
    writeAuditEntry({ tool: 'b' });
    fs.appendFileSync(AUDIT_FILE, 'broken-line\n', 'utf-8');

    const stats = getAuditStats();
    expect(stats.totalEntries).toBe(4); // 含损坏行（按行计数）
    expect(stats.tools).toEqual({ a: 2, b: 1 });
    expect(stats.errors).toBe(1);
    expect(stats.fileSize).toBeGreaterThan(0);
    expect(stats.filePath).toBe(AUDIT_FILE);
  });
});

describe('日志轮转', () => {
  it('超过 10MB 时重命名为时间戳文件并 gzip 压缩', () => {
    writeAuditEntry({ tool: 'before-rotate' });
    const origStatSync = fs.statSync.bind(fs);
    vi.spyOn(fs, 'statSync').mockImplementation((p) => {
      if (String(p) === AUDIT_FILE) return { size: 11 * 1024 * 1024 };
      return origStatSync(p);
    });

    writeAuditEntry({ tool: 'after-rotate' });

    const files = fs.readdirSync(LOG_DIR);
    expect(files.some(f => /^audit\.\d+\.log\.gz$/.test(f))).toBe(true);
    expect(files.some(f => f === 'audit.log')).toBe(true); // 轮转后继续写新文件

    const gz = files.find(f => /^audit\.\d+\.log\.gz$/.test(f));
    const content = zlib.gunzipSync(fs.readFileSync(path.join(LOG_DIR, gz))).toString('utf-8');
    expect(content).toContain('"tool":"before-rotate"');
  });

  it('gzip 压缩失败时清理残留压缩文件并记录日志', () => {
    writeAuditEntry({ tool: 'before-rotate' });
    const origStatSync = fs.statSync.bind(fs);
    vi.spyOn(fs, 'statSync').mockImplementation((p) => {
      if (String(p) === AUDIT_FILE) return { size: 11 * 1024 * 1024 };
      return origStatSync(p);
    });
    vi.spyOn(zlib, 'gzipSync').mockImplementation(() => { throw new Error('gzip broken'); });

    writeAuditEntry({ tool: 'after-rotate' });

    const files = fs.readdirSync(LOG_DIR);
    expect(files.some(f => f.endsWith('.gz'))).toBe(false);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('compression failed'));
  });

  it('轮转过程异常被容错', () => {
    writeAuditEntry({ tool: 'x' });
    const origStatSync = fs.statSync.bind(fs);
    vi.spyOn(fs, 'statSync').mockImplementation((p) => {
      if (String(p) === AUDIT_FILE) return { size: 11 * 1024 * 1024 };
      return origStatSync(p);
    });
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('rename fail'); });
    expect(() => writeAuditEntry({ tool: 'y' })).not.toThrow();
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('rotation error'));
  });
});
