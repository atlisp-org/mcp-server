import { describe, it, expect } from 'vitest';
import { tools } from '../../src/tools/index.js';
import { TOOL_HANDLERS } from '../../src/mcp-tools.js';

/* 工具目录（`tools/list`，决定模型能看到/能选什么）与分派表 `TOOL_HANDLERS`
   （决定**能不能执行**）是两份各自维护的清单：

     - 工具定义在 `src/tools/<name>-tools.js` + `src/tools/index.js`
     - 分派登记在 `src/mcp-tools.js` 的 TOOL_HANDLERS

   只加前者、忘了后者，工具会出现在目录里（个数也对），但调用直接返回
   `[HANDLER_NOT_FOUND] 未知工具` —— 模型看到「有这个工具」却怎么调都失败，
   很容易被误判成「模型不会用」。实测踩过一次：`list_frames`（图框识别）。

   本测试是**棘轮**：既拦住新增工具漏登记，也强制「修好一个历史缺口就删一行」。
 */

/** 已存在的历史缺口（**规范标准类** 14 个，先于本次工作存在）。
 *  它们有工具定义与 handlers/standards-handlers.js 实现，但没有在 TOOL_HANDLERS 登记，
 *  因此目前调用会报 HANDLER_NOT_FOUND。修掉任意一个都应同步从本清单删除。 */
const KNOWN_GAPS = [
  'apply_standards_template',
  'check_color_conformity',
  'check_dim_style_conformity',
  'check_drawing_standards',
  'check_file_naming',
  'check_layer_naming',
  'check_linetype_conformity',
  'check_lineweight_conformity',
  'check_text_style_conformity',
  'compare_standards',
  'generate_compliance_report',
  'list_standards',
  'load_standards',
  'save_standards',
];

function missingHandlers() {
  return tools
    .map((t) => t.name)
    .filter((n) => !(n in TOOL_HANDLERS))
    .sort();
}

describe('工具目录 ↔ 分派表一致性', () => {
  it('缺口集合与已登记清单严格一致', () => {
    const gaps = missingHandlers();
    const unexpected = gaps.filter((n) => !KNOWN_GAPS.includes(n));
    const fixed = KNOWN_GAPS.filter((n) => !gaps.includes(n));

    expect(
      unexpected,
      `新增工具必须同时在 src/mcp-tools.js 的 TOOL_HANDLERS 里登记，否则目录里有、调用报 HANDLER_NOT_FOUND：${unexpected.join(', ')}`,
    ).toEqual([]);
    expect(fixed, `这些历史缺口已被修好，请从 KNOWN_GAPS 里删除：${fixed.join(', ')}`).toEqual([]);
  });

  it('图框识别 list_frames 已可正常分派', () => {
    expect(typeof TOOL_HANDLERS.list_frames).toBe('function');
  });
});
