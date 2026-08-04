// 动态优先级推断：基于真实调用次数（usageCount）叠加静态档位，
// 不修改 annotations.priority（保可预期性），仅用于查询时展示/排序。
export const HOT_USAGE_THRESHOLD = 20; // 达到该调用次数视为高频
export const ACTIVE_USAGE_THRESHOLD = 1; // 至少被使用过

function clampPrio(p) {
  return p === 'core' || p === 'rare' ? p : 'common';
}

// 返回 { effective, hot, unused }
// effective: 动态有效档位（core/common/rare）
// stats.core 等保持静态。动态规则：
//   - 静态 core：恒为 core（除非从未使用 -> 动态降到 common）
//   - 静态 common：使用 >= HOT 升为 core；从未使用降为 rare
//   - 静态 rare：使用 >= HOT 升为 common；否则不变
export function computeEffectivePriority(staticPriority, usageCount) {
  const base = clampPrio(staticPriority);
  const count = Number.isFinite(usageCount) ? usageCount : 0;
  let effective = base;
  let hot = false;

  if (count >= HOT_USAGE_THRESHOLD) {
    hot = true;
    if (base === 'common') effective = 'core';
    else if (base === 'rare') effective = 'common';
  } else if (base === 'core') {
    effective = 'core';
  } else if (count === 0 && base !== 'rare') {
    effective = 'rare';
  } else if (base === 'common' && count >= ACTIVE_USAGE_THRESHOLD) {
    effective = 'common';
  }

  return { priority: effective, hot };
}

const PRIO_RANK = { core: 0, common: 1, rare: 2 };
export function prioRank(p) {
  return PRIO_RANK[p] ?? 1;
}

// 排序：优先档位（core 在前），档位相同按调用次数降序
export function sortByPriorityUsage(items, prioOf, countOf) {
  return [...items].sort((x, y) => {
    const pr = prioRank(prioOf(x)) - prioRank(prioOf(y));
    if (pr !== 0) return pr;
    return (countOf(y) ?? 0) - (countOf(x) ?? 0);
  });
}