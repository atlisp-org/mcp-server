# @lisp MCP Server 使用文档

## 目录

- [架构概述](#架构概述)
- [传输模式](#传输模式)
- [MCP 协议功能](#mcp-协议功能)
- [AI Agent 集成](#ai-agent-集成)
- [CAD 连接池](#cad-连接池)
- [管道 Pipeline](#管道-pipeline)
- [触发器 Watch](#触发器-watch)
- [Webhook](#webhook)
- [REPL 会话](#repl-会话)
- [流式读取](#流式读取)
- [沙箱安全](#沙箱安全)
- [审计日志](#审计日志)
- [外部数据源](#外部数据源)
- [速率限制](#速率限制)
- [Prometheus 指标](#prometheus-指标)
- [SSL/TLS 加密](#ssltls-加密)
- [API Key 认证与 RBAC](#api-key-认证与-rbac)
- [配置热重载](#配置热重载)
- [故障排除](#故障排除)

---

## 架构概述

```
AI Agent ──(MCP 协议)──→ @lisp MCP Server ──(edge-js)──→ .NET COM ──→ CAD
```

@lisp MCP Server 是 AI Agent 与 CAD 之间的桥接层。它通过 MCP (Model Context Protocol) 提供 **220+ 个工具**供 AI Agent 调用，底层通过 `edge-js` → .NET COM 互操作控制 AutoCAD/ZWCAD/GStarCAD/BricsCAD。

### 通信流程

1. **AI Agent** 通过 MCP 协议发送 JSON-RPC 请求（如 `tools/call`）
2. **MCP Server** 解析请求、参数校验、速率限制、RBAC 权限检查
3. 调用对应 **handler**，生成 AutoLISP 代码
4. **CAD Worker** 子进程通过 edge-js 将 LISP 代码发送到 CAD 执行
5. 结果沿原路返回给 AI Agent

### 进程模型

```
┌─────────────────────────────────────┐
│  atlisp-mcp (Node.js 主进程)        │
│  ├── express HTTP server            │
│  ├── MCP session manager            │
│  ├── connection pool                │
│  ├── plugin loader / watcher        │
│  └── metrics / logging              │
│                                     │
│  cad-worker (子进程, per instance)   │
│  ├── edge-js → .NET COM → CAD       │
│  ├── CommandQueue (命令队列)        │
│  ├── CircuitBreaker (熔断器)        │
│  └── LispSecurity (安全规则)        │
└─────────────────────────────────────┘
```

---

## 传输模式

MCP Server 支持 4 种传输模式，每种适用于不同的 Agent 集成场景：

### HTTP 模式（默认）

```bash
atlisp-mcp                                    # 默认端口 8110
atlisp-mcp --port 9000 --host 127.0.0.1       # 自定义
TRANSPORT=http atlisp-mcp                     # 通过环境变量
```

适用于：远程 Agent（通过 HTTP 网络连接）、多会话场景。

Agent 通过 `POST http://localhost:8110/mcp` 发送 JSON-RPC 请求，支持批处理（数组请求体 → 数组响应）。

### Streamable HTTP 模式

```bash
TRANSPORT=streamable-http atlisp-mcp
```

MCP 规范的推荐传输方式，支持：
- `POST /mcp` — JSON-RPC 请求
- `GET /mcp` — SSE 流式响应（长操作进度推送）
- 每个请求自动管理 `mcp-session-id` 会话头

与普通 HTTP 模式的区别：
- 会话管理由 SDK 内部处理
- 支持长操作流式返回
- 符合 MCP Streamable HTTP 规范

### SSE 模式

使用 HTTP 模式时自动启用 SSE，Agent 通过以下方式连接：

```bash
# Agent 连接 SSE 端点获取事件
GET http://localhost:8110/sse
# 通过 message 端点发送请求
POST http://localhost:8110/message?sessionId=<id>
```

SSE 支持：
- `Last-Event-ID` 断线重连（自动恢复丢失事件）
- 30 秒心跳保活
- 资源变更推送

### stdio 模式

```bash
TRANSPORT=stdio atlisp-mcp
# 或
atlisp-mcp --stdio
```

适用于：Claude Desktop / Cline / Cursor / opencode 等桌面 Agent（通过 stdin/stdout 通信）。

### WebSocket 模式

```bash
TRANSPORT=ws atlisp-mcp
# 或
atlisp-mcp --ws
```

适用于：浏览器端 Agent 或需要双向推送的场景。端点：`ws://localhost:8110/ws`

---

## MCP 协议功能

### 服务器能力声明 (Capabilities)

Server 在初始化时声明以下能力：

| 能力 | 说明 |
|------|------|
| `tools.listChanged` | 插件加载/卸载时推送工具列表变更 |
| `resources.subscribe` | 支持资源订阅推送 |
| `resources.listChanged` | 资源列表变更通知 |
| `prompts.listChanged` | 提示模板变更通知 |
| `logging` | 日志消息推送（按会话级别过滤） |
| `completions` | 参数自动补全 |
| `experimental.*` | 管道/触发器/REPL/Webhook/速率限制/去重 |

### 请求处理器

| 请求 | 方法 | 说明 |
|------|------|------|
| `tools/list` | `ListToolsRequestSchema` | 分页列出工具（100/页，base64 游标） |
| `tools/call` | `CallToolRequestSchema` | 调用工具（含进度通知、UNDO、速率限制） |
| `resources/list` | `ListResourcesRequestSchema` | 列出资源（100/页，支持订阅筛选） |
| `resources/templates/list` | `ListResourceTemplatesRequestSchema` | 列出资源模板 |
| `resources/read` | `ReadResourceRequestSchema` | 读取资源（支持 text/blob） |
| `resources/subscribe` | `SubscribeRequestSchema` | 订阅资源变更 |
| `resources/unsubscribe` | `UnsubscribeRequestSchema` | 取消订阅 |
| `prompts/list` | `ListPromptsRequestSchema` | 列出提示模板（50/页） |
| `prompts/get` | `GetPromptRequestSchema` | 获取提示模板详情 |
| `completion/complete` | `CompleteRequestSchema` | 参数补全（layer/block/linetype/工具等） |
| `ping` | `PingRequestSchema` | 健康检查（SDK 内置） |
| `logging/setLevel` | `SetLevelRequestSchema` | 设置日志级别（SDK 内置） |

### 通知处理器

| 通知 | 说明 |
|------|------|
| `notifications/cancelled` | 客户端取消请求 → 发送 ESC 到 CAD |
| `notifications/initialized` | 客户端初始化完成 → 触发 `oninitialized` 回调 |
| `notifications/roots/list_changed` | 客户端工作区根变更（记录日志） |
| `notifications/progress` | 客户端进度通知（记录日志） |
| `notifications/resources/list_changed` | 客户端资源列表变更（空处理） |
| `notifications/tools/list_changed` | 客户端工具列表变更（空处理） |

### 资源 URI

| URI | 类型 | 说明 |
|-----|------|------|
| `atlisp://cad/info` | 静态 | CAD 连接信息 |
| `atlisp://dwg/name` | 订阅 | 当前 DWG 文件名 |
| `atlisp://dwg/path` | 订阅 | 当前 DWG 文件路径 |
| `atlisp://dwg/entities` | 订阅 | 实体统计 |
| `atlisp://dwg/text-content` | 订阅 | 文字内容 |
| `atlisp://dwg/text-combined` | 订阅 | 合并后段落文本 |
| `atlisp://dwg/block-refs` | 订阅 | 块参照 |
| `atlisp://dwg/tbl` | 订阅 | CAD 表数据 |
| `atlisp://cad/dwgs` | 订阅 | 所有打开的 DWG |
| `atlisp://packages` | 订阅 | 已安装包列表 |
| `atlisp://platforms` | 静态 | 支持平台列表 |
| `atlisp://standards/drafting` | 静态 | CAD 制图规范 |
| `atlisp://standards/coding` | 静态 | @lisp 编码规范 |

资源模板：

| 模板 | 示例 |
|------|------|
| `atlisp://dwg/entity/{handle}` | `atlisp://dwg/entity/1F3A` |
| `atlisp://dwg/entities?type={type}&layer={layer}&bbox={bbox}` | `atlisp://dwg/entities?type=LINE&layer=0` |
| `atlisp://dwg/block-refs/{blockName}` | `atlisp://dwg/block-refs/门` |
| `atlisp://dwg/tbl/{table}` | `atlisp://dwg/tbl/layer` |
| `atlisp://dwg/text-content?offset=0&limit=100` | 分页文字 |
| `atlisp://packages?search={query}` | `atlisp://packages?search=json` |

---

## AI Agent 集成

### 通用配置

```json
{
  "mcpServers": {
    "atlisp-mcp": {
      "command": "atlisp-mcp",
      "args": ["--port", "8110"]
    }
  }
}
```

### Agent 控制 CAD 示例

Agent 可以通过以下步骤操作 CAD：

**1. 连接 CAD**

```json
{"name": "connect_cad", "arguments": {}}
```

**2. 查询状态**

```json
{"name": "get_system_status", "arguments": {}}
```

**3. 执行操作**

```json
{
  "name": "draw_line",
  "arguments": { "p1": "0,0", "p2": "100,100" }
}
```

**4. 执行自定义 LISP**

```json
{
  "name": "eval_lisp_with_result",
  "arguments": {
    "code": "(getvar 'cdwmname)",
    "encoding": "gbk"
  }
}
```

### 多工具协同

```json
[
  {"name": "connect_cad", "arguments": {}},
  {"name": "create_layer", "arguments": {"name": "墙体", "color": "1"}},
  {"name": "set_current_layer", "arguments": {"name": "墙体"}},
  {"name": "draw_line", "arguments": {"p1": "0,0", "p2": "10000,0"}},
  {"name": "draw_line", "arguments": {"p1": "0,0", "p2": "0,8000"}},
  {"name": "zoom_extents", "arguments": {}}
]
```

支持 JSON-RPC 批处理——一次性发送数组请求体，服务器并行处理并返回数组结果。

---

## CAD 连接池

多 CAD 实例管理能力，适用于同时连接 AutoCAD 和 ZWCAD、或多个 CAD 绘图任务。

### 连接池工具

| 工具 | 说明 |
|------|------|
| `cad_pool_discover` | 扫描并发现所有运行的 CAD 实例 |
| `cad_pool_switch` | 切换到指定实例作为当前操作目标 |
| `cad_pool_health` | 检查所有实例健康和响应时间 |
| `cad_pool_stats` | 获取池统计（总数/活跃数/各实例状态） |

### 池策略

| 策略 | 说明 |
|------|------|
| `round-robin` | 轮询分配新连接 |
| `least-loaded` | 优先分配到队列最短的实例 |
| `failover` | 主实例失效时自动切换备用 |

### 连接生命周期

```
createConnection() → connect() → [use] → disconnect() → removeConnection()
                       │
                   健康检查(每30s心跳)
                   超时自动重连(指数退避)
                   熔断器(5次失败开放60s)
```

### 配置

```json
{
  "maxPoolSize": 3,
  "poolStrategy": "least-loaded",
  "poolHealthCheckInterval": 30000
}
```

---

## 管道 Pipeline

Pipeline 是工具编排引擎，支持将多个工具调用串联为自动化工作流。

### 基本管道

```json
{
  "name": "pipeline_execute",
  "arguments": {
    "steps": [
      { "tool": "create_layer", "args": { "name": "墙体", "color": "1" } },
      { "tool": "set_current_layer", "args": { "name": "墙体" } },
      { "tool": "draw_rectangle", "args": { "corner1": "0,0", "corner2": "10000,8000" } },
      { "tool": "zoom_extents", "args": {} }
    ]
  }
}
```

### 变量引用

每一步的输出可以通过 `$ref:<stepName>.<property>` 语法引用到后续步骤中：

```json
{
  "name": "pipeline_execute",
  "arguments": {
    "steps": [
      {
        "name": "info",
        "tool": "get_entity",
        "args": { "handle": "1F3A" }
      },
      {
        "name": "copy",
        "tool": "copy_entity",
        "args": {
          "handle": "1F3A",
          "dx": "$ref:info.center.x",
          "dy": "$ref:info.center.y"
        }
      }
    ]
  }
}
```

### 条件执行

```json
{
  "name": "pipeline_execute",
  "arguments": {
    "steps": [
      {
        "name": "check",
        "tool": "get_entity",
        "args": { "handle": "1F3A" }
      },
      {
        "name": "delete_if_exists",
        "tool": "delete_entity",
        "args": { "handle": "1F3A" },
        "condition": "$ref:check.success"
      },
      {
        "name": "create",
        "tool": "draw_circle",
        "args": { "center": "50,50", "radius": 30 }
      }
    ]
  }
}
```

### 错误处理

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `continueOnError` | boolean | false | 某步失败是否继续 |
| `timeout` | number | 30000 | 每步超时时间(ms) |

### 保存与执行

```json
{"name": "pipeline_save", "arguments": { "name": "墙体绘制", "steps": [...] }}
{"name": "pipeline_list", "arguments": {}}
{"name": "pipeline_run", "arguments": { "name": "墙体绘制" }}
{"name": "pipeline_delete", "arguments": { "name": "墙体绘制" }}
```

---

## 触发器 Watch

触发器用于监控 CAD 状态变更，条件满足时触发通知。

### 触发器类型

| 类型 | 说明 | 参数 |
|------|------|------|
| `entity_count` | 某类型实体数量变化 | `filter.type`, `operator`, `value` |
| `layer_exists` | 指定图层是否存在 | `layerName` |
| `layer_count` | 图层数量变化 | `operator`, `value` |
| `doc_name` | 文档名称变更 | `pattern` |
| `custom_lisp` | 自定义 LISP 条件 | `lispCode` |

### 示例

```json
// 等待实体数量超过 100
{
  "name": "watch_register",
  "arguments": {
    "type": "entity_count",
    "filter": { "type": "LINE" },
    "operator": "gte",
    "value": 100
  }
}

// 等待图层 "门窗" 被创建
{
  "name": "watch_register",
  "arguments": {
    "type": "layer_exists",
    "layerName": "门窗"
  }
}

// 自定义 LISP 条件（当变量 > 100 时触发）
{
  "name": "watch_register",
  "arguments": {
    "type": "custom_lisp",
    "lispCode": "(> (getvar 'cdwmname) 100)"
  }
}
```

### 注册并等待（合并操作）

```json
{
  "name": "watch_create_and_wait",
  "arguments": {
    "type": "layer_exists",
    "layerName": "标注",
    "timeout": 60000
  }
}
```

### 管理触发器

```json
{"name": "watch_list", "arguments": {}}
{"name": "watch_remove", "arguments": { "id": "watch-xxx" }}
{"name": "watch_wait", "arguments": { "id": "watch-xxx", "timeout": 30000 }}
```

---

## Webhook

Webhook 支持在特定事件发生时向指定 URL 发送 HTTP POST 回调。

### 支持的事件

| 事件 | 触发条件 |
|------|----------|
| `tool_executed` | 任意工具调用完成 |
| `package_installed` | 包安装成功 |
| `cad_connected` | CAD 连接建立 |
| `cad_disconnected` | CAD 连接断开 |
| `error_occurred` | 错误发生 |

### 注册

```json
{
  "name": "webhook_register",
  "arguments": {
    "url": "https://example.com/webhook",
    "events": ["tool_executed", "error_occurred"],
    "name": "监控告警",
    "secret": "my-signing-key"
  }
}
```

### Webhook 请求格式

```http
POST /webhook HTTP/1.1
Content-Type: application/json
X-Webhook-Secret: my-signing-key

{
  "event": "tool_executed",
  "timestamp": "2026-01-15T10:30:00Z",
  "data": {
    "tool": "eval_lisp",
    "result": "success",
    "duration": 1234
  }
}
```

### 管理

```json
{"name": "webhook_list", "arguments": {}}
{"name": "webhook_remove", "arguments": { "id": "wh-xxx" }}
{"name": "webhook_log", "arguments": { "id": "wh-xxx" }}
```

失败自动重试 3 次（1s/2s/4s 指数退避）。

---

## REPL 会话

交互式 Lisp 执行会话，自动追踪变量和命令历史。

### 使用

```json
// 自动创建新会话
{
  "name": "lisp_repl",
  "arguments": { "code": "(setq x 42)" }
}

// 继续已有会话（变量保持）
{
  "name": "lisp_repl",
  "arguments": { "sessionId": "sess-xxx", "code": "(* x 2)" }
}
```

### 管理

```json
{"name": "lisp_repl_list", "arguments": {}}
{"name": "lisp_repl_history", "arguments": { "sessionId": "sess-xxx" }}
{"name": "lisp_repl_close", "arguments": { "sessionId": "sess-xxx" }}
```

---

## 流式读取

分页流式读取大量 CAD 数据，避免 OOM。

### 实体流

```json
{
  "name": "stream_entities",
  "arguments": {
    "type": "LINE",
    "layer": "0",
    "chunk": 500,
    "offset": 0
  }
}
```

最大 50000 个实体上限，超出返回错误。

### 文字流

```json
{
  "name": "stream_text",
  "arguments": {
    "layer": "文字",
    "offset": 0,
    "limit": 100
  }
}
```

### 块参照流

```json
{
  "name": "stream_block_refs",
  "arguments": {
    "blockName": "门",
    "offset": 0,
    "limit": 100
  }
}
```

---

## 沙箱安全

LISP 代码安全验证，阻止危险操作。

### 安全规则

21 条内置规则覆盖：

| 类别 | 规则 |
|------|------|
| 代码执行 | `eval`, `apply`, `load`, `autoload` |
| 进程控制 | `startapp`, `vl-exit-with-value`, `vl-exit-with-error` |
| 文件 I/O | `open`(写模式), `vl-file-copy`, `vl-file-delete`, `vl-file-rename` |
| COM | `vlax-create-object`, `vlax-get-object`, `vlax-import-type-library` |
| CAD 危险 | `vla-Delete`, `vla-Save`, `(command "_.purge")`, `(command "_.wdim")` |

### 验证

```json
{
  "name": "sandbox_validate",
  "arguments": {
    "code": "(setq x (eval '(getvar 'cdwmname)))"
  }
}
```

返回威胁等级和安全/危险判断。

### 白名单

```json
{
  "name": "sandbox_allowlist_add",
  "arguments": { "sessionId": "sess-xxx", "ruleIndex": 0 }
}

{
  "name": "sandbox_allowlist_clear",
  "arguments": { "sessionId": "sess-xxx" }
}
```

---

## 审计日志

所有工具调用自动记录到 `~/.atlisp/audit.log`。

### 查询

```json
{
  "name": "audit_log_query",
  "arguments": {
    "tool": "eval_lisp",
    "fromDate": "2026-01-01T00:00:00Z",
    "toDate": "2026-06-05T00:00:00Z",
    "result": "error",
    "offset": 0,
    "limit": 100
  }
}
```

### 统计

```json
{"name": "audit_log_stats", "arguments": {}}
```

返回：总条目数、各工具调用次数、错误数、日志文件大小。

---

## 外部数据源

读取/导入/导出 CSV 和 JSON 文件到 CAD。

### 数据源位置

`~/.atlisp/data/` 目录下的 `.json` 和 `.csv` 文件。

### 查询

```json
{
  "name": "external_db_query",
  "arguments": {
    "source": "building-materials",
    "filters": { "city": "北京" }
  }
}
```

### 导入到 CAD

```json
{
  "name": "import_external_data",
  "arguments": {
    "source": "points",
    "targetLayer": "测量点",
    "mapping": { "x": "X", "y": "Y", "label": "name" }
  }
}
```

### 导出到文件

```json
{
  "name": "export_to_external",
  "arguments": {
    "format": "csv",
    "filter": { "layer": "墙体" }
  }
}
```

---

## 速率限制

双层速率限制防止资源滥用：

### 维度

| 层级 | 范围 | 默认 |
|------|------|------|
| 全局 | 所有请求 | 100/分钟 |
| 读工具 | 查询类工具(readOnly) | 200/分钟 |
| 写工具 | 修改类工具 | 50/分钟 |
| API Key | 按 Key 隔离 | 1000/分钟 |

### 分类

读限速器 (`readLimiter`) 应用于：`get_*`, `list_*`, `search_*`, `find_*`, `measure_*`, `stream_*` 等

写限速器 (`writeLimiter`) 应用于：`create_*`, `set_*`, `delete_*`, `batch_*`, `draw_*`, `insert_*`, `attach_*` 等

### 状态与重置

```bash
curl http://localhost:8110/rate-limit/status
curl -X POST http://localhost:8110/rate-limit/reset
```

---

## Prometheus 指标

当 `METRICS_ENABLED=true`（默认）时，`GET /metrics` 返回 Prometheus 格式指标。

### 指标列表

| 指标 | 类型 | 标签 | 说明 |
|------|------|------|------|
| `atlisp_mcp_uptime` | gauge | — | 运行时长(秒) |
| `atlisp_mcp_requests_total` | counter | — | 总请求数 |
| `atlisp_mcp_tool_call_total` | counter | `tool`, `result` | 工具调用次数 |
| `atlisp_mcp_tool_duration_ms` | histogram | `tool` | 工具耗时(ms, p50/p90/p99) |
| `atlisp_mcp_cad_commands_total` | counter | — | CAD 命令发送数 |
| `atlisp_mcp_errors_total` | counter | — | 错误总数 |
| `atlisp_mcp_sessions_active` | gauge | — | 活跃会话数 |
| `atlisp_mcp_cad_connected` | gauge | — | CAD 连接状态 |
| `atlisp_mcp_method_total` | counter | `method` | MCP 方法调用量 |

---

## SSL/TLS 加密

```bash
atlisp-mcp --ssl-key /path/to/key.pem --ssl-cert /path/to/cert.pem
# 或
SSL_KEY_PATH=/path/to/key.pem SSL_CERT_PATH=/path/to/cert.pem atlisp-mcp
```

启用后自动切换到 HTTPS。

---

## API Key 认证与 RBAC

### 简单认证

```bash
MCP_API_KEY=my-secret-key atlisp-mcp
```

客户端请求时在 `Authorization: Bearer my-secret-key` 头中传递。

### 多用户 RBAC

配置文件：

```json
{
  "apiKeys": [
    { "key": "admin-key", "role": "admin", "limit": 1000 },
    { "key": "operator-key", "role": "operator", "limit": 500 },
    { "key": "viewer-key", "role": "viewer", "limit": 100 }
  ]
}
```

### 角色权限

| 角色 | 读工具 | 写工具 | 管理 |
|------|--------|--------|------|
| `admin` | ✓ | ✓ | ✓ |
| `operator` | ✓ | ✓ | ✗ |
| `viewer` | ✓ | ✗ | ✗ |

---

## 配置热重载

修改 `~/.atlisp/atlisp.config.json` 后自动热重载，无需重启服务。

也可手动触发：

```bash
curl -X POST http://localhost:8110/config/reload
```

---

## 故障排除

### 连接问题

| 现象 | 诊断 | 解决 |
|------|------|------|
| `connect_cad` 超时 | CAD 未启动或 COM 禁用 | 手动启动 CAD，检查 COM 权限 |
| `eval_lisp` 返回空 | CAD 繁忙或未响应 | 增大 `MESSAGE_TIMEOUT` |
| 括号错误 | LISP 语法问题 | MCP Server 会自动检查并提示 |
| 中文乱码 | 编码不匹配 | 使用 `encoding: gbk` 或 `vl-prin1-to-string` |

### 性能问题

| 现象 | 原因 | 解决 |
|------|------|------|
| 工具响应慢 | CAD 队列积压 | 减少并发请求，使用 `cad_pool_health` 检查 |
| 内存增长 | 资源缓存 | 调小 `RESOURCE_CACHE_TTL` |
| 请求被限 | 速率限制 | 检查 `rate-limit/status`，或增加限额 |

### 调试

```bash
DEBUG=true atlisp-mcp                    # 启用调试日志
DEBUG_FILE=/tmp/atlisp-debug.log atlisp-mcp  # 输出到文件
```

调试面板：浏览器访问 `http://localhost:8110/debug`

### 常见错误

| 错误码 | 说明 |
|--------|------|
| `-32600` | 请求格式错误 |
| `-32603` | 服务器内部错误 |
| `-32000` | 权限不足 |
| `-32001` | 速率限制 |
| `-32002` | CAD 未连接 |
