# @lisp MCP Server 托盘管理工具 - 构建脚本
#
# 依赖：Windows 自带的 .NET Framework 4.x csc.exe（无需安装 .NET SDK）
#
# 用法：
#   npm run build:tray
#   powershell -ExecutionPolicy Bypass -File tray\build.ps1
#   powershell -ExecutionPolicy Bypass -File tray\build.ps1 -Install
#
# 默认输出 dist\AtlispTray.exe（会随 npm 包发布）。
# -Install 会把生成的 exe 复制到 %LOCALAPPDATA%\Programs\atlisp-mcp，
# 并在开始菜单创建快捷方式（不会自动写入开机启动项，可在托盘菜单里开启）。
#
# 代码签名（降低杀软误报、消掉 SmartScreen「未知发布者」）：
#   powershell -File tray\build.ps1 -SignThumbprint <证书指纹>
#   或设环境变量 ATLISP_TRAY_SIGN_THUMBPRINT 后直接 npm run build:tray
# 需要 Windows SDK 的 signtool.exe，以及带私钥的代码签名证书（OV/EV）。

param(
    [string]$Output = '',
    [switch]$Install,
    [switch]$NoOptimize,
    [string]$SignThumbprint = $env:ATLISP_TRAY_SIGN_THUMBPRINT,
    [string]$TimestampUrl = $(if ($env:ATLISP_TRAY_TIMESTAMP_URL) { $env:ATLISP_TRAY_TIMESTAMP_URL } else { 'http://timestamp.digicert.com' })
)

$ErrorActionPreference = 'Stop'

if (-not $Output) {
    $Output = Join-Path $PSScriptRoot '..\dist\AtlispTray.exe'
}

$source = Join-Path $PSScriptRoot 'AtlispTray.cs'
if (-not (Test-Path $source)) {
    throw "找不到源文件：$source"
}

