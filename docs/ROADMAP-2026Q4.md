# mcp-server 优化与新功能路线图（2026 Q4）

> 制定于 2026-10-16，基于 v1.9.13 现状盘点（358 工具 / 协议 2024-11-05 / 覆盖率 41.7% / schema 177KB）。
> 执行方式：按波次推进，每波结束跑全量 lint + test + build，通过后 commit + `npm run release minor`。

## Wave 1a — P0 基础（并行）✅ 2026-10-16

- [x] **A1 MCP 协议升级**（81c68e7）：PROTOCOL_VERSION 动态协商（现 2025-11-25，回退 2024-11-05）；12 个查询工具 outputSchema + structuredContent；工具 title；30 新用例
- [x] **C1 Peer 自动路由**（32f7acf）：熔断状态机（3 失败/30s 冷却/half-open 单探测）+ EWMA 时延选路 + peer_summary 转发指标 + remotePeer 'auto'；31 新用例

## Wave 1b — P0 成本与可靠性（并行）✅ 2026-10-16

- [x] **B1 Token 治理**（150ec8f）：TOOL_PROFILE（full=358/356KB、standard=227/232KB、minimal=103/102KB，默认 full）；search_tools 摘要化 + limit；15 工具描述瘦身；20 新用例
- [x] **D1 内存 soak + HTTP e2e**（e9caf71）：soak 5 用例（会话×800/SSE×600/agent-context×500/CAD 切换×100，堆增长<50MB）+ HTTP e2e 6 用例；耗时净增 ≈0.7s

## Wave 2a — P1 质量（并行）✅ 2026-10

- [x] **E1 覆盖率 41.7% → ≥60%**（4d7bdba）：补 sampling/plugin-loader/debug-engine/audit-log/cad-router/lint-handlers/routes/logger/autostart 测试；当前行覆盖 63.5%
- [x] **F1 大文件拆分**：resource-handlers.js 1583 → 318 行，拆为 resource-readers/resource-snapshot/resource-defs，对外 handler 函数名不变

## Wave 2b — P1 新能力 ✅ 2026-11

- [x] **G1 长任务引擎**：`task-engine.js` + `task_submit/status/result/list/cancel`；并发 2、状态落盘、TTL 24h、进度走 notifications/progress（2026-11）
- [x] **J1 插件示例**：3 个官方示例插件 + `tests/unit/examples-plugins.test.js`

## Wave 3 — P2 增强 ✅ 2026-11

- [x] **H1 sampling 补完**：`stream:true` SSE 解析、`SAMPLING_PROVIDERS` 降级链、token/成本指标（2026-11）
- [x] **I1 elicitation 破坏性确认**：`ELICITATION_MODE=off|destructive|all`，默认 off；不支持客户端降级放行
- [x] **K1 错误结构化**：`withErrorContext()`/`summarizeArgs()`，错误带 tool/instance/phase/correlationId，审计同步关联 ID
- [x] **L1 启动 profiling**：`--profile-startup` + `npm run profile:startup`；传输层/可选模块懒加载（stdio 启动约 -3%，未达 400ms 目标，瓶颈是 390 个工具 schema 与 handler 依赖链）
- [x] **M1 OTel Grafana 模板**：`deploy/grafana/atlisp-mcp-dashboard.json` + `docs/observability.md`；修复直方图后缀位于标签之后的 Prometheus 非法格式

## 里程碑

| 版本 | 内容 |
|---|---|
| v1.10 | Wave 1a + 1b |
| v1.11 | Wave 2a + 2b |
| v1.12 | Wave 3 |

## 兼容性红线

- TOOL_PROFILE 默认 full，现有 Agent 工具发现行为不变
- 协议升级保留 2024-11-05 回退（peer/Windows 旧客户端）
- 大文件拆分后 handler-loader 自动发现不重复注册
- 每波结束全量 `npm run lint`（0 问题）+ `npm test` 全绿 + `npm run build` 成功
