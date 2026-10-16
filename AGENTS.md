# @lisp MCP Server — AI Agent 开发指南

## 项目概述

@lisp MCP Server 是 AI Agent 与 CAD 之间的桥接层——通过 MCP 协议提供 330+ 工具供 Agent 调用，底层通过 `edge-js` → .NET COM 互操作控制 AutoCAD/ZWCAD/GStarCAD/BricsCAD。

## 常用命令

```bash
npm install          # 安装依赖
npm run build        # esbuild 打包 dist/atlisp-mcp.js + 复制 worker/handlers/html
npm test             # 运行全部测试 (vitest)
npm run test:watch   # 监视模式测试
npm start            # node src/atlisp-mcp.js 开发模式
```

- 构建使用 `esbuild`，`build:main` 打包入口文件，`build:worker` 复制 `cad-worker.js`、`lisp-security.js`、`logger.js`、`config.js`、`html/`、`handlers/` 到 `dist/`，`build:rot` 编译 `src/cad-rothelper.cs` → `dist/cad-rothelper.dll`（Windows only，需要 csc.exe）
- CI 在 `tools/mcp-server` 目录下运行（本仓库在 monorepo 中位于 `tools/mcp-server/`，但当前检出已为根目录）

## 架构要点

```
AI Agent → (MCP协议) → mcp-server (Node.js) → edge-js → .NET COM → CAD
```

- **edge-js 仅 Windows 可用**——`edge-js` 依赖 .NET Runtime，非 Windows 平台无法连接 CAD
- **Docker 仅 stdio 模式**——Docker 下无法连接 Windows CAD，仅用于 `TRANSPORT=stdio` 模式测试
- **CAD 通信**：`cad.js` 通过子进程 `cad-worker.js` 通信。worker 使用 `edge-js` 调用 .NET COM，通过 stdin/stdout JSON 行协议通信
- **读批处理**：`cad.js` 的 `ReadBatcher` 将只读命令（以 `(tblnext`/`(ssget`/`(entget` 等开头）在 50ms 窗口内批量合并发送
- **SendCommand 255 字符限制**：超过 255 字符的代码自动降级为临时文件方式（`cadSendWithResult`）
- **工具定义**：`src/tools/` 下 45 个文件定义工具 Schema（共 358 个工具，以 `npm run build` 后 tools 数组为准），`src/tools/index.js` 合并为 `tools` 数组并添加 `readOnlyHint`/`destructiveHint`/`category` 注解，并为每个工具生成人类可读的 `title`（取描述首段）
- **协议版本**：`src/constants.js` 的 `PROTOCOL_VERSION` 取自 SDK 的 `LATEST_PROTOCOL_VERSION`（不再写死，当前 2025-11-25）；Server 握手按 SDK `SUPPORTED_PROTOCOL_VERSIONS` 协商，旧客户端仍可回退 2024-11-05（`mcp-scanner.js` 用该常量做探测）
- **结构化输出**：查询类工具在定义中声明 `outputSchema`，对应 handler 同时返回 `content`（文本，向后兼容）与 `structuredContent`（JSON）；`src/tool-executor.js` 统一透传 structuredContent，并在缺少 content 时回填 JSON 文本块（解析辅助见 `src/handlers/structured-output.js`）
- **远程 Peer 转发**：Linux 服务器可将 CAD 工具调用转发到 Windows 主机（MCP-to-MCP）。`src/peer-discovery.js` UDP 广播发现（端口 9811）、`src/peer-manager.js` 管理 peer 生命周期（健康检查/静态 peer）、`src/peer-proxy.js` HTTP 转发（JSON + SSE）、`src/peer-forward.js` 转发白名单（`peer_`/`skill_`/`webhook_`/`audit_` 等本地管理工具永不转发）
- **调度**：`src/mcp-tools.js` 的 `TOOL_HANDLERS` 映射工具名到处理函数，参数运行时校验（类型/enum/范围/必填）。skill 管理函数（5 个）已抽取到 `handlers/skill-handlers.js`，元工具（list_tools_by_category/search_tools/get_tool_info/prompts）抽取到 `handlers/meta-handlers.js`
- **处理器**：`src/handlers/` 下 36 个文件实现具体 LISP 代码生成和 CAD 调用
- **安全**：`lisp-security.js` 是统一安全模块（已合并原 lisp-sandbox.js），21 条规则 + session allowlist + 威胁分级（block/warn/allow），同时被 `cad-worker.js`（执行层）和 `mcp-tools.js`（校验层）使用
- **配置**：env var → `~/.atlisp/atlisp.config.json` → CLI args 三层优先级，使用 Zod.coerce 做类型转换，支持热重载
- **熔断器**：`src/cad-circuit-breaker.js` 独立管理 CAD 连接熔断逻辑（从 cad.js 提取）

## 添加新工具

