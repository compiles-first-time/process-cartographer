# Loom credential collection — Windows / PowerShell.
#
# Per ADR-0036: collects platform PATs and other credentials via terminal
# stdin (NEVER through chat), validates them via read-only pre-flight calls
# (account-attestation closes Ravenwise Root cause 4), stores via
# @napi-rs/keyring, writes `keyring:<service>/<account>` references to
# .env.local. Falls back to literal .env.local storage if keyring is
# unavailable.
#
# Usage:
#   pwsh scripts/collect-credentials.ps1 <platform>
#   pwsh scripts/collect-credentials.ps1 supabase
#   pwsh scripts/collect-credentials.ps1 --rotate supabase          (re-prompt + overwrite)
#   pwsh scripts/collect-credentials.ps1 --list                     (show stored credential names, no values)
#   pwsh scripts/collect-credentials.ps1 --project-dir src supabase (app in a subdir, e.g. src/)
#
# Sister script for POSIX shells: scripts/collect-credentials.sh

[CmdletBinding()]
param(
    [Parameter(Position=0)] [string]$Platform,
    [switch]$Rotate,
    [switch]$List,
    [switch]$Force,
    [switch]$NoKeyring,       # forces .env.local literal storage even if keyring is available
    [string]$ProjectDir = ""  # target app dir when .env.local/node_modules live in a subdir (e.g. "src")
)

$ErrorActionPreference = "Stop"
$repoRoot = (Get-Location).Path
# $projectDir: where the app's .env.local / package.json / node_modules live.
# Defaults to $repoRoot; set --project-dir for monorepo/subdir layouts (e.g. src/).
$projectDir = if ($ProjectDir) { (Resolve-Path $ProjectDir -ErrorAction Stop).Path } else { $repoRoot }
$env:LOOM_KEYRING_PROJECT_DIR = $projectDir   # tells keyring.mjs which dir to resolve @napi-rs/keyring from
$nodePath = if ($env:NODE_PATH) { $env:NODE_PATH } else { (Get-Command node -ErrorAction SilentlyContinue).Source }
if (-not $nodePath) {
    Write-Host "ERROR: node not found on PATH. Install Node 22+ first." -ForegroundColor Red
    exit 1
}

# ── Platform registry ───────────────────────────────────────────────────
# Each platform declares: credential vars to collect, their LR-04 categories,
# and the validation endpoint. Extending = add a hashtable entry.

$Platforms = @{
    supabase = @{
        Description  = "Supabase (Postgres + Auth + Storage)"
        Setup_url    = "https://supabase.com/dashboard/account/tokens"
        Setup_hint   = "Generate a Personal Access Token (PAT) at the URL above. Scope: leave default (full account)."
        Credentials  = @(
            @{
                EnvVar        = "SUPABASE_PAT"
                KeyringAccount= "supabase-pat"
                Prompt        = "Paste your Supabase PAT (input hidden)"
                Validate_url  = "https://api.supabase.com/v1/organizations"
                Validate_auth = "bearer"
                Account_field = "name"   # field in response to display for attestation
            }
        )
    }
    github = @{
        Description  = "GitHub (repos, issues, PRs)"
        Setup_url    = "https://github.com/settings/tokens"
        Setup_hint   = "Generate a Personal Access Token (classic OR fine-grained). Minimal scopes: repo, read:user."
        Credentials  = @(
            @{
                EnvVar        = "GITHUB_PERSONAL_ACCESS_TOKEN"
                KeyringAccount= "github-pat"
                Prompt        = "Paste your GitHub PAT (input hidden)"
                Validate_url  = "https://api.github.com/user"
                Validate_auth = "bearer"
                Account_field = "login"
            }
        )
    }
    vercel = @{
        Description  = "Vercel (deploys + env vars)"
        Setup_url    = "https://vercel.com/account/tokens"
        Setup_hint   = "Generate an access token. Scope: full access OR per-project."
        Credentials  = @(
            @{
                EnvVar        = "VERCEL_TOKEN"
                KeyringAccount= "vercel-token"
                Prompt        = "Paste your Vercel access token (input hidden)"
                Validate_url  = "https://api.vercel.com/v2/user"
                Validate_auth = "bearer"
                Account_field = "user.username"
            }
        )
    }
    anthropic = @{
        Description  = "Anthropic API (Claude)"
        Setup_url    = "https://console.anthropic.com/settings/keys"
        Setup_hint   = "Generate an API key. Scope: as needed for your project."
        Credentials  = @(
            @{
                EnvVar        = "ANTHROPIC_API_KEY"
                KeyringAccount= "anthropic-api-key"
                Prompt        = "Paste your Anthropic API key (input hidden)"
                Validate_url  = $null       # No public whoami endpoint; skip validation
                Validate_auth = $null
                Account_field = $null
            }
        )
    }
    alpaca = @{
        Description  = "Alpaca (paper-trading brokerage)"
        Setup_url    = "https://app.alpaca.markets/signup"
        Setup_hint   = "Sign up (or log in), open the Paper Trading dashboard, and generate API keys. The Secret is shown ONCE - copy it now. The credential-setup specialist (ADR-0042) can drive this in the browser with your consent."
        CustomCollector = "alpaca"   # paired (two-header) validate-before-store; see Invoke-AlpacaPairedCollection
        Validate_url = "https://paper-api.alpaca.markets/v2/account"
        Credentials  = @(
            @{ EnvVar = "ALPACA_KEY_ID";     KeyringAccount = "alpaca-key-id" }
            @{ EnvVar = "ALPACA_SECRET_KEY"; KeyringAccount = "alpaca-secret-key" }
        )
    }
}

