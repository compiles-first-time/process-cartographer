# `loom secrets-doctor` — PowerShell wrapper.
# See scripts/lib/secrets-doctor.mjs and adr/0018-secrets-handling.md.

param(
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$Rest
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$checker = Join-Path $root "scripts/lib/secrets-doctor.mjs"

if (-not (Test-Path $checker)) {
    Write-Error "$checker not found"
    exit 2
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "node not on PATH (Loom v0.2+ requires Node 22+)"
    exit 2
}

Set-Location $root
if ($Rest) {
    & node $checker @Rest
} else {
    & node $checker
}
exit $LASTEXITCODE
