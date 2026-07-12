import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const mocks = vi.hoisted(() => {
    const edgeHandler = vi.fn((args, cb) => {
        const r = { success: true, hasDoc: true, isBusy: false, result: '"ok"' };
        if (cb) cb(null, r);
        return r;
    });
    return {
        edgeHandler,
        lispValidate: vi.fn(() => ({ valid: true })),
        lispCheckParens: vi.fn(() => ({ valid: true })),
    };
});

vi.mock('edge-js', () => ({
    default: Object.assign(vi.fn(() => mocks.edgeHandler), { func: vi.fn(() => mocks.edgeHandler) }),
}));

vi.mock('../../src/lisp-security.js', () => ({
    validateLispCodeWorker: mocks.lispValidate,
    checkParens: mocks.lispCheckParens,
}));

import { handleMessage, validateCode, computeCodeHash, getCachedLisp, setCachedLisp } from '../../src/cad-worker.js';

describe('cad-worker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('handleMessage routing', () => {
        it('routes ping', async () => {
            const result = await handleMessage({ type: 'ping' });
            expect(result).toEqual({ pong: true });
        });

        it('returns error for unknown type', async () => {
            const result = await handleMessage({ type: 'nobody' });
            expect(result).toEqual({ error: 'unknown message type' });
        });

        it('routes send with edge call', async () => {
            const result = await handleMessage({ type: 'send', code: '(princ 1)', platform: 'AutoCAD' });
            expect(result.success).toBe(true);
        });

        it('routes connect with platform', async () => {
            const result = await handleMessage({ type: 'connect', platform: 'AutoCAD' });
            expect(result.success).toBe(true);
        });
    });

    describe('validateCode', () => {
        it('passes valid code', () => {
            mocks.lispCheckParens.mockReturnValue({ valid: true });
            mocks.lispValidate.mockReturnValue({ valid: true });
            expect(validateCode('(princ 1)')).toEqual({ valid: true });
        });

        it('fails on paren mismatch', () => {
            mocks.lispCheckParens.mockReturnValue({ valid: false, error: '缺少 1 个右括号 )', pos: 10 });
            const result = validateCode('(princ 1');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('括号错误');
        });

        it('fails on security violation', () => {
            mocks.lispCheckParens.mockReturnValue({ valid: true });
            mocks.lispValidate.mockReturnValue({ valid: false, error: '禁止使用 eval 函数' });
            const result = validateCode('(eval 1)');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('安全限制');
        });
    });

    describe('computeCodeHash', () => {
        it('returns hash when cache enabled', () => {
            const hash = computeCodeHash('(princ 1)', true);
            expect(hash).toBe(crypto.createHash('sha256').update('(princ 1)').digest('hex'));
        });

        it('returns empty string when cache disabled', () => {
            expect(computeCodeHash('(princ 1)', false)).toBe('');
        });
    });

    describe('Lisp cache', () => {
        beforeEach(() => {
            // Clear internal cache by calling with a key that evicts
            // Use fresh module scope for each test by relying on vi.resetAllMocks
        });

        it('stores and retrieves compiled code', () => {
            setCachedLisp('(princ 1)', 'compiled-result');
            const cached = getCachedLisp('(princ 1)');
            expect(cached).toBe('compiled-result');
        });

        it('returns null for uncached code', () => {
            expect(getCachedLisp('(princ 2)')).toBeNull();
        });

        it('returns null for expired cache entry', () => {
            vi.useFakeTimers();
            setCachedLisp('(princ 1)', 'compiled');
            vi.advanceTimersByTime(400000);
            expect(getCachedLisp('(princ 1)')).toBeNull();
            vi.useRealTimers();
        });
    });
});
