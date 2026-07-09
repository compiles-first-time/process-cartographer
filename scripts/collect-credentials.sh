#!/usr/bin/env bash
# Loom credential collection — POSIX shell.
#
# Per ADR-0036: collects platform PATs via terminal stdin (NEVER through chat),
# validates them via read-only pre-flight calls (account-attestation closes
# Ravenwise Root cause 4), stores via @napi-rs/keyring, writes
# `keyring:<service>/<account>` references to .env.local. Falls back to literal
# .env.local storage if keyring is unavailable.
#
# Usage:
#   bash scripts/collect-credentials.sh <platform>
#   bash scripts/collect-credentials.sh supabase
#   bash scripts/collect-credentials.sh --rotate supabase
#   bash scripts/collect-credentials.sh --list
#   bash scripts/collect-credentials.sh --project-dir src supabase
#
# Sister script for Windows / PowerShell: scripts/collect-credentials.ps1

set -uo pipefail

REPO_ROOT="$(pwd)"
NODE="${NODE:-node}"
if ! command -v "$NODE" >/dev/null 2>&1; then
    echo "ERROR: node not found on PATH. Install Node 22+ first." >&2
    exit 1
fi

ROTATE=0
FORCE=0
LIST=0
NO_KEYRING=0
PLATFORM=""
PROJECT_DIR=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --rotate)       ROTATE=1; shift ;;
        --force)        FORCE=1; shift ;;
        --list)         LIST=1; shift ;;
        --no-keyring)   NO_KEYRING=1; shift ;;
        --project-dir)  PROJECT_DIR="$2"; shift 2 ;;
        -h|--help)
            sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        --*)
            echo "ERROR: unknown flag: $1" >&2
            exit 1
            ;;
        *)
            PLATFORM="$1"; shift
            ;;
    esac
done

# Resolve project dir (for .env.local / node_modules in a subdir like src/).
PROJECT_DIR="${PROJECT_DIR:-$REPO_ROOT}"
export LOOM_KEYRING_PROJECT_DIR="$PROJECT_DIR"  # tells keyring.mjs where to resolve @napi-rs/keyring

# ── Platform registry ───────────────────────────────────────────────────
# Format per platform (newline-separated rows):
#   description|setup_url|setup_hint
#   credentials: ENV_VAR|keyring-account|prompt|validate_url|account_field

platform_supabase() {
    cat <<'EOF'
DESC=Supabase (Postgres + Auth + Storage)
SETUP_URL=https://supabase.com/dashboard/account/tokens
SETUP_HINT=Generate a Personal Access Token (PAT) at the URL above. Scope: leave default (full account).
CRED=SUPABASE_PAT|supabase-pat|Paste your Supabase PAT (input hidden)|https://api.supabase.com/v1/organizations|name
EOF
}

platform_github() {
    cat <<'EOF'
DESC=GitHub (repos, issues, PRs)
SETUP_URL=https://github.com/settings/tokens
SETUP_HINT=Generate a Personal Access Token (classic OR fine-grained). Minimal scopes: repo, read:user.
CRED=GITHUB_PERSONAL_ACCESS_TOKEN|github-pat|Paste your GitHub PAT (input hidden)|https://api.github.com/user|login
EOF
}

platform_vercel() {
    cat <<'EOF'
DESC=Vercel (deploys + env vars)
SETUP_URL=https://vercel.com/account/tokens
SETUP_HINT=Generate an access token. Scope: full access OR per-project.
CRED=VERCEL_TOKEN|vercel-token|Paste your Vercel access token (input hidden)|https://api.vercel.com/v2/user|user.username
EOF
}

platform_anthropic() {
    cat <<'EOF'
DESC=Anthropic API (Claude)
SETUP_URL=https://console.anthropic.com/settings/keys
SETUP_HINT=Generate an API key. Scope: as needed for your project.
CRED=ANTHROPIC_API_KEY|anthropic-api-key|Paste your Anthropic API key (input hidden)||
EOF
}

