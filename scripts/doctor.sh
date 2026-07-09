#!/usr/bin/env bash
# `loom doctor` — POSIX shell wrapper around the Node checker.
# See scripts/lib/doctor.mjs and adr/0015-loom-doctor.md.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECKER="$ROOT/scripts/lib/doctor.mjs"

if [ ! -f "$CHECKER" ]; then
    echo "error: $CHECKER not found" >&2
    exit 2
fi

if ! command -v node >/dev/null 2>&1; then
    echo "error: node not on PATH (Loom v0.2 requires Node 22+)" >&2
    exit 2
fi

cd "$ROOT"
echo "loom doctor — checking project at $ROOT"
echo ""
exec node "$CHECKER" "$@"