1. 在 `src/tools/` 下创建 `<name>-tools.js`，导出含 `name`/`description`/`inputSchema` 的 `tools` 数组（Zod 定义 Schema）
2. 在 `src/tools/index.js` 中 import 并 spread 到 `tools` 数组
3. 在 `src/handlers/` 下创建 `<category>-handlers.js`，导出异步函数（命名约定：snake_case 工具名自动转为 camelCase 函数名）
4. handler 自动发现——文件名为 `*-handlers.js` 即在 `handler-loader.js` 中被注册
5. 若函数名与转换规则不符，在 `handler-loader.js` 的 `FUNCTION_OVERRIDES` 中添加映射
6. 参数校验自动生效——`mcp-tools.js` 的 `validateToolArgs()` 读取 `inputSchema.properties`

## 关键约定

- **模块系统**：ES Module（`"type": "module"`）
- **编码**：源文件 UTF-8，CAD 通信使用系统 ANSI 编码（GBK 兼容），`eval_lisp_with_result` 支持 `encoding` 参数
- **错误处理**：使用 `errors.js` 的 `createError()`，禁止空 catch 块；CAD 执行错误必须保持完整错误信息链
- **路径安全**：接受文件路径的工具必须调用 `validateFilePath()`（`handler-utils.js`）检查 `..` 穿越
- **流式限制**：`streaming.js` 默认 20000 实体上限（`MAX_ENTITY_LIMIT` 环境变量可配），超限返回错误而非执行 `ssget "_X"`
- **Webhook**：失败自动指数退避重试 3 次（1s/2s/4s），总耗时 ≈ 7s
- **队列清理**：`resetWorker()` 会同时清空 `CommandQueue`，确保残留命令不被消费

## 远程 Peer 转发（Linux → Windows CAD）

CAD 连接仅 Windows 可用，Linux 上的 MCP Server 通过 peer 机制将业务工具调用转发到 Windows 主机的 MCP 实例：

```
AI Agent → (MCP) → Linux mcp-server → (HTTP/JSON-RPC) → Windows mcp-server → CAD
```

- **显式转发**：`peer_call_tool {peerId, tool, args, timeout}` 工具将任意业务工具转发到指定 peer；本地管理/计算工具（`peer_*`/`skill_*`/`webhook_*`/`sandbox_*`/`audit_*`/`debug_*`/`agent_*`/`session_*`/`watch_*`/`lisp_repl*` 前缀及 `search_tools`/`analyze_lisp_code` 等）由 `isForwardableTool()` 拒绝
- **自动转发**（opt-in）：配置 `REMOTE_PEER_AUTO_FORWARD=true` 后，`tool-executor.js` 捕获 `CAD_NOT_CONNECTED` 错误自动转发到 `config.remotePeer` 对应的 peer；转发成功写入审计 `target: "peer:<id>"`
- **配置**：`REMOTE_PEER_HOST/PORT/API_KEY/AUTO_FORWARD` 环境变量或 `~/.atlisp/atlisp.config.json` 的 `remotePeer` 字段；`peerDiscovery.peers` 静态列表在 `start()` 时注册（跳过指向本机的自身，防转发循环）
- **健康检查**：静态 peer（`static: true`）不会被 `_healthCheck` 误删；`peer_connect` 手动添加的 peer 也标记为静态
- **限制**：UDP 广播发现仅限同子网（跨网段需 `peer_connect` 手动添加）；转发的调用在远端走完整 `runToolCall` 流程（校验/限速/Undo/审计），但本地会话状态（如 REPL 变量）不跨机同步

## 测试

```bash
npm test              # 运行全部 vitest 测试 (63 个测试文件, 899 用例)
npm run test:watch    # 监视模式
npm run test:coverage # 覆盖率报告 (coverage/)
npm run lint          # eslint 检查（CI 强制，必须 0 问题）
```

- 测试 mock CAD 连接（不依赖真实 CAD），`fetch` 全局 mock 为拒绝状态
- 不支持 `node --experimental-vm-modules`

## CI

```yaml
npm ci → npm run build → npm test     # Node 20/22/24
npm run lint                          # eslint（强制，0 问题才算通过）
npm run release <patch|minor|major>   # 版本发布：bump + CHANGELOG + git tag
```

## Lint 代码分析

使用 `@atlisp/parser` + `@atlisp/lint` 对 AutoLISP 代码进行结构化分析。

### 分析模块

`src/lint-analyzer.js` 提供统一分析入口：
- **安全层**：通过 `@atlisp/lint` 的 `runChecks()` 执行 70+ 检查规则（括号、参数数量、危险函数、命名约定、未使用变量）
- **质量层**：同上，集成于同一次调用

### 集成点

| 位置 | 行为 |
|------|------|
| `eval_lisp` / `eval_lisp_with_result` 预检 | error → 阻止执行 |
| `at_command` 预检 | error → 阻止执行 |
| `analyze_lisp_code` 工具 | 独立调用分析，返回 JSON |
| `format_lisp_code` 工具 | 格式化 AutoLISP 代码 |
| `list_lint_rules` 工具 | 列出所有可用规则 |
| `lint_project` 工具 | 批量分析目录中的文件 |