platform_alpaca() {
    cat <<'EOF'
DESC=Alpaca (paper-trading brokerage)
SETUP_URL=https://app.alpaca.markets/signup
SETUP_HINT=Sign up (or log in), open the Paper Trading dashboard, generate API keys. Secret shown ONCE - copy it now. The credential-setup specialist (ADR-0042) can drive this in the browser with your consent.
CUSTOM=alpaca
EOF
}

# Alpaca uses two headers (APCA-API-KEY-ID / APCA-API-SECRET-KEY) validated as a
# PAIR against GET /v2/account. We collect both, validate together, attest the
# account, and only THEN store - so a wrong/swapped key is never written. ADR-0042 F.
_alpaca_store() {
    local env_var="$1" account="$2" value="$3" env_file="$4" env_value
    if [[ $USE_KEYRING -eq 1 ]]; then
        local store_result
        store_result=$(printf '%s' "$value" | "$NODE" -e "
import('file://$REPO_ROOT/scripts/lib/keyring.mjs').then(async (m) => {
  let v=''; for await (const c of process.stdin) v+=c;
  await m.setCredential('$SERVICE_KEY', '$account', v);
  process.stdout.write('STORED');
}).catch((e)=>process.stdout.write('FAIL: '+e.message));
" 2>/dev/null)
        if [[ "$store_result" != "STORED" ]]; then
            echo "  x Keyring write failed for $env_var: $store_result"
            return
        fi
        env_value="keyring:$SERVICE_KEY/$account"
        echo "  + $env_var stored in OS keyring; reference: $env_value"
    else
        env_value="$value"
        echo "  + $env_var will be written literally to .env.local (no keyring)"
    fi
    if [[ ! -f "$env_file" ]]; then
        if [[ -f "$REPO_ROOT/.env.example" ]]; then cp "$REPO_ROOT/.env.example" "$env_file"; else touch "$env_file"; fi
    fi
    if grep -qE "^${env_var}=" "$env_file"; then
        local tmp; tmp=$(mktemp)
        sed "s|^${env_var}=.*|${env_var}=${env_value}|" "$env_file" > "$tmp"
        mv "$tmp" "$env_file"
    else
        echo "${env_var}=${env_value}" >> "$env_file"
    fi
}

collect_alpaca() {
    local env_file="$PROJECT_DIR/.env.local"
    local validate_url="https://paper-api.alpaca.markets/v2/account"

    if [[ -f "$env_file" && $ROTATE -eq 0 && $FORCE -eq 0 ]]; then
        if grep -qE '^ALPACA_KEY_ID=.' "$env_file" && grep -qE '^ALPACA_SECRET_KEY=.' "$env_file"; then
            echo "  Alpaca keys already set in .env.local. Use --rotate to overwrite, --list to inspect."
            return
        fi
    fi

    echo "-> ALPACA_KEY_ID + ALPACA_SECRET_KEY (validated together)"
    printf "  Paste your Alpaca API Key ID (input hidden): "
    if [[ -t 0 ]]; then stty -echo 2>/dev/null; IFS= read -r KEY_ID; stty echo 2>/dev/null; echo ""; else IFS= read -r KEY_ID; fi
    printf "  Paste your Alpaca API Secret Key (input hidden): "
    if [[ -t 0 ]]; then stty -echo 2>/dev/null; IFS= read -r SECRET; stty echo 2>/dev/null; echo ""; else IFS= read -r SECRET; fi
    if [[ -z "$KEY_ID" || -z "$SECRET" ]]; then
        echo "  x Both Key ID and Secret are required; nothing stored."
        KEY_ID=""; SECRET=""; return
    fi

    echo "  Validating key pair via $validate_url..."
    local http_code
    http_code=$(curl -s -o /tmp/loom-alpaca-resp.json -w "%{http_code}" \
        -H "APCA-API-KEY-ID: $KEY_ID" -H "APCA-API-SECRET-KEY: $SECRET" \
        "$validate_url" 2>/dev/null || echo "000")
    if [[ "$http_code" != "200" ]]; then
        echo "  x Validation failed (HTTP $http_code). Keys may be wrong, swapped, or revoked. Nothing stored. (CRED-EX-08)"
        rm -f /tmp/loom-alpaca-resp.json
        KEY_ID=""; SECRET=""; return
    fi
    local acct acct_num acct_status
    acct=$("$NODE" -e "
const fs=require('node:fs');
const d=JSON.parse(fs.readFileSync('/tmp/loom-alpaca-resp.json','utf8'));
process.stdout.write(String(d.account_number ?? '<unknown>')+'|'+String(d.status ?? '<unknown>'));
" 2>/dev/null)
    rm -f /tmp/loom-alpaca-resp.json
    acct_num="${acct%%|*}"; acct_status="${acct##*|}"
    echo "  + Key pair valid. Paper account: $acct_num  Status: $acct_status"
    echo ""
    echo "  ATTESTATION REQUIRED"
    echo "  These keys authenticate Alpaca paper account: $acct_num ($acct_status)"
    printf "  Is this the intended account for this project? [y/N] "
    read -r CONFIRM
    if [[ ! "$CONFIRM" =~ ^[Yy] ]]; then
        echo "  x Attestation declined. Keys discarded (nothing stored)."
        KEY_ID=""; SECRET=""; return
    fi

    _alpaca_store "ALPACA_KEY_ID" "alpaca-key-id" "$KEY_ID" "$env_file"
    _alpaca_store "ALPACA_SECRET_KEY" "alpaca-secret-key" "$SECRET" "$env_file"
    KEY_ID=""; SECRET=""
}

list_platforms() {
    echo ""
    echo "Supported platforms (extend in scripts/collect-credentials.sh):"
    echo "  supabase    Supabase (Postgres + Auth + Storage)"
    echo "  github      GitHub (repos, issues, PRs)"
    echo "  vercel      Vercel (deploys + env vars)"
    echo "  anthropic   Anthropic API (Claude)"
    echo "  alpaca      Alpaca (paper-trading brokerage)"
    echo ""
    echo "Usage: bash scripts/collect-credentials.sh <platform>"
}

if [[ -z "$PLATFORM" && $LIST -eq 0 ]]; then
    list_platforms
    exit 0
fi

# ── Keyring availability check ──────────────────────────────────────────

check_keyring() {
    "$NODE" -e "
import('file://$REPO_ROOT/scripts/lib/keyring.mjs').then(async (m) => {
  const ok = await m.isKeyringAvailable();
  process.stdout.write(ok ? 'AVAILABLE' : 'UNAVAILABLE');
}).catch(() => process.stdout.write('UNAVAILABLE'));
" 2>/dev/null
}

USE_KEYRING=1
if [[ $NO_KEYRING -eq 1 ]]; then
    USE_KEYRING=0
fi
if [[ $USE_KEYRING -eq 1 ]]; then
    AVAIL=$(check_keyring)
    if [[ "$AVAIL" != "AVAILABLE" ]]; then
        echo ""
        echo "OS keyring not available (or @napi-rs/keyring not installed)."
        echo "  Install:  npm install --save-optional @napi-rs/keyring"
        echo "  Falling back to literal .env.local storage for this run."
        echo ""
        USE_KEYRING=0
    fi
fi

# Get service key from project (per ADR-0036 §G)
get_service_key() {
    "$NODE" -e "
import('file://$REPO_ROOT/scripts/lib/keyring.mjs').then(async (m) => {
  const svc = await m.getServiceKey('$PROJECT_DIR');
  process.stdout.write(svc);
});
" 2>/dev/null
}

if [[ $LIST -eq 1 ]]; then
    echo ""
    if [[ $USE_KEYRING -eq 0 ]]; then
        echo "Keyring unavailable; cannot list stored credentials."
        exit 1
    fi
    SVC=$(get_service_key)
    echo "Service key: $SVC"
    echo ""
    echo "Stored credentials (via .env.local keyring: references):"
    if [[ -f "$PROJECT_DIR/.env.local" ]]; then
        grep -oE '^[A-Z_]+=keyring:' "$PROJECT_DIR/.env.local" | sed 's/=keyring:$//' | sed 's/^/  - /' || echo "  (none)"
    else
        echo "  (no .env.local found)"
    fi
    exit 0
fi

# ── Platform lookup ─────────────────────────────────────────────────────

case "$PLATFORM" in
    supabase|github|vercel|anthropic|alpaca) ;;
    *)
        echo "ERROR: unknown platform: $PLATFORM" >&2
        list_platforms
        exit 1
        ;;
