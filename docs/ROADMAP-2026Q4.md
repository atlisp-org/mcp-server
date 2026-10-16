# mcp-server 优化与新功能路线图（2026 Q4）

> 制定于 2026-10-16，基于 v1.9.13 现状盘点（358 工具 / 协议 2024-11-05 / 覆盖率 41.7% / schema 177KB）。
> 执行方式：按波次推进，每波结束跑全量 lint + test + build，通过后 commit + `npm run release minor`。

## Wave 1a — P0 基础（并行）

- [ ] **A1 MCP 协议升级**：PROTOCOL_VERSION 动态协商（SDK 已支持 2025-11-25）；工具 `outputSchema` + 查询类工具 `structuredContent`；InMemory 双版本握手测试
- [ ] **C1 Peer 自动路由**：`peer_auto` 按健康/时延选 peer；每 peer 熔断器 + 冷却；转发指标进 peer_summary；remotePeer 支持 'auto'

## Wave 1b — P0 成本与可靠性（并行）

- [ ] **B1 Token 治理**：TOOL_PROFILE 配置（full/standard/minimal，默认 full 无行为变化）；运行时 `title` 字段；search_tools 返回摘要而非全量 schema；描述去重瘦身；启动打印 payload 体积
- [ ] **D1 内存 soak + HTTP e2e**：会话/agent-context 千次创建销毁增长斜率断言；HTTP 传输 e2e（握手→tools/list→工具调用）

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
