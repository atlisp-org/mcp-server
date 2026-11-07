# 可观测性（Metrics / Tracing / Grafana）

## 1. 指标暴露

启用 `METRICS_ENABLED=true`（默认）后：

- `GET /metrics`：Prometheus 文本格式（`src/metrics.js` 的 `getMetrics()`）；
- 同时通过 OpenTelemetry Prometheus exporter 在 `:9464/metrics` 暴露 OTel 指标；
- `GET /health`、`GET /health/full`：存活/深度健康检查。

### 指标清单

| 指标 | 类型 | 说明 |
|---|---|---|
| `atlisp_mcp_uptime` | gauge | 进程运行秒数 |
| `atlisp_mcp_requests_total` | counter | 进入服务的请求数 |
| `atlisp_mcp_tool_call_total{result,tool}` | counter | 工具调用次数（success/error） |
| `atlisp_mcp_tool_duration_ms_{count,sum,avg,min,max,p50,p90,p95,p99}{tool}` | 直方图摘要 | 工具耗时 |
| `atlisp_mcp_cad_commands_total` | counter | 发送给 CAD 的命令数 |
| `atlisp_mcp_errors_total` | counter | 错误数 |
| `atlisp_mcp_sessions_active` | gauge | 活跃 MCP 会话数 |
| `atlisp_mcp_cad_connected` | gauge | CAD 连接状态（0/1） |
| `atlisp_mcp_memory_bytes{type}` | gauge | rss/heapTotal/heapUsed/external |
| `atlisp_mcp_heap_limit_bytes` | gauge | V8 堆上限 |
| `atlisp_mcp_heap_used_ratio` | gauge | heapUsed / heapLimit |
| `atlisp_mcp_mcp_method_total{method}` | counter | JSON-RPC 方法调用数 |
| `atlisp_mcp_sampling_requests_total{provider,model,status}` | counter | Sampling LLM 调用 |
| `atlisp_mcp_sampling_tokens_{input,output}_total{provider,model}` | counter | Sampling token 用量 |
| `atlisp_mcp_sampling_cost_micros_total{provider,model}` | counter | 估算成本（美元 × 1e6） |

> 注意：直方图摘要的后缀（`_p95` 等）必须位于标签之前，否则 Prometheus 会拒绝
> 该行；`metrics.js` 已按此格式输出，相关用例在 `tests/metrics.test.js`。

## 2. Prometheus 抓取配置

```yaml
scrape_configs:
  - job_name: atlisp-mcp
    metrics_path: /metrics
    static_configs:
      - targets: ['192.168.1.53:8110']
```

若启用了 `MCP_API_KEY`，请在反向代理层放行 `/metrics`（或给抓取端加白名单），
不要让指标暴露到公网。

## 3. Grafana 看板

导入 `deploy/grafana/atlisp-mcp-dashboard.json`，选择 Prometheus 数据源即可。面板：

- 工具调用速率（success/error）
- 工具耗时 P50/P95/P99（全局与单工具）
- 错误 / CAD 命令速率
- 活跃会话、CAD 连接状态、堆使用率、运行时长
- 进程内存与堆上限
- Sampling 调用与 token 速率

## 4. Tracing

`TRACING_ENABLED=true` 时通过 OTLP HTTP 上报（默认 `http://127.0.0.1:4318/v1/traces`），
每个工具调用生成 `tool.<name>` span，属性包含 `tool.name`、`session.id`、`tool.readOnly`。

## 5. 常见告警

| 条件 | 含义 | 处理 |
|---|---|---|
| `rate(atlisp_mcp_errors_total[5m]) > 0.1` | 持续报错 | 查 `~/.atlisp/logs/audit.log` 与 `debug.log` |
| `atlisp_mcp_heap_used_ratio > 0.8` | 内存接近上限 | 检查是否有超大查询；`GET /health/full` 看 RSS |
| `atlisp_mcp_cad_connected == 0` 超过 5 分钟 | CAD 断开 | 检查 CAD 进程/Worker 日志 |
| `atlisp_mcp_tool_duration_ms_p95 > 30000` | CAD 响应异常 | 看是否弹窗阻塞或命令队列积压 |
| `rate(atlisp_mcp_sampling_requests_total{status="failed"}[5m]) > 0` | Sampling 降级 | 检查 provider key 与网络 |
