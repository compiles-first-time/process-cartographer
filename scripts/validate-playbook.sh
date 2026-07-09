#!/usr/bin/env bash
# Loom playbook re-validation — POSIX shell.
#
# Per ADR-0035 §C layer 3. Spawns an agent-driven re-validation of a
# provisioning playbook against its cited vendor docs. The script assembles
# the right prompt with full context; the architect dispatches it to a
# Claude Code session (or directly to `claude` CLI if available).
#
# Usage:
#   bash scripts/validate-playbook.sh <platform>
#   bash scripts/validate-playbook.sh --all          (re-validate every playbook)
#   bash scripts/validate-playbook.sh supabase --dispatch    (auto-dispatch to claude CLI if installed)

set -uo pipefail

REPO_ROOT="$(pwd)"
PLAYBOOK_DIR="$REPO_ROOT/tools/provisioning-playbooks"
PLATFORM=""
DISPATCH=0
ALL=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dispatch) DISPATCH=1; shift ;;
        --all)      ALL=1; shift ;;
        -h|--help)
            echo "Usage: bash scripts/validate-playbook.sh <platform> [--dispatch]"
            echo "       bash scripts/validate-playbook.sh --all"
            exit 0
            ;;
        --*) echo "ERROR: unknown flag: $1" >&2; exit 1 ;;
        *) PLATFORM="$1"; shift ;;
    esac
done

if [[ ! -d "$PLAYBOOK_DIR" ]]; then
    echo "ERROR: no playbook directory at $PLAYBOOK_DIR" >&2
    exit 1
fi

# Resolve which playbooks to validate
if [[ $ALL -eq 1 ]]; then
    PLAYBOOKS=$(find "$PLAYBOOK_DIR" -maxdepth 1 -name "*.md" -not -name "README*")
else
    if [[ -z "$PLATFORM" ]]; then
        echo "ERROR: must specify a platform or --all"
        echo ""
        echo "Available playbooks:"
        find "$PLAYBOOK_DIR" -maxdepth 1 -name "*.md" -not -name "README*" -exec basename {} .md \; | sed 's/^/  - /'
        exit 1
    fi
    PB="$PLAYBOOK_DIR/${PLATFORM}.md"
    if [[ ! -f "$PB" ]]; then
        echo "ERROR: no playbook at $PB" >&2
        exit 1
    fi
    PLAYBOOKS="$PB"
fi

for PB in $PLAYBOOKS; do
    PLATFORM_NAME=$(basename "$PB" .md)
    echo "═══════════════════════════════════════════════════════════════"
    echo "  Re-validating: $PLATFORM_NAME"
    echo "═══════════════════════════════════════════════════════════════"

    # Extract cited vendor URLs (canonical-docs section + inline links)
    DOCS_SECTION=$(sed -n '/^## Vendor canonical docs/,/^## /p' "$PB" | head -n -1)
    URLS=$(grep -oE 'https?://[^)[:space:]]+' <<<"$DOCS_SECTION" | sort -u)

    # Assemble the agent prompt
    PROMPT_FILE=$(mktemp)
    cat > "$PROMPT_FILE" <<EOF
Mission: re-validate the Loom provisioning playbook for $PLATFORM_NAME against current vendor docs.

You are acting as the provisioning specialist via ADR-0034 path 2b (use the SKILL.md content as your prompt). Read:

1. $PB (the playbook to re-validate)
2. ${REPO_ROOT}/agents/specialists/_registry/provisioning/SKILL.md (your specialist discipline)
3. Each of the cited vendor URLs below; compare against the playbook content + report discrepancies.

Cited vendor URLs to re-check:
$URLS

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
EOF

    echo ""
    echo "Prompt written to: $PROMPT_FILE"
    echo ""

    if [[ $DISPATCH -eq 1 ]] && command -v claude >/dev/null 2>&1; then
        echo "Dispatching to claude CLI..."
        echo ""
        claude --print < "$PROMPT_FILE"
    else
        echo "To run this validation:"
        echo "  - Open the prompt: cat $PROMPT_FILE"
        echo "  - Paste into a Claude Code session OR run: claude --print < $PROMPT_FILE"
        echo "  - When done, delete the prompt file: rm $PROMPT_FILE"
        echo ""
        echo "Or re-run with --dispatch to auto-pipe (if claude CLI is installed)."
    fi
    echo ""
done
