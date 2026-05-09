#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-_}"
UPSTREAM_HOST="${UPSTREAM_HOST:-127.0.0.1}"
UPSTREAM_PORT="${UPSTREAM_PORT:-8080}"
SITE_NAME="${SITE_NAME:-lindrop}"
EMAIL="${EMAIL:-}"
ENABLE_SSL="${ENABLE_SSL:-auto}"
CLIENT_MAX_BODY_SIZE="${CLIENT_MAX_BODY_SIZE:-16m}"

if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
else
  SUDO=""
fi

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing command: $1"
    exit 1
  fi
}

install_nginx() {
  if command -v nginx >/dev/null 2>&1; then
    return
  fi

  if command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update
    $SUDO apt-get install -y nginx
    return
  fi

  if command -v dnf >/dev/null 2>&1; then
    $SUDO dnf install -y nginx
    return
  fi

  if command -v yum >/dev/null 2>&1; then
    $SUDO yum install -y nginx
    return
  fi

  echo "Unsupported system: please install nginx first."
  exit 1
}

install_certbot() {
  if command -v certbot >/dev/null 2>&1; then
    return
  fi

  if command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update
    $SUDO apt-get install -y certbot python3-certbot-nginx
    return
  fi

  if command -v dnf >/dev/null 2>&1; then
    $SUDO dnf install -y certbot python3-certbot-nginx
    return
  fi

  if command -v yum >/dev/null 2>&1; then
    $SUDO yum install -y certbot python3-certbot-nginx
    return
  fi

  echo "Unsupported system: please install certbot first."
  exit 1
}

write_site() {
  local available_dir="/etc/nginx/sites-available"
  local enabled_dir="/etc/nginx/sites-enabled"
  local site_path="$available_dir/$SITE_NAME"
  local server_name="$DOMAIN"

  if [ "$DOMAIN" = "_" ]; then
    server_name="_"
  fi

  if [ -d "$available_dir" ]; then
    $SUDO tee "$site_path" >/dev/null <<NGINX
server {
  listen 80;
  listen [::]:80;
  server_name $server_name;

  client_max_body_size $CLIENT_MAX_BODY_SIZE;

  location / {
    proxy_pass http://$UPSTREAM_HOST:$UPSTREAM_PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
  }
}
NGINX
    $SUDO ln -sfn "$site_path" "$enabled_dir/$SITE_NAME"
  else
    $SUDO tee "/etc/nginx/conf.d/$SITE_NAME.conf" >/dev/null <<NGINX
server {
  listen 80;
  listen [::]:80;
  server_name $server_name;

  client_max_body_size $CLIENT_MAX_BODY_SIZE;

  location / {
    proxy_pass http://$UPSTREAM_HOST:$UPSTREAM_PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
  }
}
NGINX
  fi
}

should_enable_ssl() {
  if [ "$ENABLE_SSL" = "true" ]; then
    return 0
  fi

  if [ "$ENABLE_SSL" = "false" ]; then
    return 1
  fi

  [ "$DOMAIN" != "_" ] && [ -n "$EMAIL" ]
}

install_nginx
write_site

$SUDO nginx -t
$SUDO systemctl enable nginx >/dev/null 2>&1 || true
$SUDO systemctl reload nginx || $SUDO systemctl restart nginx

if should_enable_ssl; then
  if [ "$DOMAIN" = "_" ]; then
    echo "ENABLE_SSL is true, but DOMAIN is not set."
    exit 1
  fi

  if [ -z "$EMAIL" ]; then
    echo "ENABLE_SSL is true, but EMAIL is not set."
    exit 1
  fi

  install_certbot
  $SUDO certbot --nginx \
    --non-interactive \
    --agree-tos \
    --redirect \
    --email "$EMAIL" \
    -d "$DOMAIN"
fi

echo "Nginx is proxying http://$DOMAIN to http://$UPSTREAM_HOST:$UPSTREAM_PORT."
if should_enable_ssl; then
  echo "HTTPS is enabled for https://$DOMAIN."
else
  echo "HTTPS was not enabled. Set DOMAIN=your-domain EMAIL=you@example.com to enable Let's Encrypt automatically."
fi
