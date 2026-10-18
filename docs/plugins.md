# @lisp MCP Server 插件 API

插件用于在不修改 MCP Server 核心代码的情况下扩展功能。插件以 ES Module 形式加载，支持热重载。

## 插件目录

```
~/.atlisp/mcp-plugins/
├── my-plugin.js
├── another-plugin.js
└── _disabled-plugin.js    # 以下划线开头的文件会被跳过
```

## 插件格式

每个 `.js` 文件必须导出一个 `default` 对象，其中包含 `setup()` 函数：

```js
// ~/.atlisp/mcp-plugins/example-plugin.js
export default {
  name: 'example-plugin',

  /**
   * 可选：插件首次加载时不会由核心自动调用（loader 只校验它是函数）。
   * 初始化逻辑请放在 onInit 里，或在 onInit 中转发调用 setup。
   */
  setup() {},

  /**
   * 服务器就绪后调用（启动时一次；热加载/热重载后也会调用）。
   * @param {object} context - 上下文对象
   * @param {object} context.cad - CAD 连接对象（CadConnection 实例）
   * @param {object} context.config - 当前配置对象
   * @param {function} context.log - 日志函数（等同于 logger.log）
   * @param {function} context.registerTool - 动态注册新工具的函数
   * @param {Array} context.tools - 当前所有工具定义数组
   */
  onInit(context) {
    context.log('Server ready, CAD connected:', context.cad.connected);
  },

  /** 可选：插件被热重载替换或删除前调用，用于清理定时器/文件句柄 */
  onUnload() {},
};
```

> `onInit()` 由 `initPlugins(context)` 在服务器就绪后调用；插件热加载/热重载后，loader 会用最近一次 `initPlugins` 的上下文再调用一次 `onInit()`，因此注册工具的逻辑应写成幂等的（先检查 `context.tools` 是否已有同名工具）。

## 可用钩子

以下钩子方法可选实现，服务器会在对应事件发生时通过 `callPluginHook` 调用：

| 钩子名 | 调用时机 | 参数 |
|--------|---------|------|
| `onInit` | MCP 服务器就绪（及热加载/热重载后） | `{ cad, config, log, registerTool, tools }` |
| `onUnload` | 热重载替换或删除插件前 | 无 |
| `onToolExecuted` | 工具调用完成后 | `{ name, args, result, duration, success }` |
| `onCadConnected` | CAD 连接成功 | `{ platform, version }` |
| `onCadDisconnected` | CAD 断开连接 | `{ reason }` |
| `onDocumentChanged` | CAD 文档变更 | `{ name, action }` |
| `onError` | 错误发生 | `{ message, source, code }` |

> 除 `onInit` / `onUnload` 外，其余钩子由 `callPluginHook(hook, ...args)` 分发；核心当前未在内部事件上自动调用它们，可由其他插件或扩展代码触发。`setup()` 不会被自动调用，仅作为 loader 的加载校验条件（必须是函数）。

## 上下文对象说明

### cad（CAD 连接对象）

```js
context.cad.connected          // boolean - 是否已连接
context.cad.getPlatform()      // string  - 当前平台名（如 "AutoCAD"）
context.cad.getVersion()       // string  - 版本号
context.cad.sendCommand(code)              // 发送 LISP 代码（无返回值）
context.cad.sendCommandWithResult(code)    // 发送 LISP 代码并返回结果
context.cad.isStalled()        // boolean - 是否处于停滞状态
context.cad.getStallInfo()     // { stalled, reason, remainingMs }
```

### registerTool（动态注册工具）

```js
// 注册一个自定义工具：registerTool(toolDef, handler)
context.registerTool(
  {
    name: 'my_custom_tool',
    description: '自定义工具描述',
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string', description: '输入参数' },
      },
      required: ['input'],
    },
  },
  async (args, { notifyProgress } = {}) => {
    const result = await context.cad.sendCommandWithResult(`(princ "${args.input}")`);
    return { content: [{ type: 'text', text: result }] };
  },
);
```

