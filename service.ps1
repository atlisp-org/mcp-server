param(
    [Parameter(Position=0)]
    [ValidateSet('install','uninstall','start','stop','restart','status','logs')]
    [string]$Action = 'status',

    [Parameter()]
    [int]$Port = 8110,

    [Parameter()]
    [string]$ConfigFile = '',

    [Parameter()]
    [string]$LogDir = "$env:ProgramData\atlisp-mcp\logs",

    [Parameter()]
    [string]$ServiceName = 'atlisp-mcp',

    [Parameter()]
    [string]$User = '',

    [Parameter()]
    [string]$Password = ''
)

# Check admin - install/uninstall/start/stop/restart need admin
$adminActions = @('install','uninstall','start','stop','restart')
if ($adminActions -contains $Action) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Host "[ERR]  '$Action' requires Administrator privileges." -ForegroundColor Red
        Write-Host "       Please run PowerShell as Administrator, then:" -ForegroundColor Yellow
        Write-Host "       cd '$PSScriptRoot'" -ForegroundColor Cyan
        Write-Host "       .\service.ps1 $Action" -ForegroundColor Cyan
        exit 1
    }
}

$DisplayName = '@lisp MCP Server'
$Description = 'MCP Server for @lisp on CAD - Bridge between AI Agent and AutoCAD/ZWCAD/GStarCAD/BricsCAD'

function Write-Info  { Write-Host "[INFO] $args" -ForegroundColor Cyan }
function Write-Ok    { Write-Host "[OK]   $args" -ForegroundColor Green }
function Write-Warn  { Write-Host "[WARN] $args" -ForegroundColor Yellow }
function Write-Err   { Write-Host "[ERR]  $args" -ForegroundColor Red }

function Find-NodePath {
    $candidates = @(
        (Get-Command node -ErrorAction SilentlyContinue).Source
        "$env:ProgramFiles\nodejs\node.exe"
        "${env:ProgramFiles(x86)}\nodejs\node.exe"
        "$env:LOCALAPPDATA\fnm\nodejs\current\node.exe"
        "$env:USERPROFILE\scoop\apps\nodejs\current\node.exe"
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate)) {
            return $candidate
        }
    }
    return $null
}

function Find-GlobalAtlispMcp {
    $globalRoot = $null
    try { $globalRoot = npm root -g 2>$null } catch {}
    if (-not $globalRoot) { return $null }
    $pkgDir = Join-Path $globalRoot '@atlisp\mcp'
    if (-not (Test-Path $pkgDir)) { return $null }
    $scriptPath = Join-Path $pkgDir 'dist\atlisp-mcp.js'
    if (Test-Path $scriptPath) { return $scriptPath }
    return $null
}

function Get-LogPath {
    if (-not (Test-Path $LogDir)) {
        New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
    }
    return @{
        stdout = Join-Path $LogDir 'atlisp-mcp-stdout.log'
        stderr = Join-Path $LogDir 'atlisp-mcp-stderr.log'
    }
}

function Get-ScriptPath {
    $scriptDir = Split-Path $MyInvocation.MyCommand.Path

    # Running from npm global install — use sibling dist/atlisp-mcp.js
    $siblingDist = Join-Path $scriptDir 'dist\atlisp-mcp.js'
    if (Test-Path $siblingDist) {
        Write-Info "Using dist in script directory: $siblingDist"
        return $siblingDist
    }

    # Look up npm global root
    $globalPath = Find-GlobalAtlispMcp
    if ($globalPath) {
        Write-Info "Using npm global install: $globalPath"
        return $globalPath
    }

    Write-Warn "npm global @atlisp/mcp not found."
    $localDist = Join-Path $scriptDir 'dist\atlisp-mcp.js'
    $localSrc  = Join-Path $scriptDir 'src\atlisp-mcp.js'
    if (Test-Path $localDist) { return $localDist }
    if (Test-Path $localSrc) { return $localSrc }
    return $null
}

