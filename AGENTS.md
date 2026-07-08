# @lisp MCP Server — AI Agent 开发指南

## 项目概述

@lisp MCP Server 是 AI Agent 与 CAD 之间的桥接层——通过 MCP 协议提供 220+ 工具供 Agent 调用，底层通过 `edge-js` → .NET COM 互操作控制 AutoCAD/ZWCAD/GStarCAD/BricsCAD。

## 常用命令

```bash
npm install          # 安装依赖
npm run build        # esbuild 打包 dist/atlisp-mcp.js + 复制 worker/handlers/html
npm test             # 运行全部测试 (vitest)
npm run test:watch   # 监视模式测试
npm start            # node src/atlisp-mcp.js 开发模式
```

- 构建使用 `esbuild`，`build:main` 打包入口文件，`build:worker` 复制 `cad-worker.js`、`lisp-security.js`、`logger.js`、`config.js`、`html/`、`handlers/` 到 `dist/`
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
- **工具定义**：`src/tools/` 下 38 个文件定义工具 Schema，`src/tools/index.js` 合并为 `tools` 数组并添加 `readOnlyHint`/`destructiveHint` 注解
- **调度**：`src/mcp-tools.js` 的 `TOOL_HANDLERS` 映射工具名到处理函数，参数运行时校验（类型/enum/范围/必填）
- **处理器**：`src/handlers/` 下 31 个文件实现具体 LISP 代码生成和 CAD 调用
- **安全**：`lisp-security.js` 是共享安全模块，21 条规则覆盖 eval/load/startapp/文件I/O/危险命令。同时被 `cad-worker.js`（执行层）和 `lisp-sandbox.js`（校验层，支持 session allowlist）使用
- **配置**：env var → `~/.atlisp/atlisp.config.json` → CLI args 三层优先级，`CONFIG_FILE` env var 可指定配置文件路径

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
- **流式限制**：`streaming.js` 有 50000 实体上限（`MAX_ENTITY_LIMIT`），超限返回错误而非执行 `ssget "_X"`
- **Webhook**：失败自动指数退避重试 3 次（1s/2s/4s），总耗时 ≈ 7s
- **队列清理**：`resetWorker()` 会同时清空 `CommandQueue`，确保残留命令不被消费

## 测试

```bash
npm test              # 运行全部 vitest 测试 (30 个测试文件)
npm run test:watch    # 监视模式
```

- 测试 mock CAD 连接（不依赖真实 CAD），`fetch` 全局 mock 为拒绝状态
- `tests/resource.test.js` 中 4 个测试在无 CAD 环境下会失败（~27/31 通过），这是**预期行为**；本地连接 CAD 后全部 31 个通过
- 不支持 `node --experimental-vm-modules`

## CI

```yaml
npm ci → npm run build → npm test     # Node 18/20
npx eslint src/ --ext .js             # lint (continue-on-error)
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
| `src/cad.js` | CAD 连接：熔断器、命令队列、读批处理、心跳、Worker 管理 |
| `src/cad-worker.js` | Worker 进程：edge-js COM 调用、LISP 代码缓存（SHA256）、安全检查、长代码降级 |
| `src/lisp-security.js` | 共享安全模块：21 条规则、括号检查、字符串剥离 |
| `src/lisp-sandbox.js` | 沙箱校验：session allowlist、威胁分级（block/warn/allow） |
| `src/handler-loader.js` | 懒加载：从 `handlers/` 目录自动发现 `*-handlers.js` 模块 |
| `src/config.js` | 配置管理：三层合并、Zod 校验、热重载 |
| `src/routes.js` | HTTP 路由：中间件链（auth/rate-limit/CORS）、MCP/SSE/调试面板 |
| `src/tools/index.js` | 工具 Schema 聚合（39 个文件合并）及 readOnlyHint/destructiveHint 注解 |
| `src/handler-utils.js` | 工具函数：`validateFilePath`、`escapeLispString`、`parseLispList`、`ensureCadConnected` |
| `src/errors.js` | 错误定义：`MCPError`、`createError`、10 个预定义错误码 |
| `src/streaming.js` | 分页流式读取（`streamEntitiesByType`/`streamTextContent`/`streamBlockRefs`） |
| `src/lint-analyzer.js` | Lint 分析：整合 `@atlisp/parser` + `@atlisp/lint`，提供 `analyzeLispCode()` |
| `src/pipeline-engine.js` | 管道引擎：多步工具链编排，支持 `$ref:stepName.property` |
| `src/repl-engine.js` | REPL 引擎：交互式 Lisp 会话，自动追踪 setq 变量 |
| `src/trigger-engine.js` | 触发器引擎：CAD 变更事件注册/等待 |
| `src/webhook-engine.js` | Webhook 引擎：事件驱动 HTTP 回调，持久化到 `~/.atlisp/webhooks.json` |
| `src/html/*.html` | UI 模板：API 文档、调试面板、Playground（`__KEY__` 占位符） |
| `src/html/*.html` | UI 模板：API 文档、调试面板、Playground（`__KEY__` 占位符） |
