# @lisp MCP Server — AI Agent 开发指南

## 项目概述

@lisp MCP Server 是 AI Agent 与 CAD 之间的桥接层——通过 MCP 协议提供 150+ 工具供 Agent 调用，底层通过 `edge-js` → .NET COM 互操作控制 AutoCAD/ZWCAD/GStarCAD/BricsCAD。

## 常用命令

```bash
cd tools/mcp-server

npm install          # 安装依赖
npm run build        # 构建 (esbuild 打包 + 复制 worker)
npm test             # 运行测试 (vitest)
npm run test:watch   # 监视模式测试
npm start            # 启动服务器
```

## 架构要点

```
AI Agent → (MCP协议) → mcp-server (Node.js) → edge-js → .NET COM → CAD
```

- **CAD 通信**：`cad.js` 通过子进程 `cad-worker.js` 与 CAD 通信。worker 使用 `edge-js` 调用 .NET COM，通过 stdin/stdout JSON 行协议通信。
- **工具定义**：`src/tools/*.js`（31个文件）定义工具 Schema，`src/mcp-tools.js` 的 `TOOL_HANDLERS` 映射工具名到处理函数。
- **处理器**：`src/handlers/*.js`（21+个文件）实现具体的 LISP 代码生成和 CAD 调用。
- **安全**：`lisp-security.js` 是共享安全模块，21 条规则覆盖 eval/load/startapp/文件I/O/危险命令。同时被 `cad-worker.js`（执行层）和 `lisp-sandbox.js`（校验层）使用。

## 添加新工具

1. 在 `src/tools/` 下创建 `<name>-tools.js`，导出 `tools` 数组，每项含 `name`/`description`/`inputSchema`
2. 在 `src/tools/index.js` 中 import 并合并
3. 在 `src/handlers/` 下创建对应 handler，导出异步函数
4. 在 `src/handler-loader.js` 注册 `toolModuleMap` 和 `toolFunctionMap` 映射
5. 在 `src/mcp-tools.js` 的 `TOOL_HANDLERS` 中添加 lazy handler

## 关键约定

- **模块系统**：ES Module（`"type": "module"`）
- **编码**：源文件 UTF-8，CAD 通信使用系统 ANSI 编码（GBK 兼容）
- **错误处理**：使用 `errors.js` 的 `createError()`，禁止空 catch 块
- **配置**：env var → config file → CLI args 三层优先级，通过 `config.js` 访问
- **路径安全**：接受文件路径的工具必须调用 `validateFilePath()` 检查 `..` 穿越
- **流式限制**：`streaming.js` 有 50000 实体上限，超限返回错误而非 OOM
- **Webhook**：失败自动指数退避重试 3 次（1s/2s/4s）
- **队列清理**：`resetWorker()` 会同时清空 `CommandQueue`，确保残留命令不被消费

## 测试

```bash
npm test              # 运行全部 vitest 测试
npm run test:watch    # 监视模式
```

测试文件位于 `tests/`，mock CAD 连接（不依赖真实 CAD）。部分资源测试需要 CAD 连接，在 CI 环境会失败（预期行为）。

## 文件结构速查

| 文件 | 职责 |
|------|------|
| `src/atlisp-mcp.js` | 入口：CLI 解析、启动服务器、初始化 CAD 连接 |
| `src/mcp-tools.js` | 工具调度：`TOOL_HANDLERS` 映射、参数校验、资源变更通知 |
| `src/cad.js` | CAD 连接：熔断器、命令队列、读批处理、心跳 |
| `src/cad-worker.js` | Worker 进程：edge-js COM 调用、LISP 代码缓存、安全检查 |
| `src/lisp-security.js` | **共享安全模块**：规则定义、括号检查、字符串剥离 |
| `src/lisp-sandbox.js` | 沙箱校验：session allowlist、威胁分级 |
| `src/config.js` | 配置管理：三层合并、热重载、Zod 校验 |
| `src/handler-loader.js` | 懒加载：动态 import handler 模块 |
| `src/routes.js` | HTTP 路由：中间件链、MCP/SSE/调试面板 |
| `src/tools/index.js` | 工具 Schema 聚合（31个文件合并） |
| `src/html/*.html` | UI 模板：API 文档、调试面板、Playground |
