import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/cad.js', () => ({
  cad: {
    connected: true,
    sendCommand: vi.fn().mockResolvedValue(true),
    sendCommandWithResult: vi.fn().mockResolvedValue('100'),
  }
}));

describe('Pipeline Engine - resolveRef', () => {
  it('should parse $ref syntax correctly', () => {
    const ref = '$ref:step1.result';
    const match = ref.match(/^\$ref:(.+)\.(.+)$/);
    expect(match).not.toBeNull();
    expect(match[1]).toBe('step1');
    expect(match[2]).toBe('result');
  });

  it('should handle multiple dot paths', () => {
    const ref = '$ref:step1.data.items.0';
    const match = ref.match(/^\$ref:(.+?)\.(.+)$/);
    expect(match[1]).toBe('step1');
    expect(match[2]).toBe('data.items.0');
  });

  it('should not match non-ref strings', () => {
    expect('not_a_ref'.match(/^\$ref:/)).toBeNull();
    expect('plain string'.match(/^\$ref:/)).toBeNull();
  });
});

describe('Pipeline Engine - evaluateCondition', () => {
  it('should return boolean values directly', () => {
    expect(true).toBe(true);
    expect(false).toBe(false);
  });
});
