# Loom Observatory — launch script (Windows)
# Usage: pwsh scripts/observatory.ps1

$ErrorActionPreference = "Stop"

$nodeVersion = (node --version 2>$null)
if (-not $nodeVersion) {
    Write-Error "Node.js is required but not found on PATH. Install Node 22+ and retry."
    exit 1
}

$major = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
if ($major -lt 22) {
    Write-Error "Node $nodeVersion found but Node 22+ is required."
    exit 1
}

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $projectRoot "observatory" "server.mjs"))) {
    $projectRoot = Split-Path -Parent $PSScriptRoot
}

$env:LOOM_PROJECT_ROOT = $projectRoot
Write-Host "[observatory] starting from $projectRoot"

node (Join-Path $projectRoot "observatory" "server.mjs")
