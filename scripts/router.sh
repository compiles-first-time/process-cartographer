#!/usr/bin/env bash
# Start / stop / check the Loom LLM router (LiteLLM proxy).
# Usage: scripts/router.sh [start|stop|status|logs]
#
# Requires Docker. The proxy exposes an OpenAI-compatible endpoint at
# http://localhost:4000 with three model aliases: loom-haiku, loom-sonnet,
# loom-opus. See tools/litellm/config.yaml for provider mapping.

set -euo pipefail

ACTION="${1:-start}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/../tools/litellm/docker-compose.yml"
PROXY_PORT="${LITELLM_PORT:-4000}"
PROXY_URL="http://localhost:$PROXY_PORT"

assert_docker() {
  if ! command -v docker &>/dev/null; then
    echo "[loom router] Docker not found. Install Docker or run LiteLLM directly:" >&2
    echo "  pip install litellm && litellm --config tools/litellm/config.yaml --port $PROXY_PORT" >&2
    exit 1
  fi
}

case "$ACTION" in
  start)
    assert_docker
    echo "[loom router] Starting LiteLLM proxy on port $PROXY_PORT..."
    docker compose -f "$COMPOSE_FILE" up -d
    echo ""
    echo "[loom router] Ready at $PROXY_URL"
    echo "[loom router] Models:  loom-haiku / loom-sonnet / loom-opus"
    echo "[loom router] Docs:    $PROXY_URL/docs"
    echo "[loom router] Health:  $PROXY_URL/health"
    ;;
  stop)
    assert_docker
    echo "[loom router] Stopping LiteLLM proxy..."
    docker compose -f "$COMPOSE_FILE" down
    ;;
  status)
    assert_docker
    docker compose -f "$COMPOSE_FILE" ps
    ;;
  logs)
    assert_docker
    docker compose -f "$COMPOSE_FILE" logs --follow litellm
    ;;
  *)
    echo "Unknown action: $ACTION. Use start, stop, status, or logs." >&2
    exit 1
    ;;
esac
