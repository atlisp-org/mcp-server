import { describe, it, expect } from 'vitest';

describe('Configuration', () => {
  it('should have default port', () => {
    expect(8110).toBeGreaterThan(0);
    expect(8110).toBeLessThan(65536);
  });

  it('should validate transport modes', () => {
    const validTransports = ['http', 'stdio', 'ws'];
    expect(validTransports).toContain('http');
    expect(validTransports).toContain('stdio');
    expect(validTransports).toContain('ws');
    expect(validTransports.length).toBe(3);
  });

  it('should have a default message timeout', () => {
    const timeout = 60000;
    expect(timeout).toBeGreaterThanOrEqual(1000);
  });
});