esac

PLATFORM_DATA=$("platform_$PLATFORM")
DESC=$(echo "$PLATFORM_DATA" | grep '^DESC=' | sed 's/^DESC=//')
SETUP_URL=$(echo "$PLATFORM_DATA" | grep '^SETUP_URL=' | sed 's/^SETUP_URL=//')
SETUP_HINT=$(echo "$PLATFORM_DATA" | grep '^SETUP_HINT=' | sed 's/^SETUP_HINT=//')

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  $DESC"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Setup (one-time):"
echo "  $SETUP_HINT"
echo "  URL: $SETUP_URL"
echo ""

SERVICE_KEY=""
if [[ $USE_KEYRING -eq 1 ]]; then
    SERVICE_KEY=$(get_service_key)
    echo "Storage: OS keyring, service '$SERVICE_KEY'"
else
    echo "Storage: literal .env.local (no keyring)"
fi
echo ""

# ── Collect each credential ────────────────────────────────────────────

ENV_FILE="$PROJECT_DIR/.env.local"

# Custom collectors (platforms needing paired / combined validation)
if [[ "$PLATFORM" == "alpaca" ]]; then
    collect_alpaca
    echo ""
    echo "Done. .env.local updated for platform '$PLATFORM'."
    echo "Run again with --rotate to refresh a credential."
    exit 0
