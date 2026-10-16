// cad-event-bus.js 单测：mock cad 模块，用假 res 对象驱动 SSE 订阅/心跳/广播。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockCad = {
  connected: false,
  getPlatform: vi.fn(() => 'AutoCAD'),
  getVersion: vi.fn(() => '2024'),
};

let documentChangedCb = null;

vi.mock('../../src/cad.js', () => ({
  cad: mockCad,
  onDocumentChanged: (cb) => { documentChangedCb = cb; },
}));

vi.mock('../../src/logger.js', () => ({
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  closeLog: vi.fn(),
}));

const { subscribeEvents, unsubscribeEvents, getEventSubscribers } = await import('../../src/cad-event-bus.js');
const { error: logError } = await import('../../src/logger.js');

function makeRes({ throwOnWrite = false, throwOnEnd = false } = {}) {
  const handlers = {};
  return {
    statusCode: null,
    headers: null,
    written: [],
    ended: false,
    throwOnWrite,
    writeHead(status, headers) { this.statusCode = status; this.headers = headers; },
    write(chunk) {
      if (this.throwOnWrite) throw new Error('write broken');
      this.written.push(chunk);
      return true;
    },
    on(ev, cb) { handlers[ev] = cb; },
    emit(ev) { handlers[ev]?.(); },
    end() {
      if (throwOnEnd) throw new Error('end broken');
      this.ended = true;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockCad.connected = false;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('subscribeEvents / unsubscribeEvents', () => {
  it('设置 SSE 响应头并注册订阅者', () => {
    const res = makeRes();
    subscribeEvents('s1', res);
    expect(res.statusCode).toBe(200);
    expect(res.headers).toEqual({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    expect(getEventSubscribers()).toEqual([
      { sessionId: 's1', createdAt: expect.any(String) },
    ]);
    unsubscribeEvents('s1');
  });

  it('CAD 已连接时立即推送 cadConnected 事件', () => {
    mockCad.connected = true;
    const res = makeRes();
    subscribeEvents('s2', res);
    expect(res.written.some(w => w.startsWith('event: cadConnected'))).toBe(true);
    const payload = JSON.parse(res.written[0].split('data: ')[1]);
    expect(payload.platform).toBe('AutoCAD');
    expect(payload.version).toBe('2024');
    unsubscribeEvents('s2');
  });

  it('重复订阅同一 sessionId 时结束旧连接（防定时器/res 泄漏）', () => {
    const res1 = makeRes();
    const res2 = makeRes();
    subscribeEvents('dup', res1);
    subscribeEvents('dup', res2);
    expect(res1.ended).toBe(true);
    expect(getEventSubscribers()).toHaveLength(1);
    unsubscribeEvents('dup');
  });

  it('unsubscribeEvents 结束响应并移除；未知 id 无操作', () => {
    const res = makeRes();
    subscribeEvents('s3', res);
    unsubscribeEvents('s3');
    expect(res.ended).toBe(true);
    expect(getEventSubscribers()).toEqual([]);
    expect(() => unsubscribeEvents('never-existed')).not.toThrow();
  });

  it('客户端 close 事件自动清理订阅', () => {
    const res = makeRes();
    subscribeEvents('s4', res);
    res.emit('close');
    expect(getEventSubscribers()).toEqual([]);
  });
});

describe('心跳与连接状态切换', () => {
  it('每 15s 发送 heartbeat', () => {
    const res = makeRes();
    subscribeEvents('hb', res);
    const before = res.written.filter(w => w.startsWith('event: heartbeat')).length;
    vi.advanceTimersByTime(15000);
    const after = res.written.filter(w => w.startsWith('event: heartbeat')).length;
    expect(after).toBe(before + 1);
    unsubscribeEvents('hb');
  });

  it('心跳检测到连接状态翻转时广播 cadConnected/cadDisconnected', () => {
    const resA = makeRes();
    const resB = makeRes();
    subscribeEvents('a', resA);
    subscribeEvents('b', resB);

    mockCad.connected = true;
    vi.advanceTimersByTime(15000);
    expect(resA.written.some(w => w.startsWith('event: cadConnected'))).toBe(true);
    expect(resB.written.some(w => w.startsWith('event: cadConnected'))).toBe(true);

    mockCad.connected = false;
    vi.advanceTimersByTime(15000);
    expect(resA.written.some(w => w.startsWith('event: cadDisconnected'))).toBe(true);

    unsubscribeEvents('a');
    unsubscribeEvents('b');
  });

  it('订阅者被替换后旧 heartbeat 定时器自动退出', () => {
    const resOld = makeRes();
    subscribeEvents('swap', resOld);
    const resNew = makeRes();
    subscribeEvents('swap', resNew); // 旧定时器 clearInterval
    resOld.written.length = 0;
    vi.advanceTimersByTime(15000);
    // 旧 res 不应再收到 heartbeat
    expect(resOld.written.filter(w => w.startsWith('event: heartbeat'))).toHaveLength(0);
    unsubscribeEvents('swap');
  });
});

describe('documentChanged 广播', () => {
  it('cad 文档变更回调向所有订阅者广播', () => {
    expect(typeof documentChangedCb).toBe('function');
    const res1 = makeRes();
    const res2 = makeRes();
    subscribeEvents('d1', res1);
    subscribeEvents('d2', res2);

    documentChangedCb({ docName: 'plan.dwg', docPath: '/tmp/plan.dwg' });
    for (const res of [res1, res2]) {
      const evt = res.written.find(w => w.startsWith('event: documentChanged'));
      expect(evt).toBeTruthy();
      const data = JSON.parse(evt.split('data: ')[1]);
      expect(data.docName).toBe('plan.dwg');
      expect(data.docPath).toBe('/tmp/plan.dwg');
      expect(data.timestamp).toBeTruthy();
    }
    unsubscribeEvents('d1');
    unsubscribeEvents('d2');
  });

  it('缺省 docName/docPath 用空串', () => {
    const res = makeRes();
    subscribeEvents('d3', res);
    documentChangedCb({});
    const evt = res.written.find(w => w.startsWith('event: documentChanged'));
    expect(JSON.parse(evt.split('data: ')[1]).docName).toBe('');
    unsubscribeEvents('d3');
  });

  it('res.write 抛错的订阅者被自动移除；res.end 抛错被容错', () => {
    const bad = makeRes({ throwOnWrite: true });
    const good = makeRes();
    subscribeEvents('bad', bad);
    subscribeEvents('good', good);

    documentChangedCb({ docName: 'x.dwg' });
    expect(getEventSubscribers().map(s => s.sessionId)).toEqual(['good']);

    // unsubscribe 时 res.end 抛错也应被容错
    const res2 = makeRes({ throwOnEnd: true });
    subscribeEvents('enderr', res2);
    unsubscribeEvents('enderr');
    expect(logError).toHaveBeenCalled();
    expect(getEventSubscribers().map(s => s.sessionId)).toEqual(['good']);
  });
});