$cscCandidates = @(
    "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$csc = $null
foreach ($candidate in $cscCandidates) {
    if (Test-Path $candidate) {
        $csc = $candidate
        break
    }
}
if (-not $csc) {
    throw "找不到 csc.exe，请确认系统已安装 .NET Framework 4.x。"
}

$outputDir = Split-Path -Parent $Output
if ($outputDir -and -not (Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

$icon = Join-Path $PSScriptRoot 'atlisp.ico'
$manifestPath = Join-Path $PSScriptRoot 'AtlispTray.manifest'
$codeSignSource = Join-Path $PSScriptRoot 'CodeSign.cs'

# 托盘的真实版本号（只写进同目录的 AtlispTray.version，**不烧进 exe**）。
# 把版本号编译进 exe 会让每次发版都产出新 hash，Defender/SmartScreen 对每个
# 新 hash 都从 0 开始攒信誉；固定版本资源 + 运行时读版本号可以让 exe 的 hash
# 跨版本保持不变。atlisp-tray 安装/更新时会写这个文件。
$packageJson = Get-Content (Join-Path $PSScriptRoot '..\package.json') -Raw -Encoding UTF8
$versionMatch = [regex]::Match($packageJson, '"version"\s*:\s*"([^"]+)"')
$trayVersion = if ($versionMatch.Success) { $versionMatch.Groups[1].Value } else { '0.0.0' }

$buildInfoDir = Join-Path $PSScriptRoot '.cache'
if (-not (Test-Path $buildInfoDir)) {
    New-Item -ItemType Directory -Path $buildInfoDir -Force | Out-Null
}

function Write-Stamp([string]$path, [string]$title, [string]$description) {
    $content = @"
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.0.0.0")]
[assembly: System.Reflection.AssemblyTitle("$title")]
[assembly: System.Reflection.AssemblyDescription("$description")]
[assembly: System.Reflection.AssemblyCompany("atlisp.cn")]
[assembly: System.Reflection.AssemblyProduct("@lisp MCP Server")]
[assembly: System.Reflection.AssemblyCopyright("Copyright (c) 2026 atlisp.cn")]
[assembly: System.Reflection.AssemblyTrademark("atlisp")]
"@
    [System.IO.File]::WriteAllText($path, $content, (New-Object System.Text.UTF8Encoding($false)))
}

$trayStamp = Join-Path $buildInfoDir 'TrayStamp.g.cs'
Write-Stamp $trayStamp 'AtlispTray' '@lisp MCP Server 托盘管理'

function Invoke-Compile([string[]]$sources, [string]$target, [switch]$WithManifest) {
    $compileArgs = @(
        '/nologo',
        '/target:winexe',
        '/platform:anycpu',
        '/codepage:65001',
        ('/out:"' + $target + '"'),
        '/r:System.dll',
        '/r:System.Core.dll',
        '/r:System.Drawing.dll',
        '/r:System.Windows.Forms.dll',
        '/r:System.Web.Extensions.dll',
        '/r:System.Xml.dll',
        '/r:System.IO.Compression.dll',
        '/r:System.Management.dll'
    )
    if (-not $NoOptimize) { $compileArgs += '/optimize+' }
    if (Test-Path $icon) { $compileArgs += ('/win32icon:"' + $icon + '"') }
    if ($WithManifest -and (Test-Path $manifestPath)) {
        $compileArgs += ('/win32manifest:"' + $manifestPath + '"')
    }
    foreach ($item in $sources) { $compileArgs += ('"' + $item + '"') }
    & $csc @compileArgs
    if ($LASTEXITCODE -ne 0) {
        throw "编译失败：$target（csc 退出码 $LASTEXITCODE）"
    }
    if (-not (Test-Path $target)) {
        throw "编译结束但未找到输出文件：$target"
    }
}

Write-Host "编译 $source ..." -ForegroundColor Cyan
Invoke-Compile -sources @($codeSignSource, $trayStamp, $source) -target $Output -WithManifest

Write-Host "构建完成：$Output" -ForegroundColor Green

# Authenticode 签名：未签名的 exe 在 Defender/SmartScreen 眼里永远是「未知发布者」，
# 每个新构建的 hash 都没有信誉，这是托盘被杀软误报的根因之一。
if ($SignThumbprint) {
    $signtool = $null
    $kitsRoot = @(
        "${env:ProgramFiles(x86)}\Windows Kits\10\bin",
        "$env:ProgramFiles\Windows Kits\10\bin"
    )
    foreach ($root in $kitsRoot) {
        if (-not (Test-Path $root)) { continue }
        $found = Get-ChildItem -Path $root -Filter signtool.exe -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
            Sort-Object FullName -Descending |
            Select-Object -First 1
        if ($found) {
            $signtool = $found.FullName
            break
        }
    }
    if (-not $signtool) {
        $cmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
        if ($cmd) { $signtool = $cmd.Source }
    }
    if (-not $signtool) {
        throw "找不到 signtool.exe（需要 Windows 10/11 SDK）。可先不签名：去掉 -SignThumbprint。"
    }
    foreach ($artifact in @($Output)) {
        Write-Host "签名 $artifact ..." -ForegroundColor Cyan
        & $signtool sign /sha1 $SignThumbprint /fd SHA256 /tr $TimestampUrl /td SHA256 $artifact
        if ($LASTEXITCODE -ne 0) {
            throw "签名失败：$artifact（signtool 退出码 $LASTEXITCODE）。请确认证书已插入/解锁且指纹正确。"
        }
        Write-Host "已签名：$artifact" -ForegroundColor Green
    }
}

if ($Install) {
    $installDir = Join-Path $env:LOCALAPPDATA 'Programs\atlisp-mcp'
    if (-not (Test-Path $installDir)) {
        New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    }
    $target = Join-Path $installDir 'AtlispTray.exe'
    Copy-Item $Output $target -Force
    # 托盘真实版本号（exe 的版本资源固定为 1.0.0.0，见上面的 Write-Stamp 说明）
    [System.IO.File]::WriteAllText(
        (Join-Path $installDir 'AtlispTray.version'),
        $trayVersion,
        (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "已安装到：$target（v$trayVersion）" -ForegroundColor Green

    $startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
    if (Test-Path $startMenu) {
        $shortcutPath = Join-Path $startMenu '@lisp MCP 托盘.lnk'
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $target
        $shortcut.WorkingDirectory = $installDir
        $shortcut.Description = '@lisp MCP Server 托盘管理'
        $shortcut.Save()
        Write-Host "已创建开始菜单快捷方式：$shortcutPath" -ForegroundColor Green
    }

    Write-Host ''
    Write-Host '现在可以运行托盘程序：' -ForegroundColor Cyan
    Write-Host "  $target"
    Write-Host '在托盘右键菜单中可开启“随 Windows 启动托盘”。'
}
