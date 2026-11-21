# 把 web/ 与 vendor/ 同步到桌面的交付目录，并生成双击可用的启动脚本。
# 用法：powershell -ExecutionPolicy Bypass -File tools\deploy-desktop.ps1
[CmdletBinding()]
param(
    [string]$Dest = "$env:USERPROFILE\Desktop\行星发动机",
    [int]$Port = 8899,
    [string]$Source = ""
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($Source)) { $Source = $repo } else { $Source = (Resolve-Path $Source).Path }
$web = Join-Path $Source "web"
$vendor = Join-Path $Source "vendor"

if (-not (Test-Path $web)) { throw "找不到 web/：$web（任务还没产出）" }
if (-not (Test-Path $vendor)) { throw "找不到 vendor/：$vendor" }

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Dest "vendor") | Out-Null

Copy-Item (Join-Path $web "*") -Destination $Dest -Recurse -Force
Copy-Item (Join-Path $vendor "three.module.js") -Destination (Join-Path $Dest "vendor") -Force
Copy-Item (Join-Path $vendor "OrbitControls.js") -Destination (Join-Path $Dest "vendor") -Force

$launcher = @(
    '@echo off',
    'chcp 65001 >nul',
    'cd /d "%~dp0"',
    "echo 行星发动机控制台已启动： http://127.0.0.1:$Port/",
    "start """" ""http://127.0.0.1:$Port/""",
    "python -m http.server $Port --bind 127.0.0.1"
) -join "`r`n"
Set-Content -Path (Join-Path $Dest "启动.cmd") -Value $launcher -Encoding OEM

Write-Host "已同步到 $Dest"
Get-ChildItem $Dest | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize