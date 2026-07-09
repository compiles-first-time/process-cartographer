# Loom v0.1 manual bootstrap helper (PowerShell)
#
# At v0.1 the bootstrap is manual. This script performs the deterministic steps
# (placeholder substitution, smoke checks) but leaves agent decisions to you.
#
# Usage:
#   .\scripts\bootstrap.ps1 -ProjectName "my-new-project" -Description "..." -UserName "Nick"

param(
    [Parameter(Mandatory=$true)]
    [string]$ProjectName,

    [Parameter(Mandatory=$false)]
    [string]$Description = "",

    [Parameter(Mandatory=$false)]
    [string]$UserName = $env:USERNAME,

    [switch]$SetupCredentials   # Prompt for platform credential collection via keyring/collect-credentials (ADR-0036 §E)
)

$ErrorActionPreference = "Stop"
$root = (Get-Location).Path
Write-Host "Loom v0.1 bootstrap" -ForegroundColor Cyan
Write-Host "  Project: $ProjectName"
Write-Host "  Root:    $root"
Write-Host ""

# --- 1. Placeholder substitution -------------------------------------------------
$placeholderFiles = @(
    "README.md",
    "CLAUDE.md",
    "AGENTS.md",
    "loom-spec.md",
    "constitution/kernel-v6.md",
    "constitution/local-rules.md",
    "memory/self-knowledge.md",
    "tools/mcp-servers/config.yaml",
    "tools/runtime.yaml",
    "observability/langfuse-config.yaml"
)

$replacements = @{
    "<PROJECT_NAME>" = $ProjectName
    "<USER_NAME>"    = $UserName
    "<YYYY-MM-DD>"   = (Get-Date -Format "yyyy-MM-dd")
}

foreach ($rel in $placeholderFiles) {
    $path = Join-Path $root $rel
    if (-not (Test-Path $path)) {
        Write-Host "  skip (missing): $rel" -ForegroundColor DarkGray
        continue
    }
    $content = Get-Content $path -Raw -Encoding UTF8
    $changed = $false
    foreach ($key in $replacements.Keys) {
        if ($content -match [regex]::Escape($key)) {
            $content = $content -replace [regex]::Escape($key), $replacements[$key]
            $changed = $true
        }
    }
    if ($changed) {
        Set-Content -Path $path -Value $content -Encoding UTF8 -NoNewline
        Write-Host "  stamped: $rel" -ForegroundColor Green
    }
}

# --- 2. Smoke checks -------------------------------------------------------------
Write-Host ""
Write-Host "Running smoke checks..." -ForegroundColor Cyan

$failures = @()

$requiredDirs = @(
    "constitution", "layers", "agents/hr", "agents/eac", "agents/human-replica",
    "agents/critic", "agents/memory-keeper", "agents/constitution-service",
    "memory/event-log", "memory/skills", "tools/mcp-servers",
    "orchestration", "observability/eval-suite", "adr", "lessons-learned",
    "update-bus/inbox", "update-bus/archive", "spec"
)
foreach ($d in $requiredDirs) {
    if (-not (Test-Path (Join-Path $root $d))) {
        $failures += "missing directory: $d"
    }
}

$requiredFiles = @(
    "README.md", "CLAUDE.md", "AGENTS.md", "loom-spec.md", "LICENSE",
    ".gitignore", ".env.example",
    "constitution/kernel-v6.md", "constitution/local-rules.md",
    "spec/loom-spec-v0.1-full.md",
    "tools/mcp-servers/config.yaml",
    "observability/langfuse-config.yaml",
    "adr/0000-template.md", "adr/0001-loom-version.md", "adr/0002-orchestration-framework.md"
)
foreach ($f in $requiredFiles) {
    if (-not (Test-Path (Join-Path $root $f))) {
        $failures += "missing file: $f"
    }
}

# Size discipline
$claudeMd = Get-Item (Join-Path $root "CLAUDE.md") -ErrorAction SilentlyContinue
if ($claudeMd -and $claudeMd.Length -gt 10KB) {
    $failures += "CLAUDE.md exceeds 10 KB cap ($([int]($claudeMd.Length/1KB)) KB)"
}
$agentsMd = Get-Item (Join-Path $root "AGENTS.md") -ErrorAction SilentlyContinue
if ($agentsMd -and $agentsMd.Length -gt 5KB) {
    $failures += "AGENTS.md exceeds 5 KB cap ($([int]($agentsMd.Length/1KB)) KB)"
}

if ($failures.Count -gt 0) {
    Write-Host ""
    Write-Host "Smoke checks FAILED:" -ForegroundColor Red
    $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 1
}

Write-Host "  All smoke checks passed." -ForegroundColor Green

