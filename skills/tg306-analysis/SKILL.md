---
name: tg306-analysis
description: 22TG306 钢接框架结构分析。自动识别柱/梁/轴线 → 统计编号 → 批量构件详图 → IFC4 BIM 导出 → 碰撞检测。
tags: [cad, structure, bim, tg306, steel-frame, ifc, collision]
---

# tg306-analysis

22TG306 装配整体式钢连接混合框架结构绘图辅助系统的结构分析功能。
通过 atlisp-mcp MCP 工具调用 CAD 中的 tg306 包，实现二维结构平面图的自动化处理。

## 前置条件

- AutoCAD/ZWCAD 已启动
- atlisp-mcp MCP 服务已连接（`connect_cad`）
- tg306 包已加载：`eval_lisp(code='(load "pkg.lsp")')`

## MCP 工具映射

| MCP 工具 | 对应 CAD 命令 | 功能 |
|----------|-------------|------|
| `eval_lisp` | 执行 AutoLISP | 无返回值的 CAD 操作 |
| `eval_lisp_with_result` | 执行并返回 | 需要获取结果时使用 |
| `connect_cad` | — | 连接 CAD 实例 |
| `get_cad_info` | — | 获取 CAD 版本/文档信息 |
| `select_entities` | ssget | 按条件选择实体 |
| `get_blocks` | — | 获取块定义列表 |
| `insert_block` | -INSERT | 插入块 |
| `draw_text` | TEXT | 创建单行文字 |
| `draw_mtext` | MTEXT | 创建多行文字 |
| `export_pdf` | EXPORTPDF | 导出 PDF |

## 完整分析流程

### 步骤 1：加载包与配置

```lisp
;; 加载 tg306 包
eval_lisp(code='(load "pkg.lsp")')

;; 配置图层参数（可选，使用默认值可不执行）
eval_lisp(code='(bim:config)')
```

配置参数说明：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `:col-layer` | `*柱*,*KZ*,COL*` | 柱图层匹配 |
| `:beam-layer` | `*梁*,*KL*,BEAM*` | 梁图层匹配 |
| `:grid-layer` | `*轴*,*AXIS*,GRID*` | 轴线图层 |
| `:col-min-size` | 200 | 柱最小尺寸(mm) |
| `:col-max-size` | 1200 | 柱最大尺寸(mm) |
| `:beam-min-width` | 100 | 梁最小宽度(mm) |
| `:beam-max-width` | 600 | 梁最大宽度(mm) |

### 步骤 2：一键分析

```lisp
eval_lisp(code='(bim:analyze)')
```

`bim:analyze` 自动执行：

```
1. bim:find-grids      → 轴线识别
2. bim:find-columns     → 柱识别（SOLID + 多段线 + KZ*标签）
3. bim:find-beams       → 梁识别（平行线对 + KL*/LL*截面文字）
4. bim:merge-beams      → 合并共线梁段
5. bim:visualize        → 插入动态块标记（柱.dwg / beam-yz.dwg）
6. bim:highlight-beam-lines → 颜色标记
7. tg306:set-beam-annotations → 平法标注采集
8. tg306:copy-beam-data-from-collinear → 共线补全
```

### 步骤 3：查看分析结果

```lisp
;; 获取梁数据排查表
eval_lisp_with_result(code='(tg306:show-beam-data)')

;; 高亮问题梁块
eval_lisp(code='(bim:highlight-problem-beams)')
```

### 步骤 4：设置楼层并统计

```lisp
;; 设置楼层信息（手动）
eval_lisp(code='(bim:set-storey "F1" 3300)')

;; 读取梁/柱连接件参数表（需在 CAD 中手动选择表格）
eval_lisp(code='(tg306:read-beam-table)')
eval_lisp(code='(tg306:read-colu-table)')

;; 统计编号
eval_lisp(code='(tg306:stat-column)')
eval_lisp(code='(tg306:stat-beam)')
```

### 步骤 5：批量出图

```lisp
;; 生成柱构件图
eval_lisp(code='(tg306:batch-draw-column)')

;; 生成梁构件图
eval_lisp(code='(tg306:batch-draw-beam)')
```

### 步骤 6：导出 IFC4 BIM

```lisp
eval_lisp(code='(tg306:export-ifc)')
```

IFC 导出层次：

```
IfcProject
 └─ IfcSite
     └─ IfcBuilding
         └─ IfcBuildingStorey (楼层)
             ├─ IfcColumn     — 柱（矩形截面 + Z 拉伸）
             ├─ IfcBeam       — 梁（矩形截面 + X 拉伸）
             ├─ IfcPlate      — 钢板（翼缘/腹板/环板）
             └─ IfcMechanicalFastener — 螺栓阵列
```

### 步骤 7：碰撞检测

```lisp
;; 检测碰撞
eval_lisp(code='(tg306:collision-check-all)')

;; 清除标记
eval_lisp(code='(tg306:collision-clear)')
```

## 快捷流程

一键完成全流程（分析 + 导出）：
```lisp
eval_lisp(code='(bim:analyze-and-export)')
```

## 交互命令

```lisp
;; 绘制柱顶连接件
eval_lisp(code='(tg306:menu-draw-colutop)')

;; 绘制高强螺栓排
eval_lisp(code='(tg306:menu-draw-gqls)')

;; 绘制螺栓环
eval_lisp(code='(tg306:menu-draw-ring)')

;; 批量标注板件
eval_lisp(code='(tg306:menu-dim-plate)')

;; 读柱设计号
eval_lisp(code='(tg306:column-design-number)')
```

## 故障排查

| 问题 | 原因 | 解决 |
|------|------|------|
| 分析后大量红线 | 图层名称不匹配 | `bim:config` 调整图层参数 |
| 柱未识别 | 非 SOLID/多段线表示 | 检查柱图层配置 |
| IFC 导出失败 | 未设置楼层信息 | 先执行 `bim:set-storey` |
| 菜单不显示 | base 包未加载 | 执行 `(load "pkg.lsp")` 或 `(@:add-menus '())` |