# ── Helpers for custom (paired-validation) collectors ───────────────────

function ConvertFrom-SecureStringPlain {
    param([System.Security.SecureString]$Secure)
    if (-not $Secure) { return $null }
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try { return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# Alpaca uses two headers (APCA-API-KEY-ID / APCA-API-SECRET-KEY) validated as
# a PAIR against GET /v2/account. Unlike the single-bearer platforms, we collect
# both, validate them together, attest the account, and only THEN store - so a
# wrong/swapped key is never written to the keyring. Per ADR-0042 section F.
function Invoke-AlpacaPairedCollection {
    param(
        [hashtable]$PlatformConfig,
        [string]$ServiceKey,
        [bool]$UseKeyring,
        [string]$RepoRoot,
        [string]$ProjectDir,   # app dir for .env.local; falls back to RepoRoot if empty
        [string]$NodePath,
        [bool]$Rotate,
        [bool]$Force
    )

    $appDir = if ($ProjectDir) { $ProjectDir } else { $RepoRoot }
    $envFile = "$appDir/.env.local"
    if ((Test-Path $envFile) -and -not $Rotate -and -not $Force) {
        $hasKey = (Get-Content $envFile) | Where-Object { $_ -match "^ALPACA_KEY_ID=." }
        $hasSec = (Get-Content $envFile) | Where-Object { $_ -match "^ALPACA_SECRET_KEY=." }
        if ($hasKey -and $hasSec) {
            Write-Host "  Alpaca keys already set in .env.local. Use --rotate to overwrite, --list to inspect." -ForegroundColor DarkGray
            return
        }
    }

    Write-Host "-> ALPACA_KEY_ID + ALPACA_SECRET_KEY (validated together)" -ForegroundColor Cyan
    $secureKey = Read-Host -Prompt "  Paste your Alpaca API Key ID (input hidden)" -AsSecureString
    $secureSec = Read-Host -Prompt "  Paste your Alpaca API Secret Key (input hidden)" -AsSecureString
    $keyId  = ConvertFrom-SecureStringPlain $secureKey
    $secret = ConvertFrom-SecureStringPlain $secureSec
    if (-not $keyId -or -not $secret) {
        Write-Host "  x Both Key ID and Secret are required; nothing stored." -ForegroundColor Red
        return
    }

    # Paired validate-before-store + account attestation (closes Ravenwise Root cause 4).
    $validateUrl = $PlatformConfig.Validate_url
    if ($validateUrl) {
        Write-Host "  Validating key pair via $validateUrl..." -ForegroundColor DarkGray
        $headers = @{ "APCA-API-KEY-ID" = $keyId; "APCA-API-SECRET-KEY" = $secret }
        try {
            $resp = Invoke-RestMethod -Uri $validateUrl -Headers $headers -Method GET -ErrorAction Stop
            Write-Host "  + Key pair valid. Paper account: $($resp.account_number)  Status: $($resp.status)" -ForegroundColor Green
            Write-Host ""
            Write-Host "  ATTESTATION REQUIRED" -ForegroundColor Yellow
            Write-Host "  These keys authenticate Alpaca paper account: " -NoNewline
            Write-Host "$($resp.account_number) ($($resp.status))" -ForegroundColor Cyan
            Write-Host "  Is this the intended account for this project? [y/N] " -NoNewline -ForegroundColor Yellow
            $confirm = Read-Host
            if ($confirm -notmatch "^[Yy]") {
                Write-Host "  x Attestation declined. Keys discarded (nothing stored)." -ForegroundColor Red
                $keyId = $null; $secret = $null
                return
            }
        } catch {
            Write-Host "  x Validation failed: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host "    Keys may be wrong, swapped, or revoked. Nothing stored. (CRED-EX-08)" -ForegroundColor DarkGray
            $keyId = $null; $secret = $null
            return
        }
    }

    $pairs = @(
        @{ EnvVar = "ALPACA_KEY_ID";     Account = "alpaca-key-id";     Value = $keyId },
        @{ EnvVar = "ALPACA_SECRET_KEY"; Account = "alpaca-secret-key"; Value = $secret }
    )
    foreach ($p in $pairs) {
        if ($UseKeyring) {
            $writeScript = @"
import('file:///$($RepoRoot.Replace('\','/'))/scripts/lib/keyring.mjs').then(async (m) => {
  let value = '';
  for await (const chunk of process.stdin) value += chunk;
  await m.setCredential('$ServiceKey', '$($p.Account)', value.trimEnd());
  process.stdout.write('STORED');
});
"@
            $write = $p.Value | & $NodePath -e $writeScript 2>&1
            if ($write -ne "STORED") {
                Write-Host "  x Keyring write failed for $($p.EnvVar): $write" -ForegroundColor Red
                continue
            }
            $envValue = "keyring:$ServiceKey/$($p.Account)"
            Write-Host "  + $($p.EnvVar) stored in OS keyring; reference: $envValue" -ForegroundColor Green
        } else {
            $envValue = $p.Value
            Write-Host "  + $($p.EnvVar) will be written literally to .env.local (no keyring)" -ForegroundColor Yellow
        }

        if (-not (Test-Path $envFile)) {
            if (Test-Path "$appDir/.env.example") { Copy-Item "$appDir/.env.example" $envFile }
            else { New-Item -Path $envFile -ItemType File -Force | Out-Null }
        }
        $content = Get-Content $envFile -Raw
        if ($content -match "(?m)^$($p.EnvVar)=.*$") {
            $newContent = $content -replace "(?m)^$($p.EnvVar)=.*$", "$($p.EnvVar)=$envValue"
        } else {
            $newContent = $content.TrimEnd() + "`n$($p.EnvVar)=$envValue`n"
        }
        Set-Content -Path $envFile -Value $newContent -NoNewline -Encoding utf8
    }

    # Scrub local copies.
    $keyId = $null; $secret = $null
    foreach ($p in $pairs) { $p.Value = $null }
}

function Show-PlatformList {
    Write-Host ""
    Write-Host "Supported platforms (extend in scripts/collect-credentials.ps1):" -ForegroundColor Cyan
    foreach ($key in ($Platforms.Keys | Sort-Object)) {
        $p = $Platforms[$key]
        Write-Host ("  {0,-12} {1}" -f $key, $p.Description)
    }
    Write-Host ""
    Write-Host "Usage: pwsh scripts/collect-credentials.ps1 <platform>" -ForegroundColor DarkGray
}

if (-not $Platform -and -not $List) {
    Show-PlatformList
    exit 0
}

# ── Keyring availability check ──────────────────────────────────────────

function Test-KeyringAvailable {
    $probe = @"
import('file:///$($repoRoot.Replace('\','/'))/scripts/lib/keyring.mjs').then(async (m) => {
  const ok = await m.isKeyringAvailable();
  process.stdout.write(ok ? 'AVAILABLE' : 'UNAVAILABLE');
}).catch(() => process.stdout.write('UNAVAILABLE'));
"@
    $result = & $nodePath -e $probe 2>&1
    return ($result -eq "AVAILABLE")
}

$useKeyring = -not $NoKeyring
if ($useKeyring) {
    $available = Test-KeyringAvailable
    if (-not $available) {
        Write-Host ""
        Write-Host "OS keyring not available (or @napi-rs/keyring not installed)." -ForegroundColor Yellow
        Write-Host "  Install:  npm install --save-optional @napi-rs/keyring" -ForegroundColor DarkGray
        Write-Host "  Falling back to literal .env.local storage for this run." -ForegroundColor Yellow
        Write-Host ""
        $useKeyring = $false
    }
}

# ── --list mode ─────────────────────────────────────────────────────────

if ($List) {
    Write-Host ""
    if (-not $useKeyring) {
        Write-Host "Keyring unavailable; cannot list stored credentials." -ForegroundColor Yellow
        exit 1
    }
    $listProbe = @"
import('file:///$($repoRoot.Replace('\','/'))/scripts/lib/keyring.mjs').then(async (m) => {
  const svc = await m.getServiceKey('$($projectDir.Replace('\','/').Replace("'", "\\'"))');
  process.stdout.write('SERVICE_KEY=' + svc);
});
"@
    $svc = & $nodePath -e $listProbe 2>&1
    Write-Host "Service key: $svc"
    Write-Host ""
    Write-Host "Stored credentials are listed via .env.local 'keyring:<service>/<account>' references." -ForegroundColor DarkGray
    if (Test-Path "$projectDir/.env.local") {
        Get-Content "$projectDir/.env.local" | Where-Object { $_ -match "keyring:" } | ForEach-Object {
            if ($_ -match "^([A-Z_]+)=keyring:") {
                Write-Host ("  - {0}" -f $matches[1])
            }
        }
    } else {
        Write-Host "  (no .env.local found at $projectDir)"
    }
    exit 0
}

# ── Platform lookup ─────────────────────────────────────────────────────

if (-not $Platforms.ContainsKey($Platform)) {
    Write-Host "ERROR: unknown platform '$Platform'" -ForegroundColor Red
    Show-PlatformList
    exit 1
}

$platformConfig = $Platforms[$Platform]
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  $($platformConfig.Description)" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "Setup (one-time):" -ForegroundColor Yellow
Write-Host "  $($platformConfig.Setup_hint)"
Write-Host "  URL: $($platformConfig.Setup_url)" -ForegroundColor DarkGray
Write-Host ""

# Get the keyring service key for this project (if using keyring)
$serviceKey = $null
if ($useKeyring) {
    $svcProbe = @"
import('file:///$($repoRoot.Replace('\','/'))/scripts/lib/keyring.mjs').then(async (m) => {
  const svc = await m.getServiceKey('$($projectDir.Replace('\','/').Replace("'", "\\'"))');
  process.stdout.write(svc);
});
"@
    $serviceKey = & $nodePath -e $svcProbe 2>&1
    Write-Host "Storage: OS keyring, service '$serviceKey'" -ForegroundColor Green
} else {
    Write-Host "Storage: literal .env.local (no keyring)" -ForegroundColor Yellow
}
Write-Host ""

# ── Collect each credential for the platform ───────────────────────────

# Custom collectors (platforms needing paired / combined validation)
if ($platformConfig.CustomCollector -eq "alpaca") {
    Invoke-AlpacaPairedCollection -PlatformConfig $platformConfig -ServiceKey $serviceKey -UseKeyring ([bool]$useKeyring) -RepoRoot $repoRoot -ProjectDir $projectDir -NodePath $nodePath -Rotate ([bool]$Rotate) -Force ([bool]$Force)
    Write-Host ""
    Write-Host "Done. .env.local updated for platform '$Platform'." -ForegroundColor Green
    Write-Host "Run again with --rotate to refresh a credential." -ForegroundColor DarkGray
    exit 0
}

foreach ($cred in $platformConfig.Credentials) {
    Write-Host ""
    Write-Host "→ $($cred.EnvVar)" -ForegroundColor Cyan

    # Check if already set; respect --force / --rotate
    $existingRef = $null
    if (Test-Path "$projectDir/.env.local") {
        $line = (Get-Content "$projectDir/.env.local") | Where-Object { $_ -match "^$($cred.EnvVar)=" } | Select-Object -First 1
        if ($line) {
            $existingRef = $line -replace "^$($cred.EnvVar)=", ""
            if ($existingRef -and -not $Rotate -and -not $Force) {
                Write-Host "  Already set in .env.local. Use --rotate to overwrite, --list to inspect." -ForegroundColor DarkGray
                continue
            }
        }
    }

    # Read the credential value from stdin (echo suppressed)
    $secure = Read-Host -Prompt "  $($cred.Prompt)" -AsSecureString
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $value = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
    if (-not $value) {
        Write-Host "  ✗ No value entered; skipping." -ForegroundColor Red
        continue
    }

    # Validate (read-only pre-flight call) + account attestation
    $accountForAttestation = $null
    if ($cred.Validate_url) {
        Write-Host "  Validating credential via $($cred.Validate_url)..." -ForegroundColor DarkGray
        $headers = @{}
        if ($cred.Validate_auth -eq "bearer") {
            $headers["Authorization"] = "Bearer $value"
        }
        try {
            $resp = Invoke-RestMethod -Uri $cred.Validate_url -Headers $headers -Method GET -ErrorAction Stop
            # Extract the account field for attestation (supports dot-path like "user.username")
            $accountForAttestation = $resp
            foreach ($part in ($cred.Account_field -split "\.")) {
                $accountForAttestation = $accountForAttestation.$part
            }
            # If response was an array (e.g., Supabase /organizations returns [...])
            if ($accountForAttestation -is [System.Object[]] -and $accountForAttestation.Count -gt 0) {
                $first = $resp[0]
                foreach ($part in ($cred.Account_field -split "\.")) {
                    $first = $first.$part
                }
                $otherPlural = ''
                if (($resp.Count - 1) -gt 1) { $otherPlural = 's' }
                $accountForAttestation = "$first (and $($resp.Count - 1) other$otherPlural)"
            }
            Write-Host "  ✓ Credential is valid. Authenticated as: $accountForAttestation" -ForegroundColor Green
        } catch {
            Write-Host "  ✗ Validation failed: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host "    The credential may be wrong, expired, or the platform may be unreachable." -ForegroundColor DarkGray
            $value = $null
            continue
        }
    } else {
        Write-Host "  (no validation endpoint configured for this credential — accepting as-is)" -ForegroundColor DarkGray
    }

    # Account attestation — closes Ravenwise Root cause 4
    if ($accountForAttestation) {
        Write-Host ""
        Write-Host "  ATTESTATION REQUIRED" -ForegroundColor Yellow
        Write-Host "  This credential is authenticated as: " -NoNewline; Write-Host $accountForAttestation -ForegroundColor Cyan
        Write-Host "  Is this the intended account for this project? [y/N] " -NoNewline -ForegroundColor Yellow
        $confirm = Read-Host
        if ($confirm -notmatch "^[Yy]") {
            Write-Host "  ✗ Attestation declined. Credential discarded." -ForegroundColor Red
            $value = $null
            continue
        }
    }

    # Store
    if ($useKeyring) {
        # Pipe value to a small Node script that writes via keyring.mjs.
        # Value never appears in command args — only on stdin.
        $writeScript = @"
import('file:///$($repoRoot.Replace('\','/'))/scripts/lib/keyring.mjs').then(async (m) => {
  let value = '';
  for await (const chunk of process.stdin) value += chunk;
  await m.setCredential('$serviceKey', '$($cred.KeyringAccount)', value.trimEnd());
  process.stdout.write('STORED');
});
"@
        $write = $value | & $nodePath -e $writeScript 2>&1
        if ($write -ne "STORED") {
            Write-Host "  ✗ Keyring write failed: $write" -ForegroundColor Red
            $value = $null
            continue
        }
        $envValue = "keyring:$serviceKey/$($cred.KeyringAccount)"
        Write-Host "  ✓ Stored in OS keyring; .env.local reference: $envValue" -ForegroundColor Green
    } else {
        $envValue = $value
        Write-Host "  ✓ Will write literal value to .env.local (no keyring)" -ForegroundColor Yellow
    }

    # Update .env.local
    $envFile = "$projectDir/.env.local"
    if (-not (Test-Path $envFile)) {
        if (Test-Path "$projectDir/.env.example") {
            Copy-Item "$projectDir/.env.example" $envFile
        } else {
            New-Item -Path $envFile -ItemType File -Force | Out-Null
        }
    }
    $content = Get-Content $envFile -Raw
    if ($content -match "(?m)^$($cred.EnvVar)=.*$") {
        $newContent = $content -replace "(?m)^$($cred.EnvVar)=.*$", "$($cred.EnvVar)=$envValue"
    } else {
        $newContent = $content.TrimEnd() + "`n$($cred.EnvVar)=$envValue`n"
    }
    Set-Content -Path $envFile -Value $newContent -NoNewline -Encoding utf8

    # Scrub local copy
    $value = $null
}

Write-Host ""
Write-Host "Done. .env.local updated for platform '$Platform'." -ForegroundColor Green
Write-Host "Run again with --rotate to refresh a credential." -ForegroundColor DarkGray
