import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  clearCache: vi.fn(),
  isSubscribed: vi.fn(() => true),
  notify: vi.fn(),
}));

vi.mock('../../src/handlers/resource-handlers.js', () => ({ clearCache: m.clearCache }));
vi.mock('../../src/subscription-manager.js', () => ({
  isSubscribed: m.isSubscribed,
  notify: m.notify,
}));

import { notifyResourceChanges } from '../../src/tool-dispatch.js';

const cleared = () => m.clearCache.mock.calls.map(c => c[0]);

beforeEach(() => {
  vi.clearAllMocks();
  m.isSubscribed.mockReturnValue(true);
});

describe('notifyResourceChanges', () => {
  it('clears entity cache for draw_* tools', () => {
    notifyResourceChanges('draw_circle');
    expect(cleared()).toContain('atlisp://dwg/entities');
  });

  it('clears entities + block refs for batch/boolean tools', () => {
    notifyResourceChanges('batch_delete');
    expect(cleared()).toEqual(expect.arrayContaining(['atlisp://dwg/entities', 'atlisp://dwg/block-refs']));
  });

  it('clears entities + block refs + tbl for delete_/purge_', () => {
    notifyResourceChanges('purge_all');
    expect(cleared()).toEqual(expect.arrayContaining([
      'atlisp://dwg/entities', 'atlisp://dwg/block-refs', 'atlisp://dwg/tbl',
    ]));
  });

  it('clears tbl for layer tools', () => {
    notifyResourceChanges('set_current_layer');
    expect(cleared()).toEqual(['atlisp://dwg/tbl']);
  });

  it('clears name/path for save_dwg', () => {
    notifyResourceChanges('save_dwg');
    expect(cleared()).toEqual(['atlisp://dwg/name', 'atlisp://dwg/path']);
  });

  it('notifies subscribers for cleared URIs', () => {
    notifyResourceChanges('draw_line');
    expect(m.notify).toHaveBeenCalledWith('atlisp://dwg/entities', null);
  });

  it('does not clear anything for unknown/no-op tools', () => {
    notifyResourceChanges('get_entity');
    notifyResourceChanges('create_page_setup');
    expect(m.clearCache).not.toHaveBeenCalled();
  });
});
