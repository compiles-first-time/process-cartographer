# Loom playbook re-validation — Windows / PowerShell.
#
# Per ADR-0035 §C layer 3. Sister script to validate-playbook.sh; same purpose.

[CmdletBinding()]
param(
    [Parameter(Position=0)] [string]$Platform,
    [switch]$All,
    [switch]$Dispatch
)

$ErrorActionPreference = "Stop"
$repoRoot = (Get-Location).Path
$playbookDir = Join-Path $repoRoot "tools\provisioning-playbooks"

if (-not (Test-Path $playbookDir)) {
    Write-Host "ERROR: no playbook directory at $playbookDir" -ForegroundColor Red
    exit 1
}

if ($All) {
    $playbooks = Get-ChildItem $playbookDir -Filter "*.md" | Where-Object { $_.Name -notlike "README*" }
} elseif (-not $Platform) {
    Write-Host "ERROR: must specify a platform or -All" -ForegroundColor Red
    Write-Host ""
    Write-Host "Available playbooks:"
    Get-ChildItem $playbookDir -Filter "*.md" | Where-Object { $_.Name -notlike "README*" } | ForEach-Object { Write-Host "  - $($_.BaseName)" }
    exit 1
} else {
    $pb = Join-Path $playbookDir "$Platform.md"
    if (-not (Test-Path $pb)) {
        Write-Host "ERROR: no playbook at $pb" -ForegroundColor Red
        exit 1
    }
    $playbooks = @(Get-Item $pb)
}

foreach ($pb in $playbooks) {
    $platformName = $pb.BaseName
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  Re-validating: $platformName" -ForegroundColor Cyan
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan

    $content = Get-Content $pb.FullName -Raw

    # Extract cited URLs from the "Vendor canonical docs" section
    $docsMatch = [regex]::Match($content, "(?ms)^## Vendor canonical docs.*?(?=^## |\z)")
    $urls = if ($docsMatch.Success) {
        ([regex]::Matches($docsMatch.Value, "https?://[^\s)]+") | ForEach-Object { $_.Value } | Sort-Object -Unique)
    } else {
        @()
    }

    $promptFile = [System.IO.Path]::GetTempFileName() + ".md"
    $prompt = @"
Mission: re-validate the Loom provisioning playbook for $platformName against current vendor docs.

You are acting as the provisioning specialist via ADR-0034 path 2b (use the SKILL.md content as your prompt). Read:

1. $($pb.FullName) (the playbook to re-validate)
2. $repoRoot\agents\specialists\_registry\provisioning\SKILL.md (your specialist discipline)
3. Each of the cited vendor URLs below; compare against the playbook content + report discrepancies.

Cited vendor URLs to re-check:
$($urls -join "`n")

For EACH section of the playbook (header + each Class A / B / C subsection):
- Verify the cited URL is still live + the documented content matches what the playbook says
- Flag rebrands (e.g., "Cloud Console" → "Google Auth Platform")
- Flag deprecations (e.g., IAP OAuth Admin API removed)
- Flag field renames, click-sequence changes, API endpoint changes
- Note new opportunities (e.g., a previously browser-only operation now has an API)

Output a structured diff:
- ✓ <section>: verified (no changes detected)
- ⚠ <section>: minor drift — <description + recommended edit>
- ✗ <section>: major drift — <description + recommended new content>

Update the per-section last_verified date markers in the playbook to today's date for each section verified clean. Push any required content changes as a follow-up PR.

Confidence per finding: [H] / [M] / [L] per LR-05. Cite the vendor URL for every claim.
"@
    Set-Content -Path $promptFile -Value $prompt -Encoding utf8

    Write-Host ""
    Write-Host "Prompt written to: $promptFile" -ForegroundColor Green
    Write-Host ""

    if ($Dispatch -and (Get-Command claude -ErrorAction SilentlyContinue)) {
        Write-Host "Dispatching to claude CLI..." -ForegroundColor Yellow
        Get-Content $promptFile -Raw | claude --print
    } else {
        Write-Host "To run this validation:" -ForegroundColor Yellow
        Write-Host "  - Open the prompt: Get-Content $promptFile -Raw" -ForegroundColor DarkGray
        Write-Host "  - Paste into a Claude Code session OR run: Get-Content $promptFile -Raw | claude --print" -ForegroundColor DarkGray
        Write-Host "  - When done: Remove-Item $promptFile" -ForegroundColor DarkGray
        Write-Host ""
        Write-Host "Or re-run with -Dispatch to auto-pipe (if claude CLI is installed)." -ForegroundColor DarkGray
    }
    Write-Host ""
}
