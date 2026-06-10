# @atlisp/mcp PowerShell Installation Script
# For installing @lisp MCP Server and its dependencies

$ErrorActionPreference = "Stop"
$packageName = "@atlisp/mcp"
$minNodeVersion = 18

Write-Host "=== $packageName Installation Script ===" -ForegroundColor Cyan
Write-Host ""

function Get-NodeLtsVersion {
    try {
        $response = Invoke-WebRequest -Uri "https://nodejs.org/dist/index.json" -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
        $versions = $response.Content | ConvertFrom-Json
        $lts = $versions | Where-Object { $_.lts -ne $false } | Select-Object -First 1
        if ($lts) {
            $nodeVersion = $lts.version -replace '^v'
            Write-Host "Found Node.js LTS: $nodeVersion" -ForegroundColor Cyan
            return $nodeVersion
        }
    }
    catch {
        Write-Host "Failed to fetch LTS version, using default" -ForegroundColor Yellow
    }
    return "22.17.0"
}

function Add-NodeToPath {
    $nodePaths = @(
        "${env:ProgramFiles}\nodejs",
        "${env:ProgramFiles(x86)}\nodejs",
        "${env:APPDATA}\npm",
        "${env:ProgramFiles}\nodejs"
    )
    $added = $false
    foreach ($nodePath in $nodePaths) {
        if ((Test-Path "$nodePath\node.exe") -and ($env:Path -notlike "*$nodePath*")) {
            $env:Path = "$nodePath;" + $env:Path
            $added = $true
            Write-Host "Added to PATH: $nodePath" -ForegroundColor Cyan
        }
    }
    return $added
}

