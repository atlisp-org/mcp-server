import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/logger.js', () => ({ log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), closeLog: vi.fn() }));

const { setNotify, subscribe, unsubscribe, list, isSubscribed, notify, clear, size, sessionManager } = await import('../src/subscription-manager.js');

describe('subscription-manager', () => {
  beforeEach(() => { clear(); });

  it('subscribe returns true with sessionId', () => {
    sessionManager.createSession('s1');
    expect(subscribe('atlisp://resource/layer/0', 's1')).toBe(true);
  });

  it('subscribe returns true without sessionId', () => {
    expect(subscribe('atlisp://resource/layer/0')).toBe(true);
  });

  it('unsubscribe returns true', () => {
    sessionManager.createSession('s1');
    subscribe('uri', 's1');
    expect(unsubscribe('uri', 's1')).toBe(true);
  });

  it('isSubscribed returns false for unsubscribed', () => {
    sessionManager.createSession('s1');
    expect(isSubscribed('uri', 's1')).toBe(false);
  });

  it('isSubscribed returns true after subscribing', () => {
    sessionManager.createSession('s1');
    subscribe('uri', 's1');
    expect(isSubscribed('uri', 's1')).toBe(true);
  });

  it('prefix subscription matches child URIs', () => {
    sessionManager.createSession('s1');
    subscribe('atlisp://resource/layer/', 's1');
    expect(isSubscribed('atlisp://resource/layer/0', 's1')).toBe(true);
    expect(isSubscribed('atlisp://resource/layer/1', 's1')).toBe(true);
    expect(isSubscribed('atlisp://resource/other', 's1')).toBe(false);
  });

  it('isSubscribed checks all sessions without sessionId', () => {
    sessionManager.createSession('s1');
    subscribe('uri', 's1');
    expect(isSubscribed('uri')).toBe(true);
  });

  it('list returns subscriptions for a session', () => {
    sessionManager.createSession('s1');
    subscribe('uri1', 's1');
    subscribe('uri2', 's1');
    expect(list('s1')).toEqual(expect.arrayContaining(['uri1', 'uri2']));
  });

  it('notify calls the notify function', () => {
    const fn = vi.fn();
    setNotify(fn);
    notify('uri', { test: true });
    expect(fn).toHaveBeenCalledWith('uri', { test: true });
  });

  it('notify handles no function set', () => {
    setNotify(null);
    expect(() => notify('uri', {})).not.toThrow();
  });

  it('clear empties all subscriptions', () => {
    sessionManager.createSession('s1');
    subscribe('uri', 's1');
    clear();
    expect(size()).toBe(0);
  });
});
