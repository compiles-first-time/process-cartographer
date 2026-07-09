# `loom deploy` — PowerShell wrapper.
# See scripts/lib/deploy.mjs and adr/0019-deploy-primitive.md.

param(
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$Rest
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$runner = Join-Path $root "scripts/lib/deploy.mjs"

if (-not (Test-Path $runner)) {
    Write-Error "$runner not found"
    exit 2
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "node not on PATH (Loom v0.2+ requires Node 22+)"
    exit 2
}

Set-Location $root
if ($Rest) {
    & node $runner @Rest
} else {
    & node $runner
}
exit $LASTEXITCODE
