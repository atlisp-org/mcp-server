# mcp-server 优化与新功能路线图（2026 Q4）

> 制定于 2026-10-16，基于 v1.9.13 现状盘点（358 工具 / 协议 2024-11-05 / 覆盖率 41.7% / schema 177KB）。
> 执行方式：按波次推进，每波结束跑全量 lint + test + build，通过后 commit + `npm run release minor`。

## Wave 1a — P0 基础（并行）✅ 2026-10-16

- [x] **A1 MCP 协议升级**（81c68e7）：PROTOCOL_VERSION 动态协商（现 2025-11-25，回退 2024-11-05）；12 个查询工具 outputSchema + structuredContent；工具 title；30 新用例
- [x] **C1 Peer 自动路由**（32f7acf）：熔断状态机（3 失败/30s 冷却/half-open 单探测）+ EWMA 时延选路 + peer_summary 转发指标 + remotePeer 'auto'；31 新用例

## Wave 1b — P0 成本与可靠性（并行）✅ 2026-10-16

- [x] **B1 Token 治理**（150ec8f）：TOOL_PROFILE（full=358/356KB、standard=227/232KB、minimal=103/102KB，默认 full）；search_tools 摘要化 + limit；15 工具描述瘦身；20 新用例
- [x] **D1 内存 soak + HTTP e2e**（e9caf71）：soak 5 用例（会话×800/SSE×600/agent-context×500/CAD 切换×100，堆增长<50MB）+ HTTP e2e 6 用例；耗时净增 ≈0.7s

## Wave 2a — P1 质量（并行）

- [ ] **E1 覆盖率 41.7% → ≥60%**：补 sampling/plugin-loader/debug-engine/audit-log/cad-router/lint-handlers/routes/logger/autostart 测试
- [ ] **F1 大文件拆分**：resource-handlers.js（1583 行）按域拆分，对外 handler 函数名不变

## Wave 2b — P1 新能力

- [ ] **G1 长任务引擎**：task-engine + task_* 工具；批量操作可异步返回 taskId；进度走 notifications/progress
- [ ] **J1 插件示例**：3 个官方示例插件（自定义工具/事件钩子/审计）+ 加载冒烟测试

## Wave 3 — P2 增强

- [ ] **H1 sampling 补完**：流式、失败降级链（vllm→deepseek→openai→echo）、token 成本记账进 metrics
- [ ] **I1 elicitation 破坏性确认**：destructiveHint 工具按配置向客户端请求确认
- [ ] **K1 错误结构化**：createError 附带 tool/instance/hint 上下文，工具错误结果可被 Agent 自我纠错
- [ ] **L1 启动 profiling**：import 链分析 + 重模块懒加载
- [ ] **M1 OTel Grafana 模板**：工具耗时/CAD 忙等/peer 成功率看板

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
