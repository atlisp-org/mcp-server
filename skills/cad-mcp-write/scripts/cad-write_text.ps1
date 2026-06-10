<#
.SYNOPSIS
    通过 atlisp-mcp 向 AutoCAD 写入文字（支持中文/任意 UTF-8 文字）
.DESCRIPTION
    调用本地 MCP 服务器 (localhost:8110) 的 eval_lisp 工具，
    使用 AutoLISP entmake 在指定位置创建 TEXT 实体。
.PARAMETER Text
    要写入的文字内容（支持中文、日文、emoji 等所有 UTF-8 字符）
.PARAMETER X, Y, Z
    插入点坐标，默认原点 (0,0,0)
.PARAMETER Height
    文字高度，默认 5.0
.PARAMETER Rotation
    旋转角度（度），默认 0（不生成旋转属性）
.PARAMETER McpUrl
    MCP 服务器地址，默认 http://localhost:8110/mcp
.EXAMPLE
    .\cad-write_text.ps1 -Text "测试中文"
.EXAMPLE
    .\cad-write_text.ps1 -Text "标题" -X 100 -Y 200 -Height 10
.NOTES
    前置要求：
    1. AutoCAD 已启动
    2. atlisp-mcp 已运行在 localhost:8110
#>
param(
    [Parameter(Mandatory=$true)][string]$Text,
    [double]$X = 0.0,
    [double]$Y = 0.0,
    [double]$Z = 0.0,
    [double]$Height = 5.0,
    [double]$Rotation = 0.0,
    [string]$McpUrl = 'http://localhost:8110/mcp'
)

$sb = New-Object System.Text.StringBuilder

# --- 段1: JSON 外壳 ---
[void]$sb.Append('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"eval_lisp","arguments":{"code":"')

# --- 段2: LISP entmake 代码前半（TEXT 实体定义）---
# (entmake (list (cons 0 "TEXT") (cons 10 (list x y z)) (cons 40 h) (cons 1 "))
[void]$sb.Append("(entmake (list (cons 0 \u0022TEXT\u0022) (cons 10 (list ")
[void]$sb.Append($X.ToString("0.######"))
[void]$sb.Append(' ')
[void]$sb.Append($Y.ToString("0.######"))
[void]$sb.Append(' ')
[void]$sb.Append($Z.ToString("0.######"))
[void]$sb.Append(")) (cons 40 ")
[void]$sb.Append($Height.ToString("0.######"))
if ($Rotation -ne 0) {
    [void]$sb.Append(") (cons 50 ")
    [void]$sb.Append($Rotation.ToString("0.######"))
}

# --- 段3: 用户文字内容（UTF-8 原生追加）---
[void]$sb.Append(') (cons 1 \u0022')
[void]$sb.Append($Text)

# --- 段4: LISP 收尾 + JSON 闭合 ---
[void]$sb.Append('\u0022)))"}}}')

$json = $sb.ToString()
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)

$wc = New-Object System.Net.WebClient
$wc.Headers.Add('Content-Type', 'application/json; charset=utf-8')

try {
    $resp = $wc.UploadData($McpUrl, 'POST', $bytes)
    $result = [System.Text.Encoding]::UTF8.GetString($resp)
    Write-Host "[OK] Text=`"$Text`" at ($X,$Y,$Z) h=$Height$(if($Rotation){", rot=$Rotation"})"
    return $result
} catch {
    $msg = $_.Exception.Message
    if ($_.Exception.Response) {
        $stream = $_.Exception.Response.GetResponseStream()
        if ($stream) {
            $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
            $msg += "`nDetail: $($reader.ReadToEnd())"
        }
    }
    Write-Host "[FAIL] Error: $msg" -ForegroundColor Red
    return $null
}
