// logger.js 单测：mock config.debugFile 与 homedir 到临时目录，
// 验证 JSON 行日志、debug 开关、notify 回调、请求日志与轮转。
// 注意：logger 用异步 WriteStream 写文件，断言前需 flush 等待落盘；
// 临时目录在整个文件运行期间保留，避免已打开流写入已删除目录触发未捕获异常。
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const TEST_HOME = `/tmp/opencode/logger-test-${process.pid}`;
const DEBUG_FILE = path.join(TEST_HOME, 'debug.log');

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: { ...actual.default, homedir: () => TEST_HOME },
    homedir: () => TEST_HOME,
  };
});

vi.mock('../../src/config.js', () => ({
  default: { debugFile: DEBUG_FILE, debug: false, requestLogEnabled: false },
}));

const logger = await import('../../src/logger.js');
const config = (await import('../../src/config.js')).default;

const REQUEST_LOG_FILE = path.join(TEST_HOME, '@lisp', 'logs', 'requests.log');

// WriteStream 的 open/flush 走线程池，等待落盘
async function flush() {
  await new Promise(r => setTimeout(r, 25));
}

function readDebugLines() {
  if (!fs.existsSync(DEBUG_FILE)) return [];
  return fs.readFileSync(DEBUG_FILE, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function readRequestLines() {
  if (!fs.existsSync(REQUEST_LOG_FILE)) return [];
  return fs.readFileSync(REQUEST_LOG_FILE, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

beforeAll(() => {
  fs.mkdirSync(TEST_HOME, { recursive: true });
});

afterAll(() => {
  logger.closeLog();
  vi.restoreAllMocks();
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  logger.closeLog();
  config.debug = false;
  config.requestLogEnabled = false;
  fs.rmSync(DEBUG_FILE, { force: true });
  fs.rmSync(`${DEBUG_FILE}.1`, { force: true });
});

afterEach(() => {
  logger.closeLog();
  vi.restoreAllMocks();
});

describe('log / error / warn', () => {
  it('写入 JSON 行，包含 level/message/meta/pid/hostname', async () => {
    logger.log('hello', { method: 'GET' });
    logger.error('bad', { code: 500 });
    logger.warn('careful');
    await flush();

    const lines = readDebugLines();
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ level: 'INFO', message: 'hello', method: 'GET', pid: process.pid });
    expect(lines[0].timestamp).toBeTruthy();
    expect(lines[0].hostname).toBeTruthy();
    expect(lines[1]).toMatchObject({ level: 'ERROR', message: 'bad', code: 500 });
    expect(lines[2]).toMatchObject({ level: 'WARN', message: 'careful' });
  });

  it('config.debug=false 时不输出 console', async () => {
    const spies = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'error'),
      vi.spyOn(console, 'warn'),
    ];
    logger.log('m1'); logger.error('m2'); logger.warn('m3');
    await flush();
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it('config.debug=true 时同步输出 console', async () => {
    config.debug = true;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      logger.log('m1', { a: 1 });
      logger.error('m2');
      logger.warn('m3');
      await flush();
      expect(logSpy).toHaveBeenCalledWith('[INFO] m1', { a: 1 });
      expect(errSpy).toHaveBeenCalledWith('[ERROR] m2', {});
      expect(warnSpy).toHaveBeenCalledWith('[WARN] m3', {});
    } finally {
      config.debug = false;
    }
  });
});

describe('debug()', () => {
  it('config.debug=false 不写文件', async () => {
    logger.debug('secret');
    await flush();
    expect(readDebugLines()).toHaveLength(0);
  });

  it('config.debug=true 写入 DEBUG 级别行', async () => {
    config.debug = true;
    try {
      logger.debug('secret', { k: 'v' });
      await flush();
      expect(readDebugLines()).toMatchObject([{ level: 'DEBUG', message: 'secret', k: 'v' }]);
    } finally {
      config.debug = false;
    }
  });
});

describe('日志通知与关闭', () => {
  it('setLoggingNotify 注册后 log/error/warn 触发回调', async () => {
    const fn = vi.fn();
    logger.setLoggingNotify(fn);
    expect(logger.getLoggingNotify()).toBe(fn);
    logger.log('a');
    logger.error('b');
    logger.warn('c');
    await flush();
    expect(fn.mock.calls.map(c => c[0])).toEqual(['info', 'error', 'warning']);
    expect(fn.mock.calls[0][1]).toBe('a');
    logger.setLoggingNotify(null);
  });

  it('notify 回调抛错不影响日志写入', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.setLoggingNotify(() => { throw new Error('cb-fail'); });
    expect(() => logger.log('still-works')).not.toThrow();
    await flush();
    expect(spy).toHaveBeenCalledWith('[logger] notify 回调失败:', 'cb-fail');
    logger.setLoggingNotify(null);
  });

  it('closeLog 结束流并可重新打开', async () => {
    logger.log('first');
    await flush();
    logger.closeLog();
    logger.log('second');
    await flush();
    const lines = readDebugLines();
    expect(lines.map(l => l.message)).toEqual(['first', 'second']);
  });
});

