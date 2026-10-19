import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    sendCommandWithResult: vi.fn(),
}));

vi.mock('../../src/cad.js', () => ({
    cad: { sendCommandWithResult: mocks.sendCommandWithResult },
}));

import { streamEntitiesByType, streamTextContent, streamBlockRefs } from '../../src/streaming.js';

describe('streaming', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('streamEntitiesByType', () => {
        it('returns entities from CAD result', async () => {
            mocks.sendCommandWithResult.mockResolvedValue(
                JSON.stringify([2, ['LINE', '100', '0'], ['CIRCLE', '101', '1']])
            );
            const result = await streamEntitiesByType({});
            expect(result.total).toBe(2);
            expect(result.count).toBe(2);
            expect(result.entities).toHaveLength(2);
            expect(result.entities[0]).toEqual({ type: 'LINE', handle: '100', layer: '0' });
        });

        it('filters by type in Lisp expression', async () => {
            mocks.sendCommandWithResult.mockResolvedValue(JSON.stringify([0]));
            await streamEntitiesByType({ type: 'LINE' });
            const lisp = mocks.sendCommandWithResult.mock.calls[0][0];
            expect(lisp).toContain('(cons 0 "LINE")');
        });

        it('生成的 LISP 用 prog1 清理全局临时变量（ss 持有整个选择集）', async () => {
            mocks.sendCommandWithResult.mockResolvedValue(JSON.stringify([0]));
            await streamEntitiesByType({});
            const lisp = mocks.sendCommandWithResult.mock.calls[0][0];
            expect(lisp.trim().startsWith('(prog1')).toBe(true);
            expect(lisp).toContain('(setq ss nil result nil elist nil e nil count nil i nil)');

            // 括号必须平衡，否则 CAD 侧会直接报语法错误
            let depth = 0;
            let minDepth = 0;
            for (const ch of lisp) {
                if (ch === '(') depth++;
                else if (ch === ')') { depth--; minDepth = Math.min(minDepth, depth); }
            }
            expect(depth).toBe(0);
            expect(minDepth).toBe(0);
        });

        it('filters by layer in Lisp expression', async () => {
            mocks.sendCommandWithResult.mockResolvedValue(JSON.stringify([0]));
            await streamEntitiesByType({ layer: 'walls' });
            const lisp = mocks.sendCommandWithResult.mock.calls[0][0];
            expect(lisp).toContain('(cons 8 "walls")');
        });

        it('returns empty result on parse error', async () => {
            mocks.sendCommandWithResult.mockResolvedValue('not json');
            const result = await streamEntitiesByType({});
            expect(result.total).toBe(0);
            expect(result.entities).toEqual([]);
        });

        it('returns error when entity limit exceeded', async () => {
            mocks.sendCommandWithResult.mockResolvedValue(JSON.stringify([-1, 50000]));
            const result = await streamEntitiesByType({});
            expect(result.error).toContain('超过最大限制');
            expect(result.entities).toEqual([]);
        });

        it('returns warning for unfiltered large result', async () => {
            mocks.sendCommandWithResult.mockResolvedValue(
                JSON.stringify([6000, [1, 2, 3, 4, 5, 6]])
            );
            const result = await streamEntitiesByType({});
            expect(result.warning).toContain('未提供过滤条件');
        });

        it('respects offset and limit', async () => {
            mocks.sendCommandWithResult.mockResolvedValue(JSON.stringify([10]));
            await streamEntitiesByType({ offset: 5, chunk: 3 });
            const lisp = mocks.sendCommandWithResult.mock.calls[0][0];
            expect(lisp).toContain('(setq i 5)');
            expect(lisp).toContain('(< count 3)');
        });

        it('sets hasMore when more entities remain', async () => {
            mocks.sendCommandWithResult.mockResolvedValue(
                JSON.stringify([10, ['LINE', '1', '0'], ['LINE', '2', '0']])
            );
            const result = await streamEntitiesByType({ offset: 0, chunk: 2 });
            expect(result.hasMore).toBe(true);
        });

        it('clears hasMore when all entities consumed', async () => {
            mocks.sendCommandWithResult.mockResolvedValue(
                JSON.stringify([2, ['LINE', '1', '0'], ['LINE', '2', '0']])
            );
            const result = await streamEntitiesByType({ offset: 0, chunk: 100 });
            expect(result.hasMore).toBe(false);
        });
    });

    describe('streamTextContent', () => {
        it('searches TEXT and MTEXT with OR filter', async () => {
            mocks.sendCommandWithResult.mockResolvedValue(JSON.stringify([0]));
            await streamTextContent({});
            const lisp = mocks.sendCommandWithResult.mock.calls[0][0];
            expect(lisp).toContain('(cons 0 "TEXT")');
            expect(lisp).toContain('(cons 0 "MTEXT")');
            expect(lisp).toContain('<OR');
        });

        it('filters by layer', async () => {
            mocks.sendCommandWithResult.mockResolvedValue(JSON.stringify([0]));
            await streamTextContent({ layer: 'text-layer' });
            const lisp = mocks.sendCommandWithResult.mock.calls[0][0];
            expect(lisp).toContain('(cons 8 "text-layer")');
        });

        it('returns mapped text items', async () => {
            mocks.sendCommandWithResult.mockResolvedValue(
                JSON.stringify([1, ['A1', 'Hello', '(10.0 20.0 0.0)']])
            );
            const result = await streamTextContent({});
            expect(result.texts[0]).toEqual({ handle: 'A1', text: 'Hello', point: '(10.0 20.0 0.0)' });
        });
    });

    describe('streamBlockRefs', () => {
        it('filters by block name', async () => {
            mocks.sendCommandWithResult.mockResolvedValue(JSON.stringify([0]));
            await streamBlockRefs({ blockName: 'door' });
            const lisp = mocks.sendCommandWithResult.mock.calls[0][0];
            expect(lisp).toContain('(cons 2 "door")');
        });

        it('returns mapped block refs', async () => {
            mocks.sendCommandWithResult.mockResolvedValue(
                JSON.stringify([1, ['door', 'B1', '(0.0 0.0 0.0)']])
            );
            const result = await streamBlockRefs({});
            expect(result.refs[0]).toEqual({ blockName: 'door', handle: 'B1', insertionPoint: '(0.0 0.0 0.0)' });
        });
    });
});
