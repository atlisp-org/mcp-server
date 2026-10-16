// mem-monitor.js 单测：startLocalMemWatcher 阈值输出逻辑（fake timers）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startLocalMemWatcher, formatDelta } from '../../src/mem-monitor.js';

const MB = 1024 * 1024;

describe('formatDelta', () => {
  it('正/负/零/非法值', () => {
    expect(formatDelta(3.45)).toBe('+3.5 MB');
    expect(formatDelta(-1.24)).toBe('-1.2 MB');
    expect(formatDelta(0)).toBe('0.0 MB');
    expect(formatDelta(null)).toBe('--');
    expect(formatDelta(NaN)).toBe('--');
  });
});

describe('startLocalMemWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function mockMem(readings) {
    return vi.spyOn(process, 'memoryUsage').mockImplementation(() => readings.shift());
  }

  it('首次采样无基线不输出', () => {
    const write = vi.fn();
    const stop = startLocalMemWatcher({ intervalMs: 1000, write });
    mockMem([{ rss: 100 * MB, heapUsed: 50 * MB }]);
    vi.advanceTimersByTime(1000);
    expect(write).not.toHaveBeenCalled();
    stop();
  });

  it('变化低于阈值不输出', () => {
    const write = vi.fn();
    const stop = startLocalMemWatcher({ intervalMs: 1000, thresholdMB: 1, write });
    mockMem([
      { rss: 100 * MB, heapUsed: 50 * MB },
      { rss: 100 * MB + 419430, heapUsed: 50 * MB + 102400 }, // +0.4MB / +0.1MB
    ]);
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    expect(write).not.toHaveBeenCalled();
    stop();
  });

  it('RSS 变化超过阈值时输出一行', () => {
    const write = vi.fn();
    const stop = startLocalMemWatcher({ intervalMs: 1000, thresholdMB: 1, write });
    mockMem([
      { rss: 100 * MB, heapUsed: 50 * MB },
      { rss: 105 * MB, heapUsed: 50 * MB }, // +5MB
    ]);
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toBe('[内存] RSS 100.0→105.0 MB (+5.0 MB)   堆 50.0→50.0 MB (0.0 MB)');
    stop();
  });

  it('堆变化超过阈值（RSS 不变）也输出', () => {
    const write = vi.fn();
    const stop = startLocalMemWatcher({ intervalMs: 1000, thresholdMB: 1, write });
    mockMem([
      { rss: 100 * MB, heapUsed: 50 * MB },
      { rss: 100 * MB, heapUsed: 48 * MB }, // -2MB
    ]);
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toContain('堆 50.0→48.0 MB (-2.0 MB)');
    stop();
  });
});