# --- 3. v0.2 runtime stamping ----------------------------------------------------
Write-Host ""
Write-Host "Generating v0.2 runtime artifacts..." -ForegroundColor Cyan

# Touch today's JSONL so hooks have somewhere to write
$dateLog = Join-Path $root "memory/event-log/$((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')).jsonl"
if (-not (Test-Path $dateLog)) {
    New-Item -ItemType File -Path $dateLog -Force | Out-Null
    Write-Host "  created: memory/event-log/$(Split-Path $dateLog -Leaf)"
} else {
    Write-Host "  exists:  memory/event-log/$(Split-Path $dateLog -Leaf)" -ForegroundColor DarkGray
}

# Regenerate .claude/settings.json mcpServers block from the YAML
$gen = Join-Path $root "scripts/lib/mcp-yaml-to-settings.mjs"
if ((Test-Path $gen) -and (Get-Command node -ErrorAction SilentlyContinue)) {
    try {
        & node $gen | ForEach-Object { Write-Host "  $_" }
    } catch {
        Write-Host "  warn: mcp settings generation failed (continuing)" -ForegroundColor Yellow
    }
} else {
    Write-Host "  skip: node or generator not available; .claude/settings.json mcpServers not regenerated" -ForegroundColor DarkGray
}

# Discover runtime (MCPs + subagents) and stamp the subagent sentinel.
$discover = Join-Path $root "scripts/lib/discover-runtime.mjs"
if ((Test-Path $discover) -and (Get-Command node -ErrorAction SilentlyContinue)) {
    try {
        & node $discover --quiet | ForEach-Object { Write-Host "  $_" }
    } catch {
        Write-Host "  warn: runtime discovery failed (continuing)" -ForegroundColor Yellow
    }
}
$sentinelDir = Join-Path $root ".claude/agents"
if (Test-Path $sentinelDir) {
    $sentinel = Join-Path $sentinelDir ".last-discovered-at"
    if (-not (Test-Path $sentinel)) {
        New-Item -ItemType File -Path $sentinel -Force | Out-Null
    }
    (Get-Item $sentinel).LastWriteTime = Get-Date
    Write-Host "  stamped: .claude/agents/.last-discovered-at (subagent discovery sentinel)"
}