### config（配置对象）

```js
context.config.port                    // number - 监听端口
context.config.transport               // 'http' | 'stdio' | 'ws'
context.config.locale                  // 'zh-CN' | 'en'
context.config.toolCategories          // string[] - 工具分类过滤
context.config.securityLevel           // 'strict' | 'standard' | 'relaxed'
context.config.tracingEnabled          // boolean
```

## 热重载

插件目录通过 `fs.watch` 监听文件变化：
- **新增** `.js` 文件：自动加载，并用最近一次 `initPlugins` 的上下文调用 `onInit()`
- **修改** 已加载的插件文件（`change` 或 `rename` 事件，覆盖大多数编辑器的保存方式）：先调用旧实例的 `onUnload()`，再加载新实例并调用 `onInit()`
- **删除** 插件文件：调用 `onUnload()` 后从已加载列表移除

热重载由 `startPluginWatcher()` 在服务器启动时自动启用。

> 已通过 `registerTool` 注册的工具在热重载后仍指向旧 handler（工具名不能重复注册）。修改插件注册的工具定义时需要重启 MCP Server。

## 官方示例

`examples/plugins/` 下有三个可直接拷入插件目录的示例：

| 文件 | 演示内容 |
|------|---------|
| `example-custom-tool.js` | 通过 `registerTool` 注册只读工具 `echo_debug` |
| `example-audit-hook.js` | `onToolCall` / `onToolExecuted` 生命周期观察与审计 |
| `example-event-logger.js` | CAD 连接/断开、图纸变更、错误事件记录 |

```bash
cp examples/plugins/*.js ~/.atlisp/mcp-plugins/
```

## 插件示例：审计日志

```js
// ~/.atlisp/mcp-plugins/audit-log.js
import fs from 'fs';
import path from 'path';
import os from 'os';

export default {
  name: 'audit-log',

  onInit() {
    this._calls = [];
  },

  onToolExecuted({ name, args, result, duration, success }) {
    this._calls.push({
      tool: name,
      args: JSON.stringify(args),
      success,
      duration,
      timestamp: new Date().toISOString(),
    });

    // 每 10 次调用写入文件
    if (this._calls.length >= 10) {
      const logPath = path.join(os.homedir(), '.atlisp', 'tool-audit.json');
      fs.appendFileSync(logPath, this._calls.map(c => JSON.stringify(c)).join('\n') + '\n');
      this._calls = [];
    }
  },

  onUnload() {
    this._calls = [];
  },
};
```

## 插件示例：定时任务

```js
// ~/.atlisp/mcp-plugins/scheduled-task.js
export default {
  name: 'scheduled-task',

  onInit({ cad, log }) {
    // 每 5 分钟检查一次 CAD 连接状态
    setInterval(() => {
      if (cad.connected) {
        log('[scheduled-task] CAD 连接正常');
      } else {
        log('[scheduled-task] CAD 未连接，尝试重连...');
        cad.connect().catch(() => {});
      }
    }, 5 * 60 * 1000);
  },
};
```

## 注意事项

1. **安全**：插件可访问 `cad` 对象，可发送任意 LISP 代码到 CAD。确保插件来源可信。
2. **错误隔离**：单个插件的错误不会影响其他插件或 MCP 服务器主进程。
3. **生命周期**：`onInit()` 在启动时调用一次；热加载/热重载后针对新实例再次调用。`onUnload()` 在替换/删除前调用，请在此清理定时器与句柄。`setup()` 不会被核心自动调用。
4. **ESM**：插件以 ES Module 动态 `import()` 加载，不能使用 `require`。需要 CommonJS 能力时用 `import { createRequire } from 'module'` 转换。
5. **热重载与定时器**：`onUnload()` 中务必清理 `setInterval`/`setTimeout`，否则旧实例会在后台持续运行。
