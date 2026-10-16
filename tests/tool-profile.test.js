// Token 成本治理：toolProfile 档位过滤（src/tools/index.js 的 getVisibleTools）。
// 档位只影响 tools/list 发现接口；完整 toolsByName / search_tools 不受影响。
import { describe, it, expect, afterEach } from 'vitest';
import config from '../src/config.js';
import {
  tools,
  toolsByName,
  getVisibleTools,
  PROFILE_CATEGORIES,
  normalizeToolProfile,
} from '../src/tools/index.js';

function names(list) {
  return new Set(list.map(t => t.name));
}

afterEach(() => {
  config.toolProfile = 'full';
});

describe('toolProfile 档位过滤', () => {
  it('默认 full：暴露全部工具（现有行为不变）', () => {
    config.toolProfile = 'full';
    expect(getVisibleTools()).toBe(tools);
    expect(getVisibleTools().length).toBe(tools.length);
  });

  it('minimal 档：100~120 个核心工具，且核心工具在场', () => {
    config.toolProfile = 'minimal';
    const visible = getVisibleTools();
    expect(visible.length).toBeGreaterThanOrEqual(100);
    expect(visible.length).toBeLessThanOrEqual(120);
    const n = names(visible);
    for (const core of [
      'get_cad_info', 'eval_lisp', 'get_entity', 'select_entities',
      'create_layer', 'set_current_layer', 'draw_line', 'draw_circle',
      'search_tools', 'get_tool_info', 'list_tools_by_category',
    ]) {
      expect(n.has(core), `minimal 档应包含 ${core}`).toBe(true);
    }
  });

  it('standard 档：200~230 个，包含编辑/块/标注/文字/打印/文件类', () => {
    config.toolProfile = 'standard';
    const visible = getVisibleTools();
    expect(visible.length).toBeGreaterThanOrEqual(200);
    expect(visible.length).toBeLessThanOrEqual(230);
    const n = names(visible);
    expect(n.has('create_block')).toBe(true);
    expect(n.has('insert_block')).toBe(true);
    expect(n.has('create_dimension')).toBe(true);
    expect(n.has('replace_text')).toBe(true);
    expect(n.has('export_pdf')).toBe(true);
    expect(n.has('open_dwg')).toBe(true);
    expect(n.has('save_dwg')).toBe(true);
    // 编辑/块/标注/文字/打印/文件类按 category 断言在场
    for (const cat of ['编辑', '块', '标注与填充', '文字', '打印', '文件']) {
      expect(visible.some(t => t.annotations?.category === cat), `standard 档应包含 ${cat} 类`).toBe(true);
    }
  });

  it('standard 是 minimal 的超集，full 是 standard 的超集', () => {
    config.toolProfile = 'minimal';
    const min = names(getVisibleTools());
    config.toolProfile = 'standard';
    const std = names(getVisibleTools());
    config.toolProfile = 'full';
    const full = names(getVisibleTools());
    for (const n of min) expect(std.has(n), `standard 应包含 minimal 的 ${n}`).toBe(true);
    for (const n of std) expect(full.has(n), `full 应包含 standard 的 ${n}`).toBe(true);
    expect(std.size).toBeGreaterThan(min.size);
    expect(full.size).toBeGreaterThan(std.size);
  });

  it('被过滤的工具仍可通过 search_tools 检索并直接调用（toolsByName 完整）', async () => {
    config.toolProfile = 'minimal';
    // 参照与底图不在 minimal 档
    expect(names(getVisibleTools()).has('attach_xref')).toBe(false);
    // 但调用校验与检索仍可用
    expect(toolsByName.has('attach_xref')).toBe(true);
    const { search_tools, get_tool_info } = await import('../src/handlers/meta-handlers.js');
    const found = await search_tools({ query: 'attach_xref', limit: 5 });
    expect(found.structuredContent.tools.some(t => t.name === 'attach_xref')).toBe(true);
    const info = await get_tool_info({ name: 'attach_xref' });
    expect(info.isError).toBeFalsy();
    expect(info.content[0].text).toContain('attach_xref');
  });

  it('切换档位后缓存按 profile+categories 失效', () => {
    config.toolProfile = 'minimal';
    const a = getVisibleTools();
    config.toolProfile = 'full';
    const b = getVisibleTools();
    config.toolProfile = 'minimal';
    const c = getVisibleTools();
    expect(a.length).toBeLessThan(b.length);
    expect(c).toEqual(a);
    expect(b).toBe(tools);
    // 同档位重复调用命中缓存，返回同一引用
    expect(getVisibleTools()).toBe(c);
  });

  it('与 toolCategories 过滤叠加生效', () => {
    config.toolProfile = 'standard';
    config.toolCategories = ['打印'];
    const visible = getVisibleTools();
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every(t => t.annotations?.category === '打印')).toBe(true);
    config.toolCategories = [];
    expect(getVisibleTools().length).toBeGreaterThanOrEqual(200);
  });
});

describe('normalizeToolProfile', () => {
  it('合法档位原样返回', () => {
    expect(normalizeToolProfile('full')).toBe('full');
    expect(normalizeToolProfile('standard')).toBe('standard');
    expect(normalizeToolProfile('minimal')).toBe('minimal');
  });

  it('未知/缺失值回落 full（不把工具全部藏掉）', () => {
    expect(normalizeToolProfile('bogus')).toBe('full');
    expect(normalizeToolProfile(undefined)).toBe('full');
    expect(normalizeToolProfile(null)).toBe('full');
    expect(normalizeToolProfile('')).toBe('full');
  });
});

describe('PROFILE_CATEGORIES 映射表', () => {
  it('minimal/standard 是 category 集合，full 为 null（不过滤）', () => {
    expect(PROFILE_CATEGORIES.full).toBeNull();
    expect(PROFILE_CATEGORIES.minimal.has('系统')).toBe(true);
    expect(PROFILE_CATEGORIES.minimal.has('元工具')).toBe(true);
    expect(PROFILE_CATEGORIES.standard.has('块')).toBe(true);
    expect(PROFILE_CATEGORIES.standard.has('打印')).toBe(true);
    expect(PROFILE_CATEGORIES.standard.has('文件')).toBe(true);
    // standard ⊇ minimal
    for (const c of PROFILE_CATEGORIES.minimal) {
      expect(PROFILE_CATEGORIES.standard.has(c), `standard 应包含 category ${c}`).toBe(true);
    }
  });

  it('档位覆盖的 category 与实际工具标注一致（映射表不失效）', () => {
    const realCats = new Set(tools.map(t => t.annotations?.category));
    for (const [profile, cats] of Object.entries(PROFILE_CATEGORIES)) {
      if (!cats) continue;
      for (const c of cats) {
        expect(realCats.has(c), `${profile} 档引用了不存在的 category: ${c}`).toBe(true);
      }
    }
  });
});