fi

# Iterate CRED lines from the platform data
echo "$PLATFORM_DATA" | grep '^CRED=' | sed 's/^CRED=//' | while IFS='|' read -r ENV_VAR KEYRING_ACCOUNT PROMPT VALIDATE_URL ACCOUNT_FIELD; do
    echo ""
    echo "→ $ENV_VAR"

    # Check existing
    if [[ -f "$ENV_FILE" ]]; then
        EXISTING=$(grep -E "^${ENV_VAR}=" "$ENV_FILE" || true)
        if [[ -n "$EXISTING" && $ROTATE -eq 0 && $FORCE -eq 0 ]]; then
            VALUE_TAIL="${EXISTING#${ENV_VAR}=}"
            if [[ -n "$VALUE_TAIL" ]]; then
                echo "  Already set in .env.local. Use --rotate to overwrite, --list to inspect."
                continue
            fi
        fi
    fi

    # Read with echo off
    printf "  %s: " "$PROMPT"
    if [[ -t 0 ]]; then
        stty -echo 2>/dev/null
        IFS= read -r VALUE
        stty echo 2>/dev/null
        echo ""
    else
        IFS= read -r VALUE
    fi
    if [[ -z "$VALUE" ]]; then
        echo "  ✗ No value entered; skipping."
        continue
    fi

    # Validate
    ACCOUNT_DISPLAY=""
    if [[ -n "$VALIDATE_URL" ]]; then
        echo "  Validating credential via $VALIDATE_URL..."
        HTTP_CODE=$(curl -s -o /tmp/loom-validate-resp.json -w "%{http_code}" \
            -H "Authorization: Bearer $VALUE" \
            "$VALIDATE_URL" 2>/dev/null || echo "000")
        if [[ "$HTTP_CODE" != "200" && "$HTTP_CODE" != "201" ]]; then
            echo "  ✗ Validation failed (HTTP $HTTP_CODE). Credential may be wrong/expired/unreachable."
            rm -f /tmp/loom-validate-resp.json
            VALUE=""
            continue
        fi
        # Extract the attestation field via node (jq isn't reliably available)
        if [[ -n "$ACCOUNT_FIELD" ]]; then
            ACCOUNT_DISPLAY=$("$NODE" -e "
const fs = require('node:fs');
const data = JSON.parse(fs.readFileSync('/tmp/loom-validate-resp.json', 'utf8'));
const path = '$ACCOUNT_FIELD'.split('.');
let v = Array.isArray(data) ? data[0] : data;
for (const p of path) v = v?.[p];
process.stdout.write(String(v ?? '<unknown>'));
if (Array.isArray(data) && data.length > 1) process.stdout.write(' (and ' + (data.length - 1) + ' more)');
" 2>/dev/null)
            echo "  ✓ Credential valid. Authenticated as: $ACCOUNT_DISPLAY"
        else
            echo "  ✓ Credential valid."
        fi
        rm -f /tmp/loom-validate-resp.json
    else
        echo "  (no validation endpoint — accepting as-is)"
    fi

    # Attestation — closes Ravenwise Root cause 4
    if [[ -n "$ACCOUNT_DISPLAY" ]]; then
        echo ""
        echo "  ATTESTATION REQUIRED"
        echo "  This credential is authenticated as: $ACCOUNT_DISPLAY"
        printf "  Is this the intended account for this project? [y/N] "
        read -r CONFIRM
        if [[ ! "$CONFIRM" =~ ^[Yy] ]]; then
            echo "  ✗ Attestation declined. Credential discarded."
            VALUE=""
            continue
        fi
    fi

    # Store
    if [[ $USE_KEYRING -eq 1 ]]; then
        STORE_RESULT=$(printf '%s' "$VALUE" | "$NODE" -e "
import('file://$REPO_ROOT/scripts/lib/keyring.mjs').then(async (m) => {
  let value = '';
  for await (const chunk of process.stdin) value += chunk;
  await m.setCredential('$SERVICE_KEY', '$KEYRING_ACCOUNT', value);
  process.stdout.write('STORED');
}).catch((e) => process.stdout.write('FAIL: ' + e.message));
" 2>/dev/null)
        if [[ "$STORE_RESULT" != "STORED" ]]; then
            echo "  ✗ Keyring write failed: $STORE_RESULT"
            VALUE=""
            continue
        fi
        ENV_VALUE="keyring:$SERVICE_KEY/$KEYRING_ACCOUNT"
        echo "  ✓ Stored in OS keyring; .env.local reference: $ENV_VALUE"
    else
        ENV_VALUE="$VALUE"
        echo "  ✓ Will write literal value to .env.local (no keyring)"
    fi

    # Update .env.local
    if [[ ! -f "$ENV_FILE" ]]; then
        if [[ -f "$PROJECT_DIR/.env.example" ]]; then
            cp "$PROJECT_DIR/.env.example" "$ENV_FILE"
        else
            touch "$ENV_FILE"
        fi
    fi
    if grep -qE "^${ENV_VAR}=" "$ENV_FILE"; then
        # Replace in-place (portable POSIX: use sed -i in temp dance)
        TMP_FILE=$(mktemp)
        sed "s|^${ENV_VAR}=.*|${ENV_VAR}=${ENV_VALUE}|" "$ENV_FILE" > "$TMP_FILE"
        mv "$TMP_FILE" "$ENV_FILE"
    else
        echo "${ENV_VAR}=${ENV_VALUE}" >> "$ENV_FILE"
    fi

    # Scrub local
    VALUE=""
done

echo ""
echo "Done. .env.local updated for platform '$PLATFORM'."
echo "Run again with --rotate to refresh a credential."