### CLI 参数

| 参数 | 作用 |
|------|------|
| `--lint-preset <preset>` | 选择预设: `recommended`/`strict`/`relaxed` |
| `--lint-config <path>` | 指定 `atlisp-lint.json` 路径 |
| `--lint-level <level>` | `error`/`warn`/`off` |
| `--no-lint` / `--lint-off` | 跳过 lint 预检查 |

### 常用规则

| 规则名 | 默认级别 | 说明 |
|--------|---------|------|
| `parens` | error | 括号平衡 |
| `quit_exit` | error | quit/exit 调用 |
| `startapp` | error | 启动外部程序 |
| `command_shell` | error | (command "shell" ...) |
| `shadow_builtin` | error | 覆盖内建函数 |
| `extra_parens` | error | 多余括号 |
| `builtin_arg_count` | error | 内建函数参数数量 |

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/atlisp-mcp.js` | 入口：CLI 解析、Express 服务器、MCP 初始化 |
| `src/mcp-tools.js` | 工具调度：TOOL_HANDLERS 映射、参数校验、审计、资源变更通知 |
| `src/mcp-handlers.js` | MCP 协议处理器（initialize/tools/list/call） |
| `src/tool-executor.js` | 工具执行引擎：参数校验/限速检查/Undo 包装/审计写入/错误统一处理 |
| `src/tool-validators.js` | 参数运行时校验（类型/enum/范围/必填），抛出 MCPError |
| `src/cad.js` | CAD 连接：命令队列、读批处理、心跳、Worker 管理、连接代理 |
| `src/cad-worker.js` | Worker 进程：edge-js COM 调用、LISP 代码缓存（SHA256）、安全检查、长代码降级 |
| `src/cad-circuit-breaker.js` | 熔断器独立模块（从 cad.js 提取） |
| `src/cad-pool.js` | 连接池管理：多 CAD 实例连接/切换/健康检查/自动重连 |
| `src/cad-router.js` | 会话级实例路由：按 sessionId 绑定 CAD 实例 |
| `src/lisp-security.js` | 统一安全模块：21 条规则、括号检查、字符串剥离、session allowlist |
| `src/lisp-sandbox.js` | 重导出 shim——所有逻辑已迁移到 lisp-security.js |
| `src/handler-loader.js` | 懒加载 + 热重载（fs.watch 监听 handlers/ 目录变化） |
| `src/config.js` | 配置管理：三层合并、Zod coerce 类型转换、热重载 |
| `src/routes.js` | HTTP 路由：中间件链（auth/rate-limit/CORS）、MCP/SSE/调试面板 |
| `src/errors.js` | 错误定义：`MCPError`、`createError`、15 个预定义错误码 |
| `src/peer-discovery.js` | Peer 发现：UDP 广播（端口 9811）、peer 注册/过期清理 |
| `src/peer-manager.js` | Peer 生命周期：健康检查、静态 peer 加载、`getRemotePeer()` |
| `src/peer-proxy.js` | Peer 转发：HTTP JSON-RPC 转发（支持 JSON/SSE 响应、超时、API Key） |
| `src/peer-forward.js` | 转发白名单：`isForwardableTool()`、`forwardToolCall()`、`getAutoForwardPeer()` |
| `src/handler-utils.js` | 工具函数：`validateFilePath`、`escapeLispString`、`parseLispList`、`ensureCadConnected` |
| `src/tools/index.js` | 工具 Schema 聚合（39+ 文件合并）及 readOnlyHint/destructiveHint + category 注解 |
| `src/streaming.js` | 分页流式读取（单 `streamEntities()` 替代原先 3 个函数） |
| `src/handlers/meta-handlers.js` | 元工具处理器：search_tools / list_tools_by_category / get_tool_info |
| `src/handlers/skill-handlers.js` | Skill 管理器注册/搜索/安装/卸载 |
| `src/handlers/resource-handlers.js` | 资源读取器：16+ 个 URI 的读写逻辑 |
| `src/handlers/resource-defs.js` | 资源定义和表查询配置 |
| `src/handlers/resource-cache.js` | 资源缓存（per-instance 隔离 + TTL） |
| `src/prompts/loader.js` | Prompt 加载器（内置定义 + 外部文件 + 处理函数） |
| `src/prompts/renderer.js` | Prompt 模板渲染引擎 |
| `src/prompts/definitions/*.json` | 27 个内置 Prompt 模板定义 |
| `src/repl-engine.js` | REPL 引擎：交互式 Lisp 会话，自动追踪 setq 变量 |
| `src/trigger-engine.js` | 触发器引擎：CAD 变更事件注册/等待 |
| `src/webhook-engine.js` | Webhook 引擎：事件驱动 HTTP 回调，持久化到 `~/.atlisp/webhooks.json` |
| `src/html/*.html` | UI 模板：API 文档、调试面板、Playground（`__KEY__` 占位符） |
