#!/usr/bin/env bash
# `loom update-bus tick` — POSIX shell wrapper around the Node stub.
# v0.2 no-op; v0.3 polls real feeds. See scripts/lib/update-bus-tick.mjs and
# adr/0016-update-bus-stub.md.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNNER="$ROOT/scripts/lib/update-bus-tick.mjs"

if [ ! -f "$RUNNER" ]; then
    echo "error: $RUNNER not found" >&2
    exit 2
fi

if ! command -v node >/dev/null 2>&1; then
    echo "error: node not on PATH (Loom v0.2 requires Node 22+)" >&2
    exit 2
fi

cd "$ROOT"
exec node "$RUNNER" "$@"
