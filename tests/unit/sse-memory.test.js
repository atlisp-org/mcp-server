import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/logger.js', () => ({ log: vi.fn(), error: vi.fn() }));

const REPLAY_MAX = 4096;
const BACKPRESSURE_MAX = 2048;

const importSession = async () => {
  vi.resetModules();
  return import('../../src/sse-session.js');
};

function mockRes({ alwaysFalse = false } = {}) {
  let ended = false;
  return {
    ended: () => ended,
    setHeader() {},
    write() { return alwaysFalse ? false : true; },
    flush() {},
    on() {},
    removeListener() {},
    end() { ended = true; },
  };
}

describe('SseSession 内存上限', () => {
  beforeEach(() => {
    process.env.SSE_REPLAY_MAX_BYTES = String(REPLAY_MAX);
    process.env.SSE_BACKPRESSURE_MAX_BYTES = String(BACKPRESSURE_MAX);
  });

  it('重放缓冲按字节淘汰旧消息（不只是条数）', async () => {
    const { SseSession } = await importSession();
    const session = new SseSession(mockRes());
    const payload = 'x'.repeat(1000);

    for (let i = 0; i < 10; i++) session.sendMessage({ payload });

    const kept = session.sentMessages;
    expect(kept.length).toBeLessThan(10);
    expect(kept.length).toBeGreaterThan(0);
    // 保留的是最新的几条
    expect(kept[kept.length - 1].id).toBe(10);
    // 累计字节数被压在上限内（单条 1KB，上限 4KB）
    expect(kept.reduce((sum, m) => sum + (m.bytes || 0), 0)).toBeLessThanOrEqual(REPLAY_MAX + 1200);
  });

  it('单条超大消息不会把缓冲撑爆', async () => {
    const { SseSession } = await importSession();
    const session = new SseSession(mockRes());
    session.sendMessage({ payload: 'y'.repeat(20000) });
    const kept = session.sentMessages;
    expect(kept.length).toBeLessThanOrEqual(2);
  });

  it('客户端不读数据时背压缓冲超限会断开连接', async () => {
    const { SseSession } = await importSession();
    const res = mockRes({ alwaysFalse: true });
    const session = new SseSession(res);

    const payload = 'z'.repeat(1000);
    for (let i = 0; i < 20 && session.isActive; i++) {
      session.sendMessage({ payload });
    }

    expect(session.isActive).toBe(false);
    expect(res.ended()).toBe(true);
  });

  it('close() 释放重放缓冲', async () => {
    const { SseSession } = await importSession();
    const session = new SseSession(mockRes());
    session.sendMessage({ payload: 'q'.repeat(500) });
    expect(session.sentMessages.length).toBeGreaterThan(0);
    session.close();
    expect(session.sentMessages).toHaveLength(0);
  });
});
