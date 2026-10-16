// search_tools 摘要模式：结果项只含 name/title/一句话描述/category（不含 inputSchema），
// 新增 limit 参数（默认 10，上限 50）。旧的纯文本 content 首行格式保持兼容。
import { describe, it, expect, vi } from 'vitest';

const LONG_DESC = `长描述工具。用户说"长描述"时调用。${'这是一段用于验证截断行为的冗长说明文字。'.repeat(8)}`;

const FAKE_TOOLS = Array.from({ length: 30 }, (_, i) => ({
  name: `search_target_${String(i + 1).padStart(2, '0')}`,
  title: `标题${i + 1}`,
  description: i === 0 ? LONG_DESC : `搜索目标工具${i + 1}。用户说"目标${i + 1}"时调用\n【类别】其他｜【操作】只读·安全`,
  inputSchema: { type: 'object', properties: { q: { type: 'string', description: '不该出现在摘要里' } } },
  annotations: { category: '高级', readOnlyHint: true },
}));

vi.mock('../src/tools/index.js', () => ({ tools: FAKE_TOOLS }));

const { search_tools } = await import('../src/handlers/meta-handlers.js');

describe('search_tools 摘要结构', () => {
  it('结果项只含 name/title/description/category，不含 inputSchema', async () => {
    const result = await search_tools({ query: 'search_target' });
    const sc = result.structuredContent;
    expect(sc.tools.length).toBe(10); // 默认 limit
    for (const item of sc.tools) {
      expect(Object.keys(item).sort()).toEqual(['category', 'description', 'name', 'title']);
      expect(item).not.toHaveProperty('inputSchema');
      expect(item.description).not.toContain('不该出现在摘要里');
    }
  });

  it('描述截断到 ~120 字并去掉【类别】尾注', async () => {
    const result = await search_tools({ query: 'search_target_01' });
    const item = result.structuredContent.tools[0];
    expect(item.description.length).toBeLessThanOrEqual(120);
    expect(item.description).not.toContain('【类别】');
    expect(item.description.endsWith('…')).toBe(true);

    const plain = await search_tools({ query: 'search_target_02' });
    expect(plain.structuredContent.tools[0].description).toBe('搜索目标工具2。用户说"目标2"时调用');
    expect(plain.structuredContent.tools[0].title).toBe('标题2');
    expect(plain.structuredContent.tools[0].category).toBe('高级');
  });

  it('limit 生效：limit=3 只返回 3 条，total 仍为全部命中数', async () => {
    const result = await search_tools({ query: 'search_target', limit: 3 });
    expect(result.structuredContent.tools.length).toBe(3);
    expect(result.structuredContent.total).toBe(30);
    expect(result.structuredContent.count).toBe(3);
    // 文本格式兼容：首行仍是"找到 N 个工具"，截断时提示可用 limit
    expect(result.content[0].text).toContain('找到 30 个工具');
    expect(result.content[0].text).toContain('显示前 3 个');
    expect(result.content[0].text).toContain('search_target_01');
  });

  it('limit 上限 50：传 100 被钳制，且不再提示截断', async () => {
    const result = await search_tools({ query: 'search_target', limit: 100 });
    expect(result.structuredContent.tools.length).toBe(30); // 命中只有 30 条
    expect(result.content[0].text).toContain('找到 30 个工具');
    expect(result.content[0].text).not.toContain('显示前');
  });

  it('limit 下限 1，非整数回落默认 10', async () => {
    const low = await search_tools({ query: 'search_target', limit: -5 });
    expect(low.structuredContent.tools.length).toBe(1);
    const bogus = await search_tools({ query: 'search_target', limit: 'x' });
    expect(bogus.structuredContent.tools.length).toBe(10);
    const missing = await search_tools({ query: 'search_target' });
    expect(missing.structuredContent.tools.length).toBe(10);
  });

  it('未命中时保持旧文本格式，structuredContent 为空列表', async () => {
    const result = await search_tools({ query: 'zzznotexist' });
    expect(result.content[0].text).toContain('未找到');
    expect(result.structuredContent.tools).toEqual([]);
    expect(result.structuredContent.total).toBe(0);
  });
});
