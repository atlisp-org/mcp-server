---
name: cad-mcp-write
description: 通过 atlisp-mcp 向 AutoCAD 写入文字、绘制图形。当用户要求向 CAD 写入文字、标注、在 AutoCAD 中添加文本内容时触发。支持中文及任意 UTF-8 字符。
agent_created: true
---

# cad-mcp-write

通过 atlisp-mcp (localhost:8110) 向 AutoCAD 执行 AutoLISP 代码，实现非交互式绘图和文字写入。

## 前置条件

- Windows + PowerShell
- AutoCAD 已启动
- [atlisp-mcp](https://github.com/atlisp/atlisp-mcp) 运行在 `http://localhost:8110/mcp`
- MCP 配置文件 `~/.workbuddy/.mcp.json` 中已注册 `local-mcp` 指向 `http://localhost:8110/mcp`

## 安装

将本 skill 目录复制到 WorkBuddy 用户技能目录：

```powershell
# 目标路径（创建如不存在）
$skillDir = "$env:USERPROFILE\.workbuddy\skills\cad-mcp-write"
New-Item -ItemType Directory -Path $skillDir -Force

# 将整个 cad-mcp-write 文件夹内容复制进去
Copy-Item -Path ".\cad-mcp-write\*" -Destination $skillDir -Recurse
```

## 核心脚本

### 写入文字：`scripts/cad-write_text.ps1`

通过 `entmake` 创建 TEXT 实体，支持中文及任意 UTF-8 字符。**无任何路径依赖，可直接运行。**

**调用方式：**

```powershell
# 方式1：直接执行（推荐）
.\cad-write_text.ps1 -Text "测试中文"

# 方式2：指定完整路径执行
& "C:\path\to\cad-write_text.ps1" -Text "标题" -X 100 -Y 200 -Height 10
```

**参数：**

| 参数 | 必填 | 默认值 | 说明 |
|------|:----:|--------|------|
| `-Text` | ✅ | — | 文字内容（UTF-8，支持中文/日文/emoji） |
| `-X` | | `0` | 插入点 X 坐标 |
| `-Y` | | `0` | 插入点 Y 坐标 |
| `-Z` | | `0` | 插入点 Z 坐标 |
| `-Height` | | `5.0` | 文字高度 |
| `-Rotation` | | `0` | 旋转角度（度） |
| `-McpUrl` | | `http://localhost:8110/mcp` | MCP 服务器地址 |

**返回值：**
- 成功：MCP JSON-RPC 响应字符串（包含 `result.content`）
- 失败：输出 `[FAIL]` 并返回 `$null`

## 直接调用 MCP（用于非文字操作）

当需要执行除写入文字以外的 LISP 操作（画线、画圆等），使用以下模板构建 HTTP 请求。

### 通用 MCP 调用函数

在 PowerShell 中定义此复用函数后，可直接传入 LISP 代码执行：

```powershell
function Invoke-CadLisp {
    param(
        [Parameter(Mandatory=$true)][string]$Code,
        [string]$McpUrl = 'http://localhost:8110/mcp'
    )
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"eval_lisp","arguments":{"code":"')
    [void]$sb.Append($Code)
    [void]$sb.Append('"}}}')
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($sb.ToString())
    $wc = New-Object System.Net.WebClient
    $wc.Headers.Add('Content-Type', 'application/json; charset=utf-8')
    try {
        $resp = $wc.UploadData($McpUrl, 'POST', $bytes)
        return [System.Text.Encoding]::UTF8.GetString($resp)
    } catch {
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

# 使用示例
Invoke-CadLisp '(entmake (list (cons 0 "LINE") (cons 10 (list 0 0 0)) (cons 11 (list 100 100 0))))'
```

### 关键编码规则（必须遵守）

1. **必须使用 StringBuilder** 拼接 JSON — 不能直接在 PowerShell 字符串中混用中文和 JSON 转义字符
2. **LISP 字符串内的双引号** 用 `\u0022` 转义（不要用 `\"`）
3. **用户输入的文字内容** 通过 `$sb.Append($Text)` 原生追加到 StringBuilder
4. **JSON 闭合结构必须严格匹配**：LISP `)))` + JSON code值关闭 `"` + `"}`
5. **数值参数** 先 `.ToString("0.######")` 格式化再 Append

### 可用的 MCP 工具

| 工具名 | 用途 | 说明 |
|--------|------|------|
| `eval_lisp` | 执行 LISP 代码 | 无返回值，适用于写操作 |
| `eval_lisp_with_result` | 执行并返回结果 | 需要获取 LISP 返回值时使用 |
| `connect_cad` | 连接 AutoCAD 实例 | 首次使用前可能需要先连接 |
| `get_cad_info` | 获取 CAD 信息 | 版本、文档名等 |
| `at_command` | 执行 AutoCAD 命令 | 如 _.CIRCLE、_.TEXT 等交互命令 |
| `new_document` | 新建 DWG 文档 | 创建空白图纸 |

### 常用 LISP 代码片段

**画直线：**
```lisp
(entmake (list (cons 0 "LINE") (cons 10 (list x1 y1 z1)) (cons 11 (list x2 y2 z2))))
```

**画圆：**
```lisp
(entmake (list (cons 0 "CIRCLE") (cons 10 (list cx cy cz)) (cons 40 radius)))
```

**画圆弧（圆心+起点+角度）：**
```lisp
(entmake (list (cons 0 "ARC") (cons 10 (list cx cy cz)) (cons 50 startAngle) (cons 51 endAngle)))
```

**写多行文字 MTEXT：**
```lisp
(entmake (list (cons 0 "MTEXT") (cons 10 (list x y z)) (cons 1 "第一行\n第二行") (cons 40 height)))
```

## 工作流程（AI 使用指引）

1. 用户提出需求（如"在 CAD 里写上 图纸编号：A-001"）
2. 从用户指令中提取参数：文字内容、位置、高度等（有缺省值的不用问，关键缺失的问用户）
3. 定位脚本路径：Skill 安装目录下的 `scripts/cad-write_text.ps1`
4. dot-source 调用或直接执行脚本
5. 报告执行结果（成功/失败）

## 故障排查

| 症状 | 原因 | 解决方法 |
|------|------|---------|
| 显示问号/方块 | 字体不支持中文 | 在 AutoCAD 中切换为 `hztxt.shx` / `simsun.ttc` / `msyh.ttc` 等中文字体 |
| MCP 返回 400 | JSON 格式错误 | 检查括号数量匹配、`\u0022` 转义正确 |
| 连接被拒绝 | atlisp-mcp 未运行 | 启动 atlisp-mcp 服务，确认端口 8110 可访问 |
| 中文变成乱码 | 编码错误 | 确认使用 StringBuilder + UTF-8.GetBytes()，不要直接拼字符串 |
| 执行策略限制 | PowerShell 默认禁止脚本 | 先执行 `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` |