describe('logRequest / logResponse', () => {
  const req = {
    method: 'POST',
    path: '/mcp',
    query: { a: '1' },
    ip: '127.0.0.1',
    get: (h) => (h === 'user-agent' ? 'vitest' : undefined),
  };

  it('requestLogEnabled=false 直接返回', async () => {
    fs.rmSync(REQUEST_LOG_FILE, { force: true });
    logger.logRequest(req);
    logger.logResponse(req, { statusCode: 200 }, 5);
    await flush();
    expect(fs.existsSync(REQUEST_LOG_FILE)).toBe(false);
  });

  it('写入请求与响应日志行', async () => {
    config.requestLogEnabled = true;
    fs.rmSync(REQUEST_LOG_FILE, { force: true });
    try {
      logger.logRequest(req);
      logger.logResponse(req, { statusCode: 201 }, 42);
      await flush();
      const lines = readRequestLines();
      expect(lines[0]).toMatchObject({ method: 'POST', path: '/mcp', query: { a: '1' }, ip: '127.0.0.1', userAgent: 'vitest' });
      expect(lines[1]).toMatchObject({ method: 'POST', path: '/mcp', statusCode: 201, duration: '42ms' });
    } finally {
      config.requestLogEnabled = false;
    }
  });

  it('请求日志取 userAgent 抛错时被容错', async () => {
    config.requestLogEnabled = true;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // 无 get 方法 → userAgent 取值抛错 → 捕获
      logger.logRequest({ method: 'GET', path: '/x', query: {} });
      expect(spy).toHaveBeenCalledWith('request log error:', 'req.get is not a function');
    } finally {
      config.requestLogEnabled = false;
    }
  });
});

describe('日志轮转', () => {
  it('debug 文件超 10MB 时滚动为 .1', async () => {
    logger.log('warm');
    await flush();
    logger.closeLog(); // 断开流，下次 getStream 触发 rotateLog

    fs.writeFileSync(DEBUG_FILE, 'x'.repeat(1024), 'utf-8');
    const origStatSync = fs.statSync.bind(fs);
    vi.spyOn(fs, 'statSync').mockImplementation((p) => {
      if (String(p) === DEBUG_FILE) return { size: 11 * 1024 * 1024 };
      return origStatSync(p);
    });
    const origRename = fs.renameSync.bind(fs);
    vi.spyOn(fs, 'renameSync').mockImplementation((a, b) => {
      if (String(a) === DEBUG_FILE) { origRename(DEBUG_FILE, `${DEBUG_FILE}.1`); return; }
      return origRename(a, b);
    });

    logger.log('after-rotate');
    await flush();
    expect(fs.existsSync(`${DEBUG_FILE}.1`)).toBe(true);
    expect(readDebugLines().map(l => l.message)).toEqual(['after-rotate']);
  });

  it('轮转异常被 console.error 记录', async () => {
    logger.closeLog();
    fs.writeFileSync(DEBUG_FILE, 'x', 'utf-8');
    vi.spyOn(fs, 'statSync').mockImplementation(() => { throw new Error('stat fail'); });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.log('resilient');
    await flush();
    expect(spy).toHaveBeenCalledWith('log rotate error:', 'stat fail');
    // 轮转失败 → 原文件保留，新行追加（此处用子串断言，避免前序内容干扰 JSON 解析）
    expect(fs.readFileSync(DEBUG_FILE, 'utf-8')).toContain('"message":"resilient"');
  });

  it('请求日志超 10MB 时滚动', async () => {
    config.requestLogEnabled = true;
    try {
      const req = { method: 'GET', path: '/x', query: {}, get: () => undefined };
      fs.rmSync(REQUEST_LOG_FILE, { force: true });
      fs.rmSync(`${REQUEST_LOG_FILE}.1`, { force: true });
      logger.logRequest(req); // 创建流
      await flush();
      fs.appendFileSync(REQUEST_LOG_FILE, 'x', 'utf-8');
      const origStatSync = fs.statSync.bind(fs);
      vi.spyOn(fs, 'statSync').mockImplementation((p) => {
        if (String(p) === REQUEST_LOG_FILE) return { size: 11 * 1024 * 1024 };
        return origStatSync(p);
      });
      logger.logRequest(req);
      await flush();
      expect(fs.existsSync(`${REQUEST_LOG_FILE}.1`)).toBe(true);
    } finally {
      config.requestLogEnabled = false;
      vi.restoreAllMocks();
    }
  });
});
