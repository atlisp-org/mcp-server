import { describe, it, expect } from 'vitest';
import { toolsByName, READ_ONLY_TOOLS, DESTRUCTIVE_TOOLS } from '../../src/tools/index.js';

describe('READ_ONLY_TOOLS metadata', () => {
  it('watch_list / webhook_list are registered as read-only (regression: names were list_watches/list_webhooks)', () => {
    expect(toolsByName.has('watch_list')).toBe(true);
    expect(toolsByName.has('webhook_list')).toBe(true);
    expect(READ_ONLY_TOOLS.has('watch_list')).toBe(true);
    expect(READ_ONLY_TOOLS.has('webhook_list')).toBe(true);
    expect(READ_ONLY_TOOLS.has('list_watches')).toBe(false);
    expect(READ_ONLY_TOOLS.has('list_webhooks')).toBe(false);
  });

  it('meta tools used for discovery are read-only', () => {
    for (const name of ['search_tools', 'list_tools_by_category', 'get_tool_info']) {
      expect(READ_ONLY_TOOLS.has(name)).toBe(true);
    }
  });

  it('every READ_ONLY_TOOLS entry maps to an existing tool', () => {
    const missing = [...READ_ONLY_TOOLS].filter(name => !toolsByName.has(name));
    expect(missing).toEqual([]);
  });

  it('no tool is both read-only and destructive', () => {
    const overlap = [...READ_ONLY_TOOLS].filter(name => DESTRUCTIVE_TOOLS.has(name));
    expect(overlap).toEqual([]);
  });
});
