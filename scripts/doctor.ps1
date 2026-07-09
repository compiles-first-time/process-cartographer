# `loom doctor` — PowerShell wrapper around the Node checker.
# See scripts/lib/doctor.mjs and adr/0015-loom-doctor.md.

param(
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$Rest
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$checker = Join-Path $root "scripts/lib/doctor.mjs"

if (-not (Test-Path $checker)) {
    Write-Error "$checker not found"
    exit 2
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "node not on PATH (Loom v0.2 requires Node 22+)"
    exit 2
}

Set-Location $root
Write-Host "loom doctor - checking project at $root"
Write-Host ""

if ($Rest) {
    & node $checker @Rest
} else {
    & node $checker
}
exit $LASTEXITCODE
