# @lisp MCP 提示模板

## 外部提示模板

在此目录放置 `.json` 文件可注册自定义 MCP 提示模板，覆盖同名的内置提示。

### 简单消息格式

```json
{
  "name": "my-custom-prompt",
  "description": "我的自定义提示",
  "arguments": [
    { "name": "param1", "description": "参数1说明", "required": true },
    { "name": "param2", "description": "参数2说明", "required": false }
  ],
  "messages": [
    {
      "role": "user",
      "content": {
        "type": "text",
        "text": "这是提示内容，可使用 {param1} 和 {param2} 作为参数占位符"
      }
    }
  ]
}
```

### 多模板格式（推荐）

```json
{
  "name": "my-prompt",
  "description": "带多个动作的提示",
  "arguments": [
    { "name": "action", "description": "操作类型: default/other", "required": false, "default": "default" }
  ],
  "templates": {
    "default": {
      "code": "(command \"_line\" {arg1} {arg2} \"\")",
      "description": "{arg1} 到 {arg2} 的直线"
    },
    "other": {
      "code": "(command \"_circle\" {arg1} {radius})",
      "description": "以 {arg1} 为圆心画圆，半径 {radius}"
    }
  }
}
```

- `templates` - 动作模板对象（键为动作名，`default` 为默认动作）
  - `code` - AutoLISP 代码模板（可选），使用 `{argName}` 引用参数
  - `description` - 提示描述（可选），同样支持参数替换
- 模板自动组合为完整提示内容，包含代码块和参数说明

## 内置提示定义

内置提示位于 `src/prompts/definitions/`，JSON 格式同上。

### 处理器提示（handlerFile）

复杂提示使用独立的 JavaScript 处理器文件：

```json
{
  "name": "analyze-drawing",
  "description": "分析当前图纸统计信息",
  "arguments": [],
  "handlerFile": "analyze-drawing"
}
```

处理器位于 `src/prompts/handlers/`，导出默认的 `async function(args)`，返回 `{ messages: [...] }`。

字段：
- `name` - 提示名称（必填）
- `description` - 简短描述
- `arguments` - 参数定义数组（可选），每项含 `name`, `description`, `required`, `default`
- `templates` - 模板对象（可选），替代 `messages` 字段
- `handlerFile` - 处理器文件名（可选），用于需要动态逻辑的提示
- `messages` - 静态消息数组（可选）

优先级：`handlerFile` > `templates` > `messages`
