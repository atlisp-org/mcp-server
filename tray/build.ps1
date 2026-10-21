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

param(
    [string]$Output = '',
    [switch]$Install,
    [switch]$NoOptimize
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

$compilerArgs = @(
    '/nologo',
    '/target:winexe',
    '/platform:anycpu',
    '/codepage:65001',
    ('/out:"' + $Output + '"'),
    '/r:System.dll',
    '/r:System.Core.dll',
    '/r:System.Drawing.dll',
    '/r:System.Windows.Forms.dll',
    '/r:System.Web.Extensions.dll',
    '/r:System.Xml.dll',
    '/r:System.IO.Compression.dll'
)
if (-not $NoOptimize) {
    $compilerArgs += '/optimize+'
}

$icon = Join-Path $PSScriptRoot 'atlisp.ico'
if (Test-Path $icon) {
    $compilerArgs += ('/win32icon:"' + $icon + '"')
}

$manifest = Join-Path $PSScriptRoot 'AtlispTray.manifest'
if (Test-Path $manifest) {
    $compilerArgs += ('/win32manifest:"' + $manifest + '"')
}

# 把 package.json 的版本写进 exe（程序集版本 + BuildInfo.TrayVersion）：
# 托盘“关于/诊断”显示真实版本，升级 @lisp/mcp 后也能据此判断托盘是否需要更新。
$packageJson = Get-Content (Join-Path $PSScriptRoot '..\package.json') -Raw -Encoding UTF8
$versionMatch = [regex]::Match($packageJson, '"version"\s*:\s*"([^"]+)"')
$trayVersion = if ($versionMatch.Success) { $versionMatch.Groups[1].Value } else { '0.0.0' }
$versionParts = @(($trayVersion -split '-')[0].Split('.'))
while ($versionParts.Count -lt 4) { $versionParts += '0' }
$fileVersion = ($versionParts[0..3] -join '.')
$buildInfo = @"
[assembly: System.Reflection.AssemblyVersion("$fileVersion")]
[assembly: System.Reflection.AssemblyFileVersion("$fileVersion")]
[assembly: System.Reflection.AssemblyInformationalVersion("$trayVersion")]

namespace Atlisp.Tray
{
    internal static class BuildInfo
    {
        internal const string TrayVersion = "$trayVersion";
    }
}
"@
$buildInfoDir = Join-Path $PSScriptRoot '.cache'
if (-not (Test-Path $buildInfoDir)) {
    New-Item -ItemType Directory -Path $buildInfoDir -Force | Out-Null
}
$buildInfoPath = Join-Path $buildInfoDir 'TrayBuildInfo.g.cs'
[System.IO.File]::WriteAllText($buildInfoPath, $buildInfo, (New-Object System.Text.UTF8Encoding($false)))
$compilerArgs += '/define:TRAY_VERSION_STAMPED'
$compilerArgs += ('"' + $buildInfoPath + '"')

$compilerArgs += ('"' + $source + '"')

Write-Host "编译 $source ..." -ForegroundColor Cyan
& $csc @compilerArgs
if ($LASTEXITCODE -ne 0) {
    throw "编译失败（csc 退出码 $LASTEXITCODE）。"
}

if (-not (Test-Path $Output)) {
    throw "编译结束但未找到输出文件：$Output"
}
Write-Host "构建完成：$Output" -ForegroundColor Green

if ($Install) {
    $installDir = Join-Path $env:LOCALAPPDATA 'Programs\atlisp-mcp'
    if (-not (Test-Path $installDir)) {
        New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    }
    $target = Join-Path $installDir 'AtlispTray.exe'
    Copy-Item $Output $target -Force
    Write-Host "已安装到：$target" -ForegroundColor Green

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