# Quick-scan discovery (5 questions). Per ADR-0025 / L8.
$discoverScript = Join-Path $root "scripts/lib/discover.mjs"
if ((Test-Path $discoverScript) -and (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "Running quick-scan discovery (5 questions, ~2 min)..." -ForegroundColor Cyan
    try {
        & node $discoverScript --quick
    } catch {
        Write-Host "  warn: quick-scan failed (continuing)" -ForegroundColor Yellow
    }
}

# --- 4. Credential collection via keyring (ADR-0036 §E) -------------------------
# Gated on -SetupCredentials to avoid hanging on prompts during auto-bootstrap
# (SessionStart hook calls bootstrap without this flag).
#
# Keyring resolver patterns (for consuming credentials in project code):
#   Async (Node entry points / Next.js instrumentation.ts):
#     import { loadEnv } from "./scripts/lib/load-env.mjs";
#     await loadEnv({ root: projectDir });   // resolves keyring: refs into process.env
#   Sync (config loaders that can't await):
#     import { resolveKeyringRefSync } from "./scripts/lib/keyring.mjs";
#     const val = resolveKeyringRefSync(process.env.MY_KEY, projectDir);
#   Subdir layouts: set LOOM_KEYRING_PROJECT_DIR to the dir with node_modules.
#   Full docs: agents/specialists/_registry/secrets/SKILL.md §Keyring resolver patterns

if ($SetupCredentials) {
    Write-Host ""
    Write-Host "Credential setup (ADR-0036 §E)..." -ForegroundColor Cyan

    # Detect keyring availability
    $keyringAvailable = $false
    $keyringProbe = Join-Path $root "scripts/lib/keyring.mjs"
    if ((Test-Path $keyringProbe) -and (Get-Command node -ErrorAction SilentlyContinue)) {
        $probeScript = @"
import('file:///$($root.Replace('\','/'))/scripts/lib/keyring.mjs').then(async (m) => {
  const ok = await m.isKeyringAvailable();
  process.stdout.write(ok ? 'AVAILABLE' : 'UNAVAILABLE');
}).catch(() => process.stdout.write('UNAVAILABLE'));
"@
        try {
            $probeResult = & node -e $probeScript 2>$null
            $keyringAvailable = ($probeResult -eq "AVAILABLE")
        } catch {
            $keyringAvailable = $false
        }
    }

    if ($keyringAvailable) {
        Write-Host "  OS keyring is available (Windows Credential Manager)." -ForegroundColor Green
        Write-Host "  Use OS keyring for credential storage? [Y/n] " -NoNewline -ForegroundColor Yellow
        $useKeyring = Read-Host
        if ($useKeyring -match "^[Nn]") {
            Write-Host "  Skipping keyring — credentials will use literal .env.local." -ForegroundColor DarkGray
        } else {
            # List available platforms from collect-credentials
            $collectScript = Join-Path $root "scripts/collect-credentials.ps1"
            if (Test-Path $collectScript) {
                Write-Host ""
                Write-Host "  Available platforms for credential collection:" -ForegroundColor Cyan
                Write-Host "    supabase    — Supabase (Postgres + Auth + Storage)"
                Write-Host "    github      — GitHub (repos, issues, PRs)"
                Write-Host "    vercel      — Vercel (deploys + env vars)"
                Write-Host "    anthropic   — Anthropic API (Claude)"
                Write-Host ""
                Write-Host "  Enter platform names to set up now (space-separated), or 'skip': " -NoNewline -ForegroundColor Yellow
                $platformInput = Read-Host

                if ($platformInput -and $platformInput -ne "skip") {
                    $platforms = $platformInput -split "\s+" | Where-Object { $_ }
                    foreach ($plat in $platforms) {
                        Write-Host ""
                        Write-Host "  ────────────────────────────────────────" -ForegroundColor Cyan
                        Write-Host "  Collecting credentials for: $plat" -ForegroundColor Cyan
                        Write-Host "  ────────────────────────────────────────" -ForegroundColor Cyan
                        try {
                            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $collectScript -Platform $plat
                        } catch {
                            Write-Host "  ✗ collect-credentials failed for $plat`: $($_.Exception.Message)" -ForegroundColor Red
                            Write-Host "    Run manually: pwsh scripts/collect-credentials.ps1 $plat" -ForegroundColor DarkGray
                        }
                    }
                } else {
                    Write-Host "  Skipping credential collection. Run later: pwsh scripts/collect-credentials.ps1 <platform>" -ForegroundColor DarkGray
                }
            } else {
                Write-Host "  ✗ scripts/collect-credentials.ps1 not found. Skipping." -ForegroundColor Yellow
            }
        }
    } else {
        Write-Host "  OS keyring not available — credentials will use literal .env.local." -ForegroundColor Yellow
        Write-Host "  To enable: npm install --save-optional @napi-rs/keyring" -ForegroundColor DarkGray
    }
}

# --- 5. Summary ------------------------------------------------------------------
$subagentCount = (Get-ChildItem -Path (Join-Path $root ".claude/agents") -Filter "*.md" -ErrorAction SilentlyContinue | Measure-Object).Count
$hookCount = (Get-ChildItem -Path (Join-Path $root "scripts/hooks") -Filter "*.mjs" -ErrorAction SilentlyContinue | Measure-Object).Count

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Bootstrap complete - Loom v0.2.0 | Kernel v6" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Project:     $ProjectName"
Write-Host "  Root:        $root"
Write-Host "  Stamped:     $($placeholderFiles.Count) files"
Write-Host "  Event log:   memory/event-log/$(Split-Path $dateLog -Leaf)"
Write-Host "  Subagents:   $subagentCount at .claude/agents/"
Write-Host "  Hooks:       $hookCount at scripts/hooks/"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Install your canonical Trajectory Kernel V6 text into constitution/kernel-v6.md"
Write-Host "  2. Edit CLAUDE.md to describe this project's specific goals"
Write-Host "  3. Decide full-6 vs minimal-3 agent set (see layers/L2-agents.md)"
Write-Host "  4. Set up credentials: pwsh scripts/collect-credentials.ps1 <platform>"
Write-Host "     (Or re-run bootstrap with -SetupCredentials to be guided through it)"
Write-Host "  5. Confirm or override ADR-0002 (orchestration framework)"
Write-Host "  6. Edit tools/runtime.yaml: set deploy.command + post_deploy_url_pattern"
Write-Host "  7. git init; git add .; git commit -m 'Loom v0.3 scaffold'"
Write-Host ""
Write-Host "  Run scripts/doctor.ps1 to validate the project at any time."
Write-Host "  Run scripts/secrets-doctor.ps1 before any commit touching credentials."
Write-Host ""
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host "RESTART CLAUDE CODE NOW" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host "  Claude Code builds the subagent registry at session start."
Write-Host "  The six base subagents at .claude/agents/*.md were just"
Write-Host "  added to disk - they are NOT yet invokable in the current"
Write-Host "  session. Restart Claude Code to load them. (Per ADR-0020.)"
