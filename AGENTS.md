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
npm run build:tray   # 构建 Windows 托盘程序 → dist/AtlispTray.exe + dist/AtlispUpdater.exe（跨平台，见 tray/README.md）
```

- 构建使用 `esbuild`，`build:main` 打包入口文件，`build:worker` 复制 `cad-worker.js`、`lisp-security.js`、`logger.js`、`config.js`、`html/`、`handlers/` 到 `dist/`，`build:rot` 编译 `src/cad-rothelper.cs` → `dist/cad-rothelper.dll`（Windows 用系统 csc.exe；非 Windows 用 dotnet Roslyn + net48 参考程序集交叉编译，缺 dotnet 时告警跳过——发布机需装 .NET SDK，否则 npm 包内缺 dll，Windows 端 CAD 实例发现不可用）
- CI 在 `tools/mcp-server` 目录下运行（本仓库在 monorepo 中位于 `tools/mcp-server/`，但当前检出已为根目录）

## 架构要点

```
AI Agent → (MCP协议) → mcp-server (Node.js) → edge-js → .NET COM → CAD
```

- **edge-js 仅 Windows 可用**——`edge-js` 依赖 .NET Runtime，非 Windows 平台无法连接 CAD
- **Docker 仅 stdio 模式**——Docker 下无法连接 Windows CAD，仅用于 `TRANSPORT=stdio` 模式测试
- **CAD 通信**：`cad.js` 通过子进程 `cad-worker.js` 通信。worker 使用 `edge-js` 调用 .NET COM，通过 stdin/stdout JSON 行协议通信
- **读批处理**：`cad.js` 的 `ReadBatcher` 将只读命令（以 `(tblnext`/`(ssget`/`(entget` 等开头）在 50ms 窗口内批量合并发送
- **SendCommand 255 字符限制**：超过 255 字符的代码自动降级为临时文件方式（`cadSendWithResult`）；临时文件方式会先把 tmp 目录写进 `TRUSTEDPATHS` 免弹信任框，写不进去（中望/浩辰等）则改走内存分块注入，见下文「信任弹窗与 TRUSTEDPATHS」
- **工具定义**：`src/tools/` 下 47 个文件定义工具 Schema（共 379 个工具，以 `npm run build` 后 tools 数组为准），`src/tools/index.js` 合并为 `tools` 数组并添加 `readOnlyHint`/`destructiveHint`/`category` 注解，并为每个工具生成人类可读的 `title`（取描述首段）
- **协议版本**：`src/constants.js` 的 `PROTOCOL_VERSION` 取自 SDK 的 `LATEST_PROTOCOL_VERSION`（不再写死，当前 2025-11-25）；Server 握手按 SDK `SUPPORTED_PROTOCOL_VERSIONS` 协商，旧客户端仍可回退 2024-11-05（`mcp-scanner.js` 用该常量做探测）
- **结构化输出**：查询类工具在定义中声明 `outputSchema`，对应 handler 同时返回 `content`（文本，向后兼容）与 `structuredContent`（JSON）；`src/tool-executor.js` 统一透传 structuredContent，并在缺少 content 时回填 JSON 文本块（解析辅助见 `src/handlers/structured-output.js`）
- **远程 Peer 转发**：Linux 服务器可将 CAD 工具调用转发到 Windows 主机（MCP-to-MCP）。`src/peer-discovery.js` UDP 广播发现（端口 9811）、`src/peer-manager.js` 管理 peer 生命周期（健康检查/静态 peer）、`src/peer-proxy.js` HTTP 转发（JSON + SSE）、`src/peer-forward.js` 转发白名单（`peer_`/`skill_`/`webhook_`/`audit_` 等本地管理工具永不转发）
- **调度**：`src/mcp-tools.js` 的 `TOOL_HANDLERS` 映射工具名到处理函数，参数运行时校验（类型/enum/范围/必填）。skill 管理函数（5 个）已抽取到 `handlers/skill-handlers.js`，元工具（list_tools_by_category/search_tools/get_tool_info/prompts）抽取到 `handlers/meta-handlers.js`
- **处理器**：`src/handlers/` 下 36 个文件实现具体 LISP 代码生成和 CAD 调用
- **安全**：`lisp-security.js` 是统一安全模块（已合并原 lisp-sandbox.js），21 条规则 + session allowlist + 威胁分级（block/warn/allow），同时被 `cad-worker.js`（执行层）和 `mcp-tools.js`（校验层）使用
- **配置**：env var → `~/.atlisp/atlisp.config.json` → CLI args 三层优先级，使用 Zod.coerce 做类型转换，支持热重载
- **熔断器**：`src/cad-circuit-breaker.js` 独立管理 CAD 连接熔断逻辑（从 cad.js 提取）

## 图纸知识库（atlisp-dwg-kb）集成

`dwg_kb_*`（17 个工具，其中 15 个只读）把**历史图纸库**接进 MCP：CAD 工具管「当前打开的图」，这组管「跨文件找图/统计/版本演进/图号互引/复核队列/图层反查/单图双轨校验」。

- **实现**：`src/handlers/dwg-kb-handlers.js`（HTTP 客户端 + handler，直连 Node，不经 LISP）→ `atlisp-dwg-kb serve`（默认 `127.0.0.1:8322`）
- **配置**：`DWG_KB_URL` / `DWG_KB_API_KEY` / `DWG_KB_TIMEOUT`（也可写进 `~/.atlisp/atlisp.config.json` 的 `dwgKb`）；key 必须与知识库侧 `DWG_KB_API_KEY` 一致，否则 `/drawings`、`/search` 等 401
- **降级约定**：知识库没起时返回 `{ok:false, reachable:false, hint}`，**不抛异常**——否则模型会把「服务没开」读成「查不到图纸」
- **延迟**：`/search` 5–20s、`/review_queue` ~44s（扫整个 extract 目录）、`/query` 可能几十秒；handler 内已按端点设置 20–90s 超时，别改回统一的 10s
- **类型**：全部 `readOnlyHint=true`、`category=图纸知识库`，已加入 standard profile；`open_dwg` 等写入工具仍走原有确认逻辑

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
- **npm 安装脚本**：`edge-js` ≥25.0.0 的 `tools/install.js` 在 Windows 上**无条件**
  `spawn dotnet build`（CoreCLR bootstrap），没装 .NET SDK 的机器会以
  `Error: spawn dotnet ENOENT` 让 `npm install -g @atlisp/mcp` 退出码 1。因此依赖**锁在
  24.0.5**（最后一个带 dotnet 探测的版本，`lib/edge.js` 与 25.0.1 完全一致，只少 Node 25
  预编译原生文件）。升级 edge-js 前先确认上游修了这个脚本；兜底逻辑仍保留：托盘
  `EdgeNativeSupport.InstallArgs()/Repair()`、`install.ps1` 的 `Repair-EdgeNative` 在检测不到
  `dotnet` 时用 `--ignore-scripts` 安装，并把 VC 运行时 DLL 复制到
  `edge-js/lib/native/win32/<arch>/<node-abi>/`（安装脚本本该做的唯一有用步骤）

### CAD 侧生成 LISP 的硬约束（踩过的坑）

mcp-server 生成的 LISP **不能假设执行它的 CAD 会话加载了 @lisp lib**——是否加载取决于会话启动方式。
（踩过的坑：曾用 `(member 'require (atoms-family 1))` 判断"未加载"，其实 **`atoms-family` 的 format=1
返回字符串**，用引号符号比对永远为 nil；正确写法 `(member "STRING:PARSE-BY-LST" (atoms-family 1))`
或 `(print <fn>)`。实测 `.50` 的会话里 lib 是加载的。）
因此生成代码仍按"可能没有 lib"来写：
- **默认自包含**：只用 AutoLISP 内建 + 代码内 `defun` 的 `@xx:` 辅助函数，**不得直接调用 lib/包函数**（`require`、`string:parse-by-lst`、`block:get-attributes` 等），调用失败会被 `vl-catch-all` 吞成静默 nil
- **双路径是唯一例外**（frames 资源）：先用 `(member "FRAME:XXX" (atoms-family 1))` 探测 lib（按字符串比对），命中才走 `frame:*`，且每个 lib 调用都包 `vl-catch-all-apply`、出错回落内联实现；回落分支保持自包含，响应回传 `lib` 标记说明实际走哪条路径。新代码要复用 lib 时照此模式，不要写成硬依赖
- **不要把 `T` 当值用**：实测某会话 `T` 被绑成 `nil`、另一会话被绑成字符串。`(setq hit T)` / `(and cond T)` / `(while ... T)` 会静默失效。用字面量 `1`（永不失效）
- **ActiveX 属性读取**：`vla-get-Attributes` 报「函数错误」，必须用方法形式 `(vl-catch-all-apply 'vlax-invoke (list obj 'GetAttributes))`；`vlax-invoke` 直接返回 VLA-OBJECT 列表，**不要再套 `vlax-variant-value`**；读取前用 `vla-get-HasAttributes` 判定，勿用 `entnext`（无属性 INSERT 会返回数据库下一个实体 → 假阳性）
- **输出格式**：worker 用 `(princ r f)` 写结果，直接返回 list 会丢字符串引号（空串值 `("A" "")` 变成 `("A")`、块名带空格会被拆开）。统一 `(vl-prin1-to-string (list ...))` 收尾，且条目用 `(list "k" v)` 而非 `(cons "k" v)`（后者 value 为 nil 时退化成 `("k")`，服务端按二元对消费会丢字段）
- **结果只能是返回值**：worker 只把被加载代码的**表达式返回值**写进结果文件（`(princ r f)`），`princ` 到命令行/回显的内容不会出现在 `sendCommandWithResult` 的结果里。探测类代码（如 @lisp 的 token）必须让 token 作为最终返回值，不能用 `(princ "TOKEN")` 后返回 nil
- **标志位用 nil 不用 0**：AutoLISP 里只有 nil 为假，`0` 是真值。`(setq flag 0)` 后再 `(if flag ...)` 会恒真，未保存图纸判断踩过这个坑
- **冻结表跨仓同步**：图框标准表 `frame-standards.js` ↔ lib `frame:` ↔ `packages/at-plot`；属性别名表 `frame-aliases.js` ↔ lib `frame:aliases`（单测有跨仓守卫）
- **信任弹窗与 TRUSTEDPATHS**：长代码（>255 字符或要结果）走 `%USERPROFILE%\@lisp\tmp` 的临时 `.lsp` + `(load ...)`，
  在非受信任目录会弹「无法验证该可执行文件的发布者，且该文件不在受信任文件夹内」，阻断非交互执行。
  `cad-worker.js` 的 `cadSendWithResult` 与 `cad-rothelper.cs` 的 `RotSendWithResult` 都必须先用 COM
  `doc.GetVariable("TRUSTEDPATHS")` / `SetVariable` 把 tmp 目录追加进去（对照 `kernel/src/setup.lsp` 的
  `@::add-path-in-trustedpaths`：分号分隔、大小写不敏感比对、只追加）——**不能用命令行 `setvar`**，
  那条代码加路径必然超 255 字符，又会绕回文件方式（鸡生蛋）。
  **读失败时绝不能写**：内层 catch 若把值当成 `""` 再 SetVariable，会用「空值 + tmp」覆盖用户已有的整串信任路径。
  中望/浩辰可能根本没有这个变量、BricsCAD 的该变量只读、AutoCAD 也可能被管理员锁定，
  所以 `trustReady=false` 时改走**分块通道**：代码按 LISP 字符串常量分块注入命令行（`(chr 10)` 还原换行，
  别依赖 `\n` 转义；只转义 `\\` 和 `\"`，反斜杠先转），末尾
  `(eval (read (strcat "(progn " *atlisp_chunk* ")")))` 在内存执行——全程不 load 文件，任何 CAD 都不会弹信任框。
  单条命令控制在 250 字符内（packing 预算 180）；单测 `tests/cad-trusted-paths.test.js` 守这些不变式
- **@lisp 自动引导**：默认 `AUTO_INSTALL_ATLISP=true`。`cad.connect()` 成功后通过连接事件（`onCadConnected`，覆盖所有连接路径与连接池切换实例）统一触发探测 `@::init-once` / `@::load-module`，未安装先检查未保存图纸，再从 `https://atlisp.cn/@` 安装、`https://atlisp.cn/cloud` 加载函数库，等待 `BASE:INIT`。未保存图纸会**跳过**自动安装（安装脚本会弹窗/exit）。生成 LISP 仍保持自包含，不能假设引导一定成功。

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

## 后台中继（daemon relay）

`/agent/chat` 页面里的中继会随页面卸载消失，所以「关掉页面后服务端 Agent 继续操作 CAD」
由本机常驻的 atlisp-mcp 承担（`src/relay-client.js`）：

```
atlisp-mcp ──WSS + 用户 token──▶ atlisp.cn /agent/relay/ws
           ◀── {type:"rpc", method, params} ──
           ── {type:"rpc-result", id, json: "<JSON 文本>"} ──▶
```

- **配对**：页面登录后 `POST /api/relay/pair {token, uri}`（本机，官方 CORS 白名单内）。
  服务端用该 token 调一次 `/api/user/info` 校验，通过后写 `~/.atlisp/relay.json`（0600）；
  `GET /api/relay/status` 查状态，`POST /api/relay/unpair` 撤销。
- **鉴权**：WS 握手带 `Cookie: atlisp_token=…`；服务端 `register` 帧 `kind:"daemon"`
  必须解析到用户，否则拒绝（页面保留宽松）。token 失效时页面下次加载会重新配对。
- **CAD 门槛**：只有 `cad.connected` 为真才 `register`，否则每 5s 重试；已登记后
  CAD 断开则主动关 WS 让服务端注销，避免抢占真正连着 CAD 的页面。
- **服务端优先级**（`api/agent-relay.lisp`）：已连 CAD 的 daemon > 页面 > 未连 CAD 的 daemon。
  页面与 daemon 同时在线是正常的；daemon 用独立 peerId（`daemon-<host>-<hash>`）。
- **帧格式**：`rpc-result` 的结果放在 `json` 且必须是**字符串**（服务端原样嵌回
  JSON-RPC 响应；对象会被 cl-json 压小写键）。`tools/list` / `resources/list` /
  `resources/read`（含 `atlisp://dwg/context-bundle`）本地实现，`tools/call` 走
  `handleToolCall` + `validateLispCode` 预校验。
- **部署**：需要把新版 atlisp-mcp 装到**用户 CAD 所在机器**；旧版没有这个模块，
  页面仍会用自身中继（但关页即停）。

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
npm publish                           # 发布到 npm（prepublishOnly 会重新构建 + 校验 dist 版本）

> 签名发布：`.github/workflows/sign-release.yml` 在 Windows runner 上构建并用
> Azure Trusted Signing / SignPath 给两个 exe 签名（凭据缺失时跳过）；publish job 用
> `npm publish --ignore-scripts`，避免重编译覆盖已签名产物。手动签名见 `tray/README.md`。
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
| `src/relay-client.js` | 后台中继：连接服务端 relay WS、配对/状态、执行 rpc |
| `src/mcp-tools.js` | 工具调度：TOOL_HANDLERS 映射、参数校验、审计、资源变更通知 |
| `src/mcp-handlers.js` | MCP 协议处理器（initialize/tools/list/call） |
| `src/tool-executor.js` | 工具执行引擎：参数校验/限速检查/Undo 包装/审计写入/错误统一处理 |
| `src/tool-validators.js` | 参数运行时校验（类型/enum/范围/必填），抛出 MCPError |
| `src/cad.js` | CAD 连接：命令队列、读批处理、心跳、Worker 管理、连接代理、连接代数（`connectionEpoch`） |
| `src/atlisp-bootstrap.js` | @lisp 自动安装/加载：探测 `@::init-once`、未保存图纸检查、install/init、就绪缓存 |
| `src/command-queue.js` | 命令队列：三级优先级、去重、读命令批处理（`ReadBatcher`） |
| `src/plugin-loader.js` | 插件加载与热重载：目录扫描、`onInit`/`onUnload`、文件监听 |
| `src/error-reporter.js` | ERROR 日志上报：指纹去重、批量 flush、失败兜底（`ERROR_REPORT_ENABLED`） |
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
| `tray/AtlispTray.cs` | Windows 托盘管理工具：启停服务、检查更新/定时自动升级、按 manifest 下载并交给更新器替换自身、知识库（Python）自动安装/升级/自愈、Node.js 安装（zip 校 SHA256 / MSI 校签名 / 手动优先 winget）、日志/面板、自启动（单文件 C# 5，见 `tray/README.md`） |
| `tray/AtlispUpdater.cs` | 独立更新器 `AtlispUpdater.exe`：等旧托盘退出 → 校验 SHA256 + Authenticode → 覆盖 → 启动。**刻意几乎不修改**，hash 长期稳定以积累杀软信誉；不自更新、不联网、不写注册表 |
| `tray/CodeSign.cs` | `WinVerifyTrust` 封装（托盘与更新器共用）：校验下载的安装包/待替换的 exe 的 Authenticode 签名 |
| `tray/build.ps1` | Windows 托盘构建脚本：用系统自带 csc.exe 编译到 `dist/AtlispTray.exe`，`-Install` 复制到用户目录并建快捷方式 |
| `scripts/build-tray.mjs` | 跨平台托盘构建：Windows 调用 `tray/build.ps1`，Linux/macOS 用 dotnet + net48 参考程序集交叉编译 |
| `scripts/build-tray-manifest.mjs` | 生成 `dist/tray-manifest.json`（版本 + 每个 exe 的 SHA256/大小 + 下载源列表）与 `dist/SHASUMS256.txt`；签名后必须重新生成 |
| `scripts/upload-tray.mjs` | 把签名后的 exe/manifest 上传到 atlisp.cn `/upload`，对外地址 `https://atlisp.cn/download/<文件名>`（国内主源） |
| `tray/tray-download.js` | 托盘二进制下载器：按 manifest 校验 SHA256 后落到 `%LOCALAPPDATA%\Programs\atlisp-mcp`；下载源按 `baseUrls` 顺序尝试（atlisp.cn/download → GitHub），`ATLISP_TRAY_BASE_URL` 可强制单源 |
| `tray/atlisp-tray.js` | npm `atlisp-tray` 命令：解包后的包内没有 exe，首次运行下载并校验，然后启动 |
| `scripts/build-rot.mjs` | 跨平台编译 `src/cad-rothelper.cs` → `dist/cad-rothelper.dll`（同 build-tray 方案） |
| `scripts/net48-refs.mjs` | net48 交叉编译公共辅助：Roslyn csc 定位 + 参考程序集下载/缓存 |
