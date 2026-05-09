#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/lindrop}"
REPO_URL="${REPO_URL:-https://github.com/Louing00/lan_transfer.git}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-8080}"

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
ENV

cd "$APP_DIR"
"${COMPOSE[@]}" up -d --build

echo "Lindrop is running on port $PORT."
echo "For WebRTC on public domains, put HTTPS in front of this service with Nginx or Caddy."
