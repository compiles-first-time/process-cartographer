#!/usr/bin/env bash
# `loom secrets-doctor` — POSIX shell wrapper.
# See scripts/lib/secrets-doctor.mjs and adr/0018-secrets-handling.md.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECKER="$ROOT/scripts/lib/secrets-doctor.mjs"

if [ ! -f "$CHECKER" ]; then
    echo "error: $CHECKER not found" >&2
    exit 2
fi

if ! command -v node >/dev/null 2>&1; then
    echo "error: node not on PATH (Loom v0.2+ requires Node 22+)" >&2
    exit 2
fi

cd "$ROOT"
exec node "$CHECKER" "$@"
