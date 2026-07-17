import { describe, it, expect, vi } from 'vitest';

const FAKE_TOOLS = [
  {
    name: 'draw_line',
    description: '画直线段。p1起点 p2终点',
    inputSchema: {
      required: ['p1', 'p2'],
      properties: { p1: { type: 'string', description: '起点坐标' }, p2: { type: 'string', description: '终点坐标' } },
    },
    annotations: { category: '绘图与3D', readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'eval_lisp',
    description: '在 CAD 中执行 AutoLISP 代码',
    inputSchema: { required: ['code'], properties: { code: { type: 'string', description: 'Lisp 代码' } } },
    annotations: { category: '核心工具', readOnlyHint: false },
  },
  {
    name: 'get_entity',
    description: '获取单个实体属性',
    inputSchema: { required: ['handle'], properties: { handle: { type: 'string', description: '实体句柄' } } },
    annotations: { category: '查询', readOnlyHint: true },
  },
];

vi.mock('../src/tools/index.js', () => ({
  tools: FAKE_TOOLS,
}));

vi.mock('./prompt-handlers.js', () => ({
  listPrompts: vi.fn().mockResolvedValue([{ name: 'analyze-drawing', description: '分析图纸' }]),
  getPrompt: vi.fn().mockResolvedValue({ messages: [{ content: { text: 'prompt content' } }] }),
}));

const { search_tools, list_tools_by_category, get_tool_info } = await import('../src/handlers/meta-handlers.js');

describe('meta-handlers', () => {
  describe('search_tools', () => {
    it('finds tools by name', async () => {
      const result = await search_tools({ query: 'draw' });
      expect(result.content[0].text).toContain('draw_line');
      expect(result.content[0].text).toContain('找到 1 个工具');
    });

    it('finds tools by description', async () => {
      const result = await search_tools({ query: '直线段' });
      expect(result.content[0].text).toContain('draw_line');
    });

    it('returns empty message when no match', async () => {
      const result = await search_tools({ query: 'zzznotexist' });
      expect(result.content[0].text).toContain('未找到');
    });

    it('is case-insensitive', async () => {
      const result = await search_tools({ query: 'EVAL' });
      expect(result.content[0].text).toContain('eval_lisp');
    });
  });

  describe('list_tools_by_category', () => {
    it('returns category names when no argument', async () => {
      const result = await list_tools_by_category({});
      expect(result.content[0].text).toContain('绘图与3D');
      expect(result.content[0].text).toContain('核心工具');
      expect(result.content[0].text).toContain('查询');
    });

    it('lists tools in specific category', async () => {
      const result = await list_tools_by_category({ category: '查询' });
      expect(result.content[0].text).toContain('查询');
      expect(result.content[0].text).toContain('get_entity');
    });

    it('returns message for unknown category', async () => {
      const result = await list_tools_by_category({ category: '不存在的分类' });
      expect(result.content[0].text).toContain('未找到分类');
    });
  });

  describe('get_tool_info', () => {
    it('returns error when no name given', async () => {
      const result = await get_tool_info({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('需要 name 参数');
    });

    it('returns error for unknown tool', async () => {
      const result = await get_tool_info({ name: 'nobody' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('未找到工具');
    });

    it('returns detailed tool info', async () => {
      const result = await get_tool_info({ name: 'draw_line' });
      const text = result.content[0].text;
      expect(text).toContain('draw_line');
      expect(text).toContain('画直线段');
      expect(text).toContain('绘图与3D');
      expect(text).toContain('p1');
      expect(text).toContain('p2');
      expect(text).toContain('必填');
    });

    it('shows readOnly hint', async () => {
      const result = await get_tool_info({ name: 'get_entity' });
      expect(result.content[0].text).toContain('只读: 是');
    });

    it('shows destructive hint', async () => {
      const result = await get_tool_info({ name: 'draw_line' });
      expect(result.content[0].text).toContain('破坏性: 否');
    });
  });
});
