#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/lindrop}"
REPO_URL="${REPO_URL:-https://github.com/Louing00/lan_transfer.git}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-8080}"
RELAY_ADMIN_PASSWORD="${RELAY_ADMIN_PASSWORD:-}"
RELAY_FILE_TTL_MS="${RELAY_FILE_TTL_MS:-7200000}"
RELAY_MAX_FILE_BYTES="${RELAY_MAX_FILE_BYTES:-1073741824}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing command: $1"
    exit 1
  fi
}

need_cmd git
need_cmd docker

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  echo "Missing docker compose. Install Docker Compose v2 first."
  exit 1
fi

if [ ! -d "$APP_DIR/.git" ]; then
  sudo mkdir -p "$APP_DIR"
  sudo chown "$USER":"$USER" "$APP_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
fi

cat > "$APP_DIR/.env" <<ENV
PORT=$PORT
ROOM_TTL_MS=7200000
RELAY_ADMIN_PASSWORD=$RELAY_ADMIN_PASSWORD
RELAY_FILE_TTL_MS=$RELAY_FILE_TTL_MS
RELAY_MAX_FILE_BYTES=$RELAY_MAX_FILE_BYTES
ENV

cd "$APP_DIR"
"${COMPOSE[@]}" up -d --build

echo "Lindrop is running on port $PORT."
if [ -n "$RELAY_ADMIN_PASSWORD" ]; then
  echo "Server relay mode is enabled."
else
  echo "Server relay mode is disabled. Set RELAY_ADMIN_PASSWORD to enable it."
fi
echo "For WebRTC on public domains, put HTTPS in front of this service with Nginx or Caddy."
