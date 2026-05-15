#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

export AGENT_HOME="${AGENT_HOME:-$ROOT_DIR}"
export BOT_DB_PATH="${BOT_DB_PATH:-$ROOT_DIR/bot.db}"
export BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
export BACKEND_PORT="${BACKEND_PORT:-4000}"
export BACKEND_URL="${BACKEND_URL:-http://$BACKEND_HOST:$BACKEND_PORT}"
export MCP_HOST="${MCP_HOST:-127.0.0.1}"
export MCP_PORT="${MCP_PORT:-4100}"
export MCP_URL="${MCP_URL:-http://$MCP_HOST:$MCP_PORT}"
export CHROMA_HOST="${CHROMA_HOST:-127.0.0.1}"
export CHROMA_PORT="${CHROMA_PORT:-8000}"

ADMIN_HOST="${ADMIN_HOST:-127.0.0.1}"
ADMIN_PORT="${ADMIN_PORT:-3000}"
CHROMA_CONTAINER="${CHROMA_CONTAINER:-alshival-chroma}"

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi

  if [[ -n "${ADMIN_PID:-}" ]]; then
    kill "$ADMIN_PID" 2>/dev/null || true
  fi

  if [[ -n "${MCP_PID:-}" ]]; then
    kill "$MCP_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

if command -v docker >/dev/null 2>&1; then
  mkdir -p "$ROOT_DIR/chroma"
  if ! docker ps --format '{{.Names}}' | grep -qx "$CHROMA_CONTAINER"; then
    if docker ps -a --format '{{.Names}}' | grep -qx "$CHROMA_CONTAINER"; then
      echo "Starting ChromaDB container $CHROMA_CONTAINER on http://$CHROMA_HOST:$CHROMA_PORT"
      docker start "$CHROMA_CONTAINER" >/dev/null
    else
      echo "Creating ChromaDB container $CHROMA_CONTAINER on http://$CHROMA_HOST:$CHROMA_PORT"
      docker run -d \
        --name "$CHROMA_CONTAINER" \
        -p "$CHROMA_HOST:$CHROMA_PORT:8000" \
        -v "$ROOT_DIR/chroma:/data" \
        chromadb/chroma >/dev/null
    fi
  fi
else
  echo "Docker is not available; ChromaDB must be running at http://$CHROMA_HOST:$CHROMA_PORT"
fi

echo "Starting Alshival MCP on http://$MCP_HOST:$MCP_PORT"
(
  cd "$ROOT_DIR"
  python3 mcp/server.py
) &
MCP_PID=$!

echo "Starting Alshival backend on http://$BACKEND_HOST:$BACKEND_PORT"
(
  cd "$ROOT_DIR/backend"
  npm run start
) &
BACKEND_PID=$!

echo "Starting Alshival admin on http://$ADMIN_HOST:$ADMIN_PORT"
(
  cd "$ROOT_DIR/admin"
  npm run dev -- --hostname "$ADMIN_HOST" --port "$ADMIN_PORT"
) &
ADMIN_PID=$!

wait -n "$MCP_PID" "$BACKEND_PID" "$ADMIN_PID"
