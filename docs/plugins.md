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
   * 插件初始化函数，在服务器启动时调用一次。
   * @param {object} context - 上下文对象
   * @param {object} context.cad - CAD 连接对象（CadConnection 实例）
   * @param {object} context.config - 当前配置对象
   * @param {function} context.log - 日志函数（等同于 logger.log）
   * @param {function} context.registerTool - 动态注册新工具的函数
   * @param {Array} context.tools - 当前所有工具定义数组
   */
  setup() {
    this.log('Example plugin loaded');
  },

  /**
   * 服务器完全就绪后调用（MCP 连接建立后）。
   * @param {object} context - 与 setup 相同的上下文对象
   */
  onInit(context) {
    this.log('Server ready, CAD connected:', context.cad.connected);
  },
};
```

> `setup()` 在插件首次加载时调用；`onInit()` 在 MCP 服务器完全就绪后调用。

## 可用钩子

以下钩子方法可选实现，服务器会在对应事件发生时通过 `callPluginHook` 调用：

| 钩子名 | 调用时机 | 参数 |
|--------|---------|------|
| `onInit` | MCP 服务器就绪 | `{ cad, config, log, registerTool, tools }` |
| `onToolExecuted` | 工具调用完成后 | `{ name, args, result, duration, success }` |
| `onCadConnected` | CAD 连接成功 | `{ platform, version }` |
| `onCadDisconnected` | CAD 断开连接 | `{ reason }` |
| `onDocumentChanged` | CAD 文档变更 | `{ name, action }` |
| `onError` | 错误发生 | `{ message, source, code }` |

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
// 注册一个自定义工具
context.registerTool({
  name: 'my_custom_tool',
  description: '自定义工具描述',
  inputSchema: {
    type: 'object',
    properties: {
      input: { type: 'string', description: '输入参数' },
    },
    required: ['input'],
  },
  // handler 函数（可选，定义后该工具会出现在 tools/list 中）
  handler: async (args, { notifyProgress }) => {
    const result = await context.cad.sendCommandWithResult(`(princ "${args.input}")`);
    return { content: [{ type: 'text', text: result }] };
  },
});
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
- **新增** `.js` 文件：自动加载并调用 `setup()`
- **修改** 已加载的插件文件：重新加载（先卸载旧实例，再加载新实例）
- **删除** 插件文件：自动从已加载列表移除

热重载由 `startPluginWatcher()` 在服务器启动时自动启用。

## 插件示例：审计日志

```js
// ~/.atlisp/mcp-plugins/audit-log.js
export default {
  name: 'audit-log',

  setup() {
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
      const fs = require('fs');
      const path = require('path');
      const logPath = path.join(
        require('os').homedir(),
        '.atlisp',
        'tool-audit.json'
      );
      fs.appendFileSync(logPath, this._calls.map(c => JSON.stringify(c)).join('\n') + '\n');
      this._calls = [];
    }
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
3. **生命周期**：`setup()` 只调用一次（首次加载或热重载时），`onInit()` 在每次 MCP 就绪后调用。
4. **CommonJS 兼容**：插件以 ES Module 动态 `import()` 加载。如果需要使用 CommonJS 模块，请通过 `createRequire` 转换。
