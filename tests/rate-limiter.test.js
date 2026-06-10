import { describe, it, expect, vi, beforeEach } from 'vitest';

const { rateLimiter, createRateLimitMiddleware, getRateLimitStatus, getDetailedRateLimitStatus, resetRateLimit } = await import('../src/rate-limiter.js');

describe('rate-limiter', () => {
  beforeEach(() => { resetRateLimit(); });

  describe('createRateLimitMiddleware', () => {
    it('returns a middleware function', () => {
      const mw = createRateLimitMiddleware();
      expect(typeof mw).toBe('function');
    });

    it('allows requests within limit', async () => {
      const mw = createRateLimitMiddleware();
      const req = { ip: '127.0.0.1', headers: {}, get: () => undefined };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), set: vi.fn() };
      const next = vi.fn();

      for (let i = 0; i < 5; i++) {
        await mw(req, res, next);
        expect(next).toHaveBeenCalled();
        next.mockClear();
      }
    });

    it('blocks requests over limit', async () => {
      const mw = createRateLimitMiddleware();
      const req = { ip: '127.0.0.1', headers: {}, get: () => undefined };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), set: vi.fn() };
      const next = vi.fn();

      for (let i = 0; i < 110; i++) {
        await mw(req, res, next);
      }

      expect(res.status).toHaveBeenCalledWith(429);
    });
  });

  describe('getRateLimitStatus', () => {
    it('returns status object with remaining', () => {
      const status = getRateLimitStatus(null);
      expect(status).toHaveProperty('limit');
      expect(status).toHaveProperty('remaining');
      expect(status).toHaveProperty('resetIn');
    });
  });

  describe('resetRateLimit', () => {
    it('resets remaining to limit', () => {
      const mw = createRateLimitMiddleware();
      const req = { ip: '127.0.0.1', headers: {}, get: () => undefined };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), set: vi.fn() };
      const next = vi.fn();

      for (let i = 0; i < 10; i++) mw(req, res, next);
      resetRateLimit(null);

      const status = getRateLimitStatus(null);
      expect(status.remaining).toBe(status.limit);
    });
  });
});