function Install-NodeJS {
    Write-Host "Node.js not found, starting automatic installation..." -ForegroundColor Yellow

    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Host "Installing Node.js LTS via winget..." -ForegroundColor Cyan
        winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Node.js installed via winget, detecting..." -ForegroundColor Green
            Start-Sleep -Seconds 3
            Add-NodeToPath
            return $true
        }
        Write-Host "winget install failed" -ForegroundColor Yellow
    }

    if (Get-Command choco -ErrorAction SilentlyContinue) {
        Write-Host "Installing Node.js LTS via choco..." -ForegroundColor Cyan
        choco install nodejs-lts -y
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Node.js installed via choco, detecting..." -ForegroundColor Green
            Start-Sleep -Seconds 3
            Add-NodeToPath
            return $true
        }
        Write-Host "choco install failed" -ForegroundColor Yellow
    }

    if (Get-Command scoop -ErrorAction SilentlyContinue) {
        Write-Host "Installing Node.js LTS via scoop..." -ForegroundColor Cyan
        scoop install nodejs-lts
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Node.js installed via scoop, detecting..." -ForegroundColor Green
            Start-Sleep -Seconds 3
            Add-NodeToPath
            return $true
        }
        Write-Host "scoop install failed" -ForegroundColor Yellow
    }

    $nodeVersion = Get-NodeLtsVersion
    Write-Host "Downloading Node.js v$nodeVersion..." -ForegroundColor Cyan
    $nodeUrl = "https://nodejs.org/dist/v$nodeVersion/node-v$nodeVersion-x64.msi"
    $installer = "$env:TEMP\node-setup.msi"
    try {
        Invoke-WebRequest -Uri $nodeUrl -OutFile $installer -UseBasicParsing
        Write-Host "Running installer..." -ForegroundColor Cyan
        $proc = Start-Process msiexec.exe -Wait -ArgumentList "/i `"$installer`" /quiet /norestart" -PassThru
        Remove-Item $installer -Force -ErrorAction SilentlyContinue
        if ($proc.ExitCode -ne 0 -and $proc.ExitCode -ne 3010) {
            Write-Host "MSI install failed with code: $($proc.ExitCode)" -ForegroundColor Red
            exit 1
        }
        Write-Host "Node.js installed via MSI" -ForegroundColor Green
        Add-NodeToPath
        return $true
    }
    catch {
        Write-Host "Automatic installation failed. Please download manually: https://nodejs.org/" -ForegroundColor Red
        exit 1
    }
}

function Test-NodeInstalled {
    $nodeVersion = $null
    $checkedPaths = @()

    Add-NodeToPath | Out-Null

    for ($retry = 0; $retry -lt 5; $retry++) {
        if ($retry -gt 0) {
            Write-Host "Retrying detection (attempt $retry/5)..." -ForegroundColor Yellow
            Start-Sleep -Seconds 2
            Add-NodeToPath | Out-Null
        }
        try {
            $result = node --version 2>$null
            if ($result) {
                $str = $result.ToString().Trim()
                $nodeVersion = $str.TrimStart("v")
                if (-not [string]::IsNullOrEmpty($nodeVersion)) {
                    Write-Host "Node.js detected: v$nodeVersion" -ForegroundColor Green
                    return $nodeVersion
                }
            }
        }
        catch {
        }
    }

    Write-Host "Node.js not found, installing..." -ForegroundColor Yellow
    $installed = Install-NodeJS
    if ($installed) {
        for ($retry = 0; $retry -lt 5; $retry++) {
            Start-Sleep -Seconds 2
            Add-NodeToPath | Out-Null
            try {
                $result = node --version 2>$null
                if ($result) {
                    $nodeVersion = $result.ToString().Trim().TrimStart("v")
                    if (-not [string]::IsNullOrEmpty($nodeVersion)) {
                        Write-Host "Node.js detected after install: v$nodeVersion" -ForegroundColor Green
                        return $nodeVersion
                    }
                }
            }
            catch {
            }
        }
    }

    Write-Host "Failed to detect Node.js" -ForegroundColor Red
    exit 1
}

function Test-NodeVersion {
    param([string]$version)
    Write-Host "Validating Node.js version: [$version]" -ForegroundColor Cyan
    if ([string]::IsNullOrEmpty($version)) {
        Write-Host "Error: Invalid Node.js version (empty)" -ForegroundColor Red
        exit 1
    }
    if ($version.Length -lt 3) {
        Write-Host "Error: Invalid Node.js version (too short): $version" -ForegroundColor Red
        exit 1
    }
    $ver = $version.Trim()
    $parts = $ver.Split(".")
    if ($parts.Length -eq 0) {
        Write-Host "Error: Invalid Node.js version format" -ForegroundColor Red
        exit 1
    }
    $firstPart = $parts[0]
    try {
        $major = [int]::Parse($firstPart)
    }
    catch {
        Write-Host "Error: Cannot parse major version: '$firstPart'" -ForegroundColor Red
        exit 1
    }
    if ($major -lt $minNodeVersion) {
        Write-Host "Error: Node.js version too low (current: $ver, required: >= $minNodeVersion)" -ForegroundColor Red
        exit 1
    }
}

function Test-NpmAvailable {
    try {
        $npmVersion = (npm --version 2>$null).ToString().Trim()
        if ($npmVersion) {
            Write-Host "npm detected: v$npmVersion" -ForegroundColor Green
            $globalPath = npm root -g
            if ($globalPath) {
                if ($env:Path -notlike "*$globalPath*") {
                    $env:Path = "$globalPath;" + $env:Path
                    Write-Host "Added npm global path to PATH: $globalPath" -ForegroundColor Cyan
                }
            }
        }
        else {
            Write-Host "Error: npm not available" -ForegroundColor Red
            exit 1
        }
    }
    catch {
        Write-Host "Error: npm not available" -ForegroundColor Red
        exit 1
    }
}

function Install-Package {
    $nodeVersion = Test-NodeInstalled
    Test-NodeVersion $nodeVersion
    Test-NpmAvailable

    Write-Host ""
    Write-Host "Installing $packageName from npm registry..." -ForegroundColor Cyan
    npm install -g @atlisp/mcp --silent

    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: npm install failed" -ForegroundColor Red
        exit 1
    }

    Add-NodeToPath | Out-Null
    $globalPath = (npm root -g).ToString()
    if ($globalPath -and ($env:Path -notlike "*$globalPath*")) {
        $env:Path = "$globalPath;" + $env:Path
        Write-Host "Added npm global path to PATH: $globalPath" -ForegroundColor Cyan
    }

    Write-Host ""
    Write-Host "=== Installation Complete ===" -ForegroundColor Green

    $runMcp = Read-Host "Start atlisp-mcp now? (Y/N)"
    if ($runMcp -eq "Y" -or $runMcp -eq "y") {
        $env:Path = "$env:APPDATA\npm;" + $env:Path
        Write-Host "Starting atlisp-mcp..." -ForegroundColor Cyan
        atlisp-mcp
    }
}

Install-Package
