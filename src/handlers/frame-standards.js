// =============================================================================
// frame-standards.js — 冻结的标准图框表
//
// 这是**纯常量叶子模块**（零 import）：LISP 生成器（lisp-code-builders.js）与
// 工具定义（tools/frame-tools.js）都要用它，而 tools/index.js ↔ handlers/* 之间
// 存在既有循环引用（handler-utils → mcp-server-state → mcp-handlers → tools/index），
// 表放在这里可以避免 frame-tools 反向依赖 lisp-code-builders 时踩到 TDZ
// （"Cannot access 'frame_tools' before initialization"）。
//
// **必须与 `packages/at-plot/frame-recognition.lsp` 的 `@plot:ratio-of-w/h` /
// `@plot:height-of-frame` / `@plot:scale-of-frame`，以及 lib 侧 `frame:` 命名空间
// 保持同一份数字**——三处改动需同步。
// =============================================================================

export const FRAME_STANDARDS = {
  // A4→A0 的**短边**高度
  heights: [210, 297, 420, 594, 841],
  // 与 heights 一一对应的图幅名
  papers: ['A4', 'A3', 'A2', 'A1', 'A0'],
  // 加长图幅的宽高比（长边/短边）
  ratios: [1.41429, 1.76786, 2.12143, 2.4750, 2.82857, 3.18214, 3.53571],
  // 与 ratios 一一对应的加长标记（"" = 标准幅面，不加长）
  marks: ['', '+1/4', '+1/2', '+3/4', '+1', '+5/4', '+3/2'],
  // 默认比例表（比例分母）
  defaultScales: [1, 5, 10, 20, 25, 30, 40, 50, 70, 100, 120, 150, 200, 250, 300, 400, 500, 1000],
  // 宽高比匹配绝对容差
  defaultTolRatio: 0.002,
  // 短边匹配相对容差（相对短边长度）
  defaultTolLen: 0.001,
  defaultMinSize: 0,
  // unmatched 上限：整图扫描时"闭合并矩形"的图元可能上百条（车位框、箭头框），
  // 不设上限会让响应体膨胀到几百 KB。按面积降序保留前 200 条，"像图框"的大框优先。
  maxUnmatched: 200,
};
