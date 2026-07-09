# `loom eval-subagents` — PowerShell wrapper.
# See scripts/lib/eval-subagents.mjs and adr/0021-subagent-evals.md.

param(
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$Rest
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$runner = Join-Path $root "scripts/lib/eval-subagents.mjs"

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
