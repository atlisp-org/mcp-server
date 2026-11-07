# 2026-11 开发计划交付说明

对应计划：`docs/PLAN-2026-11.md`。基线 v1.12.24，工具 390 个。

## P0 稳定与可验证性

| 项 | 变更 | 文件 |
|---|---|---|
| main 红灯 | 资源清单改为显式期望集合（含 `context-bundle`），新增 URI 唯一性断言 | `tests/resource.test.js` |
| 覆盖率可观测 | `coverage.reportOnFailure=true` + 阈值（行 60 / 函数 55 / 分支 50 / 语句 58） | `vitest.config.js` |
| CI | Node 22 + Linux 额外跑 `npm run test:coverage` | `.github/workflows/ci.yml` |
| 注册表守卫 | 工具名唯一、snake_case 断言 | `tests/index.test.js` |

## G1 长任务引擎

- `src/task-engine.js`：状态机 `queued/running/succeeded/failed/cancelled`；并发默认 2（`ATLISP_TASK_CONCURRENCY`）；
  状态落盘 `~/.atlisp/tasks.json`（`ATLISP_TASKS_FILE` 可覆盖）；完成保留 24h、最多 200 条；
  结果 >256KB 截断；重启时未完成任务标记失败；取消在步骤之间生效。
- 工具：`task_submit` / `task_status` / `task_result` / `task_list` / `task_cancel`，分类「任务」，各 profile 可见。
- 执行复用 `handleToolCall`（校验/限速/Undo/审计/插件钩子），进度转发 `notifications/progress`。
- 测试：`tests/unit/task-engine.test.js`（13 例）、`tests/unit/task-handlers.test.js`（5 例）。

## I1 elicitation 破坏性确认

- `src/elicitation.js`：`ELICITATION_MODE=off|destructive|all`，默认 `off`；
  仅当客户端声明 `elicitation` 能力时请求确认；确认结果按 session+tool+args 缓存 5 分钟；请求失败降级放行。
- 接入点：`mcp-handlers.js` 的 `CallToolRequestSchema`，拒绝时返回 `USER_DECLINED`。
- 测试：`tests/unit/elicitation.test.js`（8 例）。

## K1 错误结构化

- `errors.js`：新增 `withErrorContext()`、`summarizeArgs()`；新增错误码 `USER_DECLINED`/`TASK_NOT_FOUND`/`TASK_CANCELLED`。
- 工具错误响应同时返回 `content`（兼容）与 `structuredContent.error`（tool/instance/phase/correlationId/args/details）。
- 审计日志新增 `correlationId`；日志中的参数改为摘要，避免大段 LISP 代码落盘。
- 测试：`tests/unit/tool-executor.test.js` K1 分组（3 例）。

## H1 sampling 补完

- 流式：`stream:true` 或 `LLM_STREAM=true`，解析 SSE（忽略坏事件，支持 usage）。
- 降级链：`SAMPLING_PROVIDERS=vllm,deepseek,openai`，逐个尝试，全部失败回退 echo；未配置时保持旧行为。
- 成本：`estimateCostUsd()` + `sampling_*` 指标（token/成本/成功率）。
- 测试：`tests/unit/sampling-stream.test.js`（6 例）。

## L1 启动 profiling

- `--profile-startup` 输出模块加载总耗时后退出；`npm run profile:startup` 逐模块独立进程测量。
- 懒加载：express 路由、streamable-http、WebSocket、relay-client、error-reporter、health-reporter、autostart。
- 实测：入口 import 约 1005ms（原 1027–1045ms）。瓶颈为 390 个工具 schema 与 handler 依赖链。

## M1 可观测性

- `deploy/grafana/atlisp-mcp-dashboard.json`：工具速率/耗时 P50-P95-P99/错误/CAD 命令/会话/内存/采样。
- `docs/observability.md`：指标清单、抓取配置、告警建议。
- 修复 `metrics.js` 直方图输出：`_p95` 等后缀移到标签之前，避免 Prometheus 拒绝。

## 验证

```bash
npm run lint     # 0 问题
npm test         # 全绿
npm run build    # 成功
npm run test:coverage
```
