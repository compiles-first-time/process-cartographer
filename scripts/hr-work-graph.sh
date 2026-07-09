#!/usr/bin/env bash
# `loom hr-work-graph` — POSIX shell wrapper.
# See scripts/lib/hr-work-graph.mjs and adr/0029-hr-work-graph.md.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNNER="$ROOT/scripts/lib/hr-work-graph.mjs"

if [ ! -f "$RUNNER" ]; then
    echo "error: $RUNNER not found" >&2
    exit 2
fi

if ! command -v node >/dev/null 2>&1; then
    echo "error: node not on PATH (Loom v0.2+ requires Node 22+)" >&2
    exit 2
fi

cd "$ROOT"
exec node "$RUNNER" "$@"
