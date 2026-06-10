# @lisp MCP Server — 开发指南

---

## 架构

```
┌─────────────┐     MCP Protocol     ┌─────────────────────┐
│  AI Agent   │ ◄──────────────────► │   @lisp MCP Server   │
│ (Claude/     │    stdio / HTTP /    │   (Node.js, edge-js) │
│  Cline/      │    SSE / WebSocket   │                      │
│  opencode)   │                      │   ┌───────────────┐  │
└─────────────┘                      │   │  .NET Runtime  │  │
                                     │   │  (COM Interop) │  │
                                     │   └───────┬───────┘  │
                                     └───────────┼──────────┘
                                                 │ COM
                                                 ▼
                                     ┌─────────────────────┐
                                     │       CAD            │
                                     │ (AutoCAD/ZWCAD/      │
                                     │  GStarCAD/BricsCAD)  │
                                     │                     │
                                     │ SendCommand + LISP   │
                                     └─────────────────────┘
```

### 数据流

1. MCP Server 通过 `edge-js` 调用 .NET 代码
2. .NET 通过 COM 互操作连接 CAD 应用程序
3. 支持获取运行中的 CAD 或自动启动新实例
4. 通过 `SendCommand` 向 CAD 发送 LISP 代码
5. 执行前自动检测 CAD 状态（IsQuiescent）
6. CAD 忙碌时自动等待（最多可配置重试次数）

### 传输模式

| 模式 | 适用场景 |
|------|----------|
| **HTTP** | 远程访问、多 Agent 共享、Web 前端 |
| **stdio** | 本地 AI Agent 直接调用（Claude/Cline/opencode） |
| **SSE** | 需要实时推送的长连接场景 |
| **WebSocket** | 双向实时通信 |

---

## 项目结构

```
tools/mcp-server/
├── src/
│   ├── atlisp-mcp.js          # 主入口
│   ├── config.js              # 配置管理
│   ├── constants.js           # 常量定义
│   ├── routes.js              # HTTP 路由
│   ├── cad.js                 # CAD 连接 (edge-js)
│   ├── cad-worker.js          # CAD 工作线程
│   ├── cad-pool.js            # CAD 连接池
│   ├── mcp-handlers.js        # MCP 协议处理器
│   ├── mcp-server-state.js    # 服务器状态
│   ├── mcp-tools.js           # 工具注册与通知
│   ├── tool-registry.js       # 工具注册表
│   ├── handler-loader.js      # 处理器动态加载
│   ├── handler-utils.js       # 处理器工具函数
│   ├── streaming.js           # 流式读取
│   ├── subscription-manager.js# 订阅管理
│   ├── session-transport.js   # 会话传输
│   ├── sse-session.js         # SSE 会话
│   ├── sse-session-manager.js # SSE 会话管理
│   ├── websocket-transport.js # WebSocket 传输
│   ├── auth.js                # 认证
│   ├── rate-limiter.js        # 速率限制
│   ├── logger.js              # 日志
│   ├── metrics.js             # Prometheus 指标
│   ├── errors.js              # 错误定义
│   ├── lisp-sandbox.js        # Lisp 沙箱
│   ├── pipeline-engine.js     # 管道引擎
│   ├── repl-engine.js         # REPL 引擎
│   ├── trigger-engine.js      # 触发器引擎
│   ├── webhook-engine.js      # Webhook 引擎
│   ├── audit-log.js           # 审计日志
│   ├── plugin-loader.js       # 插件加载器
│   ├── sampling.js            # LLM Sampling
│   ├── properties.lsp         # LISP 属性辅助
│   ├── tools/                 # MCP 工具定义 (32 files)
│   ├── handlers/              # 资源/请求处理器 (25 files)
│   ├── prompts/               # 提示模板处理
│   └── standards/             # 制图/编码规范
├── prompts/                   # 外部提示模板
├── skills/                    # AI Agent 技能
├── tests/                     # 测试
├── Dockerfile                 # Docker 构建
├── install.ps1                # Windows 安装脚本
├── package.json
├── README.md                  # 用户文档
└── DEV.md                     # 本文件 - 开发文档
```

### 核心模块说明

