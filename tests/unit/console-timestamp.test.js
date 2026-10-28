// console-timestamp.js 单测：验证 console.log/info/warn/error 的首个字符串参数
// 被前置本地时间戳，非字符串参数不受影响，幂等，可恢复。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enableConsoleTimestamp, disableConsoleTimestamp } from '../../src/console-timestamp.js';

const METHODS = ['log', 'info', 'warn', 'error'];
const TIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} /;

describe('console-timestamp', () => {
  const originals = {};
  const spies = {};

  beforeEach(() => {
    for (const m of METHODS) {
      originals[m] = console[m];
      spies[m] = vi.fn();
      console[m] = spies[m];
    }
  });

  afterEach(() => {
    disableConsoleTimestamp();
    for (const m of METHODS) {
      console[m] = originals[m];
    }
  });

  it('首个字符串参数前置 本地时间戳，原内容保留', () => {
    enableConsoleTimestamp();
    console.log('hello');
    expect(spies.log).toHaveBeenCalledTimes(1);
    const [first] = spies.log.mock.calls[0];
    expect(first).toMatch(TIME_RE);
    expect(first.endsWith('hello')).toBe(true);
  });

  it('四个方法（log/info/warn/error）都生效', () => {
    enableConsoleTimestamp();
    console.log('a');
    console.info('b');
    console.warn('c');
    console.error('d');
    for (const m of METHODS) {
      expect(spies[m].mock.calls[0][0]).toMatch(TIME_RE);
    }
  });

  it('非字符串首参（对象/错误）原样透传，不加前缀', () => {
    enableConsoleTimestamp();
    const obj = { k: 1 };
    const err = new Error('boom');
    console.log(obj, 'tail');
    console.error(err);
    expect(spies.log.mock.calls[0][0]).toBe(obj);
    expect(spies.log.mock.calls[0][1]).toBe('tail');
    expect(spies.error.mock.calls[0][0]).toBe(err);
  });

  it('多行字符串只在开头加一次时间戳', () => {
    enableConsoleTimestamp();
    console.log('line1\nline2\nline3');
    const [first] = spies.log.mock.calls[0];
    expect(first).toMatch(TIME_RE);
    expect(first).toContain('line1\nline2\nline3');
  });

  it('重复 enable 幂等，不会叠加双前缀', () => {
    enableConsoleTimestamp();
    enableConsoleTimestamp();
    console.log('x');
    const [first] = spies.log.mock.calls[0];
    expect(first).toMatch(new RegExp(`^${TIME_RE.source}`));
    expect(first.match(new RegExp(TIME_RE.source, 'g'))).toHaveLength(1);
  });

  it('disable 恢复原始 console 行为', () => {
    const before = console.log;
    enableConsoleTimestamp();
    expect(console.log).not.toBe(before);
    disableConsoleTimestamp();
    expect(console.log).toBe(before);
  });
});
