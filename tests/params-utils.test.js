import { describe, it, expect } from 'vitest';
import { computeEffectivePriority, HOT_USAGE_THRESHOLD, prioRank, sortByPriorityUsage } from '../src/tools/params-utils.js';

describe('computeEffectivePriority', () => {
  it('keeps static core as core regardless of usage', () => {
    expect(computeEffectivePriority('core', 0).priority).toBe('core');
    expect(computeEffectivePriority('core', 999).priority).toBe('core');
  });

  it('promotes hot common to core and marks hot', () => {
    const r = computeEffectivePriority('common', HOT_USAGE_THRESHOLD);
    expect(r.priority).toBe('core');
    expect(r.hot).toBe(true);
  });

  it('demotes never-used common to rare', () => {
    const r = computeEffectivePriority('common', 0);
    expect(r.priority).toBe('rare');
    expect(r.hot).toBe(false);
  });

  it('promotes hot rare to common but never core', () => {
    const r = computeEffectivePriority('rare', HOT_USAGE_THRESHOLD);
    expect(r.priority).toBe('common');
    expect(r.hot).toBe(true);
  });

  it('keeps low-usage rare as rare', () => {
    expect(computeEffectivePriority('rare', 1).priority).toBe('rare');
  });

  it('normalizes invalid static priority', () => {
    expect(computeEffectivePriority('bogus', 0).priority).toBe('rare');
    expect(computeEffectivePriority(undefined, HOT_USAGE_THRESHOLD).priority).toBe('core');
  });
});

describe('prioRank', () => {
  it('orders core < common < rare', () => {
    expect(prioRank('core')).toBeLessThan(prioRank('common'));
    expect(prioRank('common')).toBeLessThan(prioRank('rare'));
    expect(prioRank('bogus')).toBe(prioRank('common'));
  });
});

describe('sortByPriorityUsage', () => {
  const items = [
    { name: 'a', prio: 'common', count: 1 },
    { name: 'b', prio: 'core', count: 0 },
    { name: 'c', prio: 'common', count: 50 },
    { name: 'd', prio: 'rare', count: 9 },
  ];
  const sorted = sortByPriorityUsage(items, i => i.prio, i => i.count);

  it('sorts core first then by usage desc', () => {
    expect(sorted.map(i => i.name)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('does not mutate input', () => {
    expect(items.map(i => i.name)).toEqual(['a', 'b', 'c', 'd']);
  });
});
