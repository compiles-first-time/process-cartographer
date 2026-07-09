#!/usr/bin/env bash
# Loom Observatory — launch script (POSIX)
# Usage: bash scripts/observatory.sh

set -euo pipefail

if ! command -v node &>/dev/null; then
  echo "error: Node.js is required but not found on PATH. Install Node 22+ and retry." >&2
  exit 1
fi

NODE_MAJOR=$(node -e 'console.log(process.versions.node.split(".")[0])')
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "error: Node $(node --version) found but Node 22+ is required." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

export LOOM_PROJECT_ROOT="$PROJECT_ROOT"
echo "[observatory] starting from $PROJECT_ROOT"

exec node "$PROJECT_ROOT/observatory/server.mjs"
