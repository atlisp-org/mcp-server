// =============================================================================
// frame-aliases.js — 图框属性块 tag → 语义字段的别名表（冻结表）
//
// **必须与 lib 侧 `frame:aliases`（lib/src/frame/aliases.lsp）保持完全一致**：
//   8 组语义字段；匹配规则 = `strcase` 统一大小写 + 去首尾空白后**精确匹配**；
//   同一字段命中多个 tag 时取第一个非空值。任一处理改动都要两处同步。
//
// 为什么在这里再实现一份：目标 CAD 会话**没有加载 @lisp lib**
// （`(member 'require (atoms-family 1))` → nil），CAD 侧 LISP 必须自包含，
// 不能调用 `frame:aliases`/`frame:fields`，只能用 JS 生成等价的 LISP 字面量。
//
// 这是**纯常量叶子模块（零 import）**：`lisp-code-builders.js` 用它生成 LISP 字面量，
// `frame-tools.js` 用它写描述。放在叶子模块（同 frame-standards.js 的思路）是为了避免
// tools/index.js ↔ handlers/* 的既有循环引用踩到 TDZ。
// =============================================================================

/** 语义字段 → 常见 tag（顺序即优先级，同字段取第一个非空命中）。 */
export const FRAME_FIELD_ALIASES = {
  title: ['图名', '图纸名称', '图纸名', '图幅名称', 'TITLE', 'DWGNAME', 'SHEETTITLE'],
  number: ['图号', '图纸编号', '图纸代号', 'DWGNO', 'DWGNO.', 'SHEETNO'],
  scale: ['比例', '出图比例', 'SCALE'],
  date: ['日期', '出图日期', '时间', 'DATE'],
  designer: ['设计', '设计人', '制图', '绘图', 'DESIGN', 'DESIGNER', 'DRAWN', 'DRAWNBY'],
  checker: ['审核', '校对', '校核', 'CHECK', 'CHECKER', 'AUDIT'],
  project: ['工程名称', '项目名称', '工程', 'PROJECT', 'PROJECTNAME'],
  discipline: ['专业', 'DISCIPLINE'],
};

/**
 * 转成 LISP 字面量：`'(("title" "图名" ...) ...)`。
 * 供 lisp-code-builders.js 直接拼进自包含 LISP（CAD 侧无 lib，别名表必须写死）。
 */
export function frameAliasesLisp() {
  const groups = Object.entries(FRAME_FIELD_ALIASES).map(([field, tags]) => {
    const lispTags = tags.map(t => `"${t}"`).join(' ');
    return `("${field}" ${lispTags})`;
  });
  return `'(${groups.join('\n  ')})`;
}