| 模块 | 文件 | 职责 |
|------|------|------|
| **主入口** | `atlisp-mcp.js` | HTTP 服务器、路由挂载、MCP 初始化 |
| **配置** | `config.js` | 环境变量 + 配置文件 + CLI 参数三层合并，支持热重载 |
| **CAD 连接** | `cad.js` | 通过 edge-js 调用 .NET COM 互操作 |
| **CAD 池** | `cad-pool.js` | 多 CAD 实例连接池管理 |
| **MCP 协议** | `mcp-handlers.js` | MCP initialize/tools/list/call 等协议处理 |
| **工具注册** | `tool-registry.js` | 工具注册、查找、Schema 管理 |
| **工具定义** | `tools/*.js` | 各分类工具的 Schema 定义 (32 个文件) |
| **资源处理** | `handlers/*.js` | MCP 资源读写、缓存、订阅 (25 个文件) |
| **流式读取** | `streaming.js` | 分页流式读取 CAD 实体/文字 |
| **SSE** | `sse-session.js` | Server-Sent Events 会话管理 |
| **WebSocket** | `websocket-transport.js` | WebSocket 传输层 |
| **管道** | `pipeline-engine.js` | 多步工具调用链编排引擎 |
| **REPL** | `repl-engine.js` | 交互式 Lisp REPL 会话引擎 |
| **触发器** | `trigger-engine.js` | CAD 变更触发器注册与等待 |
| **Webhook** | `webhook-engine.js` | 事件驱动 HTTP 回调引擎 |
| **沙箱** | `lisp-sandbox.js` | Lisp 代码安全验证 |
| **审计** | `audit-log.js` | 工具调用审计日志 |
| **指标** | `metrics.js` | Prometheus 指标导出 |

---

## 开发环境

```bash
# 克隆仓库
git clone <repo>
cd tools/mcp-server

# 安装依赖
npm install

# 启动开发模式
npm start

# 构建
npm run build

# 测试
npm test
npm run test:watch
```

---

## 添加新工具

1. 在 `src/tools/` 下创建工具定义文件（参考已有文件模式）
2. 使用 Zod 定义参数 Schema
3. 导出 `tools` 数组，每项含 `name`、`description`、`inputSchema`
4. 在 `src/tools/index.js` 中 import 并 spread 到 `tools` 数组
5. 在 `src/handlers/` 中创建对应的处理器（可选，若工具调用现有 handler 则不需要）

### 示例

```js
// src/tools/my-tools.js
import { z } from 'zod';

export const tools = [
  {
    name: 'my_new_tool',
    description: '我的新工具',
    inputSchema: z.object({
      param1: z.string().describe('参数1'),
      param2: z.number().optional().describe('参数2'),
    })
  }
];
```

```js
// src/tools/index.js 中注册
import { tools as my_tools } from './my-tools.js';
export const tools = [
  // ...existing tools,
  ...my_tools
];
```

---

## 自定义 Prompt

在 `prompts/` 目录下放置 `.json` 文件即可注册自定义提示模板，覆盖同名的内置提示。详见 `prompts/README.md`。

### 简单消息格式

```json
{
  "name": "my-custom-prompt",
  "description": "我的自定义提示",
  "arguments": [
    { "name": "param1", "description": "参数1说明", "required": true }
  ],
  "messages": [
    {
      "role": "user",
      "content": {
        "type": "text",
        "text": "提示内容，可使用 {param1} 作为占位符"
      }
    }
  ]
}
```

### 多模板格式

```json
{
  "name": "my-prompt",
  "description": "带多个动作的提示",
  "arguments": [
    { "name": "action", "description": "操作类型", "required": false, "default": "default" }
  ],
  "templates": {
    "default": {
      "code": "(command \"_line\" {arg1} {arg2} \"\")",
      "description": "从 {arg1} 到 {arg2} 的直线"
    }
  }
}
```

### 处理器提示

复杂提示使用独立的 JavaScript 处理器文件，放在 `src/prompts/handlers/` 目录：

```json
{
  "name": "analyze-drawing",
  "description": "分析当前图纸统计信息",
  "handlerFile": "analyze-drawing"
}
```

优先级：`handlerFile` > `templates` > `messages`

---

## 构建与发布

```bash
# 构建 dist
npm run build

# 发布到 npm
npm publish
```

构建使用 esbuild，将 `src/atlisp-mcp.js` 打包到 `dist/atlisp-mcp.js`，同时复制 `cad-worker.js` 到 `dist/`。

---

## Docker

```bash
# 构建镜像
docker build -t atlisp-mcp .

# 运行（注：Docker 下无法连接 Windows CAD，仅用于 stdio 模式测试）
docker run -e TRANSPORT=stdio atlisp-mcp
```

---

## 测试

```bash
# 运行所有测试
npm test

# 监视模式
npm run test:watch
```

测试文件位于 `tests/` 目录，使用 vitest。

---

## 编码规范

- 使用 ES Module (`"type": "module"`)
- 遵循现有代码风格（参考 `src/tools/` 和 `src/handlers/` 中的已有实现）
- Zod 用于参数 Schema 定义和验证
- 错误使用 `errors.js` 中定义的错误类型
- 配置通过 `config.js` 的 `getConfig()` 获取
- 异步操作使用 async/await

---

## 开发注意事项

### 安全规则必须保持同步

`src/lisp-security.js` 是共享安全模块，统一定义 21 条安全规则。`cad-worker.js`（执行层校验）和 `lisp-sandbox.js`（沙箱层校验）都引用此模块。**修改安全规则时只修改 `lisp-security.js`，禁止在其他文件中重复定义规则。**