function Install-Service {
    $nodePath = Find-NodePath
    if (-not $nodePath) {
        Write-Err 'Node.js not found. Please install Node.js >= 18 first.'
        exit 1
    }
    Write-Info "Node.js: $nodePath"

    $scriptPath = Get-ScriptPath
    if (-not $scriptPath) {
        Write-Err "@atlisp/mcp not found. Run 'npm install -g @atlisp/mcp' first."
        exit 1
    }
    Write-Info "Script: $scriptPath"

    $logs = Get-LogPath
    Write-Info "Logs: $($logs.stdout)"

    $nodeVer = & $nodePath --version
    Write-Info "Node version: $nodeVer"

    $extraArgs = "--port $Port"
    if ($ConfigFile) { $extraArgs += " --config `"$ConfigFile`"" }

    $binPath = "`"$nodePath`" `"$scriptPath`" $extraArgs"

    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($service) {
        Write-Warn "Service '$ServiceName' already exists. Stopping and removing..."
        Stop-Service $ServiceName -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        & sc.exe delete $ServiceName 2>&1 | Out-Null
        Start-Sleep -Seconds 2
    }

    # Service account
    if (-not $User) {
        $User = "$env:USERDOMAIN\$env:USERNAME"
    }

    if ((-not $Password) -and ($User -ne 'LocalSystem')) {
        $sec = Read-Host -AsSecureString -Prompt "请输入 $User 的密码"
        $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
        $Password = [Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr)
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }

    Write-Info "Creating service '$ServiceName' as user: $User..."
    $objArg = "obj= `"$User`""
    $passArg = ""
    if ($Password) { $passArg = "password= `"$Password`"" }

    $result = & sc.exe create $ServiceName `
        binPath= $binPath `
        start= auto `
        DisplayName= $DisplayName `
        $objArg `
        $passArg 2>&1

    if ($LASTEXITCODE -ne 0) {
        Write-Err "Failed to create service: $result"
        exit 1
    }

    & sc.exe description $ServiceName $Description 2>&1 | Out-Null

    & sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/10000/restart/30000 2>&1 | Out-Null

    Write-Info "Starting service '$ServiceName'..."
    Start-Service $ServiceName -ErrorAction Stop

    Start-Sleep -Seconds 2
    $svc = Get-Service $ServiceName
    if ($svc.Status -eq 'Running') {
        Write-Ok "Service '$ServiceName' installed and running on port $Port"
        Write-Ok "Stdout log: $($logs.stdout)"
        Write-Ok "Stderr log: $($logs.stderr)"
    } else {
        Write-Warn "Service installed but status: $($svc.Status)"
    }
}

function Uninstall-Service {
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $service) {
        Write-Warn "Service '$ServiceName' not found."
        return
    }
    Write-Info "Stopping service '$ServiceName'..."
    Stop-Service $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3

    Write-Info "Removing service '$ServiceName'..."
    & sc.exe delete $ServiceName 2>&1 | Out-Null
    Start-Sleep -Seconds 2

    $check = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $check) {
        Write-Ok "Service '$ServiceName' removed."
    } else {
        Write-Err "Failed to remove service."
    }
}

function Start-ServiceAction {
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $service) {
        Write-Err "Service '$ServiceName' not found. Run 'install' first."
        exit 1
    }
    if ($service.Status -eq 'Running') {
        Write-Warn "Service '$ServiceName' is already running."
        return
    }
    Write-Info "Starting service '$ServiceName'..."
    Start-Service $ServiceName -ErrorAction Stop
    Write-Ok "Service '$ServiceName' started."
}

function Stop-ServiceAction {
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $service) {
        Write-Warn "Service '$ServiceName' not found."
        return
    }
    if ($service.Status -eq 'Stopped') {
        Write-Warn "Service '$ServiceName' is already stopped."
        return
    }
    Write-Info "Stopping service '$ServiceName'..."
    Stop-Service $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-Ok "Service '$ServiceName' stopped."
}

function Restart-ServiceAction {
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $service) {
        Write-Err "Service '$ServiceName' not found."
        exit 1
    }
    Write-Info "Restarting service '$ServiceName'..."
    Restart-Service $ServiceName -Force -ErrorAction Stop
    Write-Ok "Service '$ServiceName' restarted."
}

function Get-Status {
    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $service) {
        Write-Warn "Service '$ServiceName' is not installed."
        return
    }
    $status = $service.Status
    if ($status -eq 'Running') {
        Write-Ok "Service '$ServiceName' is $status"
    } elseif ($status -eq 'Stopped') {
        Write-Warn "Service '$ServiceName' is $status"
    } else {
        Write-Info "Service '$ServiceName' is $status"
    }

    $config = & sc.exe qc $ServiceName 2>$null
    if ($config) {
        Write-Host "`nConfiguration:"
        $config | ForEach-Object { Write-Host "  $_" }
    }
}

function Show-Logs {
    $logs = Get-LogPath
    $stdoutLog = $logs.stdout
    $stderrLog = $logs.stderr

    if (Test-Path $stdoutLog) {
        Write-Host "=== stdout log ($stdoutLog) ===" -ForegroundColor Cyan
        Get-Content $stdoutLog -Tail 30
    } else {
        Write-Warn "stdout log not found: $stdoutLog"
    }

    if (Test-Path $stderrLog) {
        Write-Host "`n=== stderr log ($stderrLog) ===" -ForegroundColor Cyan
        Get-Content $stderrLog -Tail 30
    } else {
        Write-Warn "stderr log not found: $stderrLog"
    }
}

switch ($Action) {
    'install'   { Install-Service }
    'uninstall' { Uninstall-Service }
    'start'     { Start-ServiceAction }
    'stop'      { Stop-ServiceAction }
    'restart'   { Restart-ServiceAction }
    'status'    { Get-Status }
    'logs'      { Show-Logs }
}
