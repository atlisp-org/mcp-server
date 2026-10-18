// ERROR 日志上报：队列/flush、指纹去重、失败兜底与开关。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  config: {
    errorReportEnabled: true,
    errorReportUrl: 'https://report.test/api/error/report',
    clientId: 'test-client',
    transport: 'http',
    toolProfile: 'full',
  },
  setErrorNotify: vi.fn(),
  cad: {
    connected: true,
    getPlatform: () => 'AutoCAD',
    getVersion: () => '2026.1',
  },
}));

vi.mock('../../src/config.js', () => ({ default: mocks.config }));
vi.mock('../../src/logger.js', () => ({ setErrorNotify: mocks.setErrorNotify }));
vi.mock('../../src/cad.js', () => ({ cad: mocks.cad }));
vi.mock('../../src/constants.js', () => ({
  SERVER_NAME: '@lisp-mcp',
  SERVER_VERSION: '9.9.9',
}));

const reporter = await import('../../src/error-reporter.js');

let fetchMock;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.errorReportEnabled = true;
  fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  await reporter.stopErrorReporter();
  vi.unstubAllGlobals();
});

describe('error-reporter', () => {
  it('start 时把 logger.error 接到 recordError', () => {
    reporter.startErrorReporter();
    expect(mocks.setErrorNotify).toHaveBeenCalledWith(reporter.recordError);
  });

  it('记录后 flush 上报 error/source/context', async () => {
    reporter.startErrorReporter();
    reporter.recordError('relay 连接错误: 502', { code: 'ECONNRESET' });
    expect(await reporter.flushErrorReports()).toBe(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://report.test/api/error/report');
    const body = JSON.parse(opts.body);
    expect(body).toMatchObject({
      error: 'relay 连接错误: 502',
      source: 'atlisp-mcp',
      clientId: 'test-client',
      server: '@lisp-mcp',
      version: '9.9.9',
      occurrences: 1,
    });
    expect(body.context.cad.connected).toBe(true);
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('同一错误在去重窗口内只上报一次', async () => {
    reporter.startErrorReporter();
    reporter.recordError('relay 连接错误: Unexpected server response: 502');
    await reporter.flushErrorReports();
    reporter.recordError('relay 连接错误: Unexpected server response: 502');
    await reporter.flushErrorReports();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('不同错误分别上报', async () => {
    reporter.startErrorReporter();
    reporter.recordError('错误 A: 唯一消息 one');
    reporter.recordError('错误 B: 唯一消息 two');
    expect(await reporter.flushErrorReports()).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('关闭开关后不再上报', async () => {
    mocks.config.errorReportEnabled = false;
    reporter.startErrorReporter();
    reporter.recordError('不应上报');
    expect(await reporter.flushErrorReports()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('上报失败只写 stderr，不抛错也不递归 logger', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValue(new Error('network down'));
    reporter.startErrorReporter();
    reporter.recordError('flush 失败测试消息');
    await expect(reporter.flushErrorReports()).resolves.toBe(1);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('发送失败'));
    consoleSpy.mockRestore();
  });

  it('HTTP 非 2xx 只记录状态码', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValue({ ok: false, status: 502 });
    reporter.startErrorReporter();
    reporter.recordError('HTTP 502 测试消息');
    await reporter.flushErrorReports();
    expect(consoleSpy).toHaveBeenCalledWith('[error-report] HTTP 502');
    consoleSpy.mockRestore();
  });

  it('未启动时记录不会被上报', async () => {
    reporter.recordError('未启动消息');
    expect(await reporter.flushErrorReports()).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('fingerprintError', () => {
  it('抹掉连接 id、数字与耗时，聚合同类错误', () => {
    expect(reporter.fingerprintError('[825e19fa] worker 达到最大请求数 100，准备轮换'))
      .toBe('[id] worker 达到最大请求数 <n>，准备轮换');
    expect(reporter.fingerprintError('[deadbeef] worker 达到最大请求数 100，准备轮换'))
      .toBe(reporter.fingerprintError('[825e19fa] worker 达到最大请求数 100，准备轮换'));
  });
});