`lisp-security.js` 同时导出两个校验函数：
- `validateLispCodeWorker(code)` → cad-worker 使用，简单返回 `{valid, error}`
- `checkParens(code)` → 括号匹配检查，cad-worker 中使用

`lisp-sandbox.js` 额外提供：
- `validateLispCode(code, sessionId)` → 支持 sessionId 做 allowlist 豁免
- session allowlist 管理函数

### SessionManager 单例模式

`SseSessionManager` 采用单例模式。**所有模块必须通过以下方式获取同一个实例：**

```js
import { sessionManager } from './subscription-manager.js';
```

**禁止**直接从 `sse-session-manager.js` import `getSingleton` 后再创建新引用——这会导致代码中存在两个变量名指向同一对象，造成混淆。

### 路径遍历防护

任何接受文件路径作为参数的工具，必须在 handler 中使用 `validateFilePath()`（见 `handler-utils.js`）或复用 `file-handlers.js` 中的本地校验函数。校验逻辑：

1. `path.normalize()` 规范化路径
2. 检查是否包含 `..`（路径穿越）
3. 可选：限制在允许的目录内、检查文件是否存在

受影响的工具包括但不限于：`open_dwg`, `save_dwg`, `export_pdf`, `import_dxf`, `import_dgn`, `export_dgn`, `attach_pdf`, `open_sheet_set`, `import_xdata_from_file`, `export_xdata_to_file`, `load_linetype`。

### HTML 模板占位符

`src/routes.js` 的 `/api/docs`、`/debug`、`/playground` 路由通过 `loadHtml()` 加载模板文件。模板文件位于 `src/html/*.html`，使用 `__KEY__` 格式的占位符。修改 UI 时编辑 `.html` 文件，不要回退到内联 HTML。

### 流式读取实体上限

`streaming.js` 中 `MAX_ENTITY_LIMIT = 50000`。当选择集实体数量超过此限制时，返回错误提示用户使用过滤条件缩小范围，而非直接执行 `ssget "_X"`。此限制保护 CAD 端不被超大选择集拖垮。

### Webhook 重试策略

`webhook-engine.js` 中 `MAX_RETRIES = 3`，`RETRY_BASE_DELAY = 1000`。失败时指数退避重试：1s → 2s → 4s。所有重试失败后记录错误日志。修改重试参数时注意总耗时 = `baseDelay * (2^retries - 1)`，避免超长阻塞。

### Worker 重置时清理命令队列

`cad.js` 中的 `resetWorker()` 必须同时调用 `commandQueue.clear()`。如果只清除 pending requests 而不清理队列，残留命令会在 worker 重启后被消费，但其 promise 已被 reject，导致未处理异常。

### 空 catch 块必须记录日志

禁止使用空 `catch {}` 或 `catch (e) {}`。至少应记录错误日志：

```js
// 正确
try { riskyOp(); } catch (e) { logError(`riskyOp failed: ${e.message}`); }

// 错误
try { riskyOp(); } catch {}
```

已有日志基础设施：`import { log, error as logError } from './logger.js'`。

### 错误信息传递链

CAD 执行错误必须保持完整的错误信息链：
- `cad-worker.js` 返回 `{ success: false, error: lastError?.message || '发送失败' }`
- `cad.js` 的 `sendCommand()` 使用 `result.error` 抛出 Error
- `mcp-tools.js` 的 `handleToolCall()` 捕获后展示给用户

**禁止**在任何环节用硬编码字符串替换原始错误信息。

### Edge-js / COM 互操作限制

- `edge-js` 依赖 .NET Runtime，**仅 Windows 平台可用**
- COM 互操作要求 CAD 已安装且注册 ProgID
- 每种 CAD 的 ProgID 不同：`AutoCAD.Application` / `ZWCAD.Application` / `GStarCAD.Application` / `BricscadApp.AcadApplication`
- `SendCommand` 有 255 字符限制，超长代码自动降级为临时文件方式

### 工具参数运行时校验

`mcp-tools.js` 中的 `validateToolArgs()` 直接读取 `tools` 数组中的 `inputSchema` 进行运行时校验，支持：
- 类型检查（string/number/boolean/object/array）
- `required` 字段
- `enum` 枚举值
- `minimum`/`maximum` 数值范围
- `maxLength` 字符串长度

新增工具时确保 `inputSchema` 包含正确约束，校验会自动生效。

### 测试在无 CAD 环境下部分失败

`tests/resource.test.js` 中的 4 个测试（约 27/31 通过）在无 CAD 连接环境下会失败，这是**预期行为**。这些测试验证 CAD 连接逻辑，在 CI 环境中不存在 CAD，因此会失败。本地开发时如果连接到 CAD，所有 31 个测试应全部通过。

