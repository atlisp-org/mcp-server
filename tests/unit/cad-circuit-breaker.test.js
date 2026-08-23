import { describe, it, expect, vi, afterEach } from 'vitest';
import { CircuitBreaker } from '../../src/cad-circuit-breaker.js';

describe('CircuitBreaker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('初始状态为关闭，允许请求', () => {
    const cb = new CircuitBreaker('conn-1');
    expect(cb.state).toBe(0);
    expect(cb.allowRequest()).toBe(true);
  });

  it('失败未达阈值时保持关闭', () => {
    const onOpen = vi.fn();
    const cb = new CircuitBreaker('conn-1', onOpen);
    for (let i = 0; i < 4; i++) cb.recordFailure();
    expect(cb.failureCount).toBe(4);
    expect(cb.state).toBe(0);
    expect(onOpen).not.toHaveBeenCalled();
    expect(cb.allowRequest()).toBe(true);
  });

  it('达到阈值（5 次）后熔断打开并触发 onOpen', () => {
    const onOpen = vi.fn();
    const cb = new CircuitBreaker('conn-1', onOpen);
    for (let i = 0; i < 5; i++) cb.recordFailure();
    expect(cb.state).toBe(1);
    expect(onOpen).toHaveBeenCalledWith('conn-1');
    expect(cb.allowRequest()).toBe(false);
  });

  it('重置超时后进入半开状态并允许请求', () => {
    vi.useFakeTimers();
    const onHalfOpen = vi.fn();
    const cb = new CircuitBreaker('conn-1', null, onHalfOpen);
    for (let i = 0; i < 5; i++) cb.recordFailure();

    // 未超时：仍拒绝
    vi.advanceTimersByTime(9999);
    expect(cb.allowRequest()).toBe(false);

    // 超时后半开：定时器回调或 allowRequest 均可进入
    vi.advanceTimersByTime(1);
    expect(onHalfOpen).toHaveBeenCalledWith('conn-1');
    expect(cb.allowRequest()).toBe(true);
  });

  it('半开后成功请求恢复关闭并清零计数', () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker('conn-1');
    for (let i = 0; i < 5; i++) cb.recordFailure();
    vi.advanceTimersByTime(10000);

    cb.recordSuccess();
    expect(cb.state).toBe(0);
    expect(cb.failureCount).toBe(0);
    expect(cb.allowRequest()).toBe(true);
  });

  it('reset 清除所有状态与计时器', () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    const cb = new CircuitBreaker('conn-1', onOpen);
    for (let i = 0; i < 3; i++) cb.recordFailure();

    cb.reset();
    expect(cb.failureCount).toBe(0);
    expect(cb.state).toBe(0);
    // reset 后即使再失败 4 次也不会立即打开（计数已清零）
    for (let i = 0; i < 4; i++) cb.recordFailure();
    expect(cb.state).toBe(0);
  });
});
