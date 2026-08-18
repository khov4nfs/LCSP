#!/usr/bin/env bash
set -Eeuo pipefail

LAUNCHER_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
BASE_DIR="$(cd -- "$LAUNCHER_DIR/.." && pwd)"
COMMON_DIR="$BASE_DIR/common"
DEV_CONFIG="$BASE_DIR/.fogewise-dev.local"
PROD_CONFIG="$BASE_DIR/.fogewise-production.local"
CADDY_FILE="$COMMON_DIR/Caddyfile.production"
CADDY_ADMIN="127.0.0.1:20192"

CADDY_PID=""

step() {
  printf '\n\033[1;36m==> %s\033[0m\n' "$1"
}

fail() {
  printf '\n\033[1;31m[Fogewise] ERROR: %s\033[0m\n' "$1" >&2
  exit 1
}

resolve_project_root() {
  if command -v git >/dev/null 2>&1; then
    local git_root
    git_root="$(git -C "$BASE_DIR" rev-parse --show-toplevel 2>/dev/null || true)"

    if [ -n "$git_root" ]; then
      printf '%s\n' "$git_root"
      return
    fi
  fi

  dirname "$BASE_DIR"
}

sanitize_slug() {
  printf '%s' "$1" |
    tr '[:upper:]' '[:lower:]' |
    sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-+/-/g'
}

PROJECT_ROOT="$(resolve_project_root)"
DEFAULT_SUBDOMAIN="$(basename "$PROJECT_ROOT" | tr '[:upper:]' '[:lower:]')"

FOGEWISE_SUBDOMAIN="$DEFAULT_SUBDOMAIN"
FOGEWISE_WEB_PORT="3000"
FOGEWISE_API_PORT="4000"

if [ -f "$DEV_CONFIG" ]; then
  while IFS='=' read -r key value; do
    case "$key" in
      FOGEWISE_SUBDOMAIN) FOGEWISE_SUBDOMAIN="$value" ;;
      FOGEWISE_WEB_PORT) FOGEWISE_WEB_PORT="$value" ;;
      FOGEWISE_API_PORT) FOGEWISE_API_PORT="$value" ;;
    esac
  done < "$DEV_CONFIG"
fi

DEFAULT_DEV_SLUG=""
if command -v git >/dev/null 2>&1; then
  DEFAULT_DEV_SLUG="$(git -C "$PROJECT_ROOT" config user.name 2>/dev/null || true)"
fi

DEFAULT_DEV_SLUG="$(sanitize_slug "${DEFAULT_DEV_SLUG:-${USER:-developer}}")"
[ -n "$DEFAULT_DEV_SLUG" ] || DEFAULT_DEV_SLUG="developer"

FOGEWISE_DEV_SLUG="$DEFAULT_DEV_SLUG"
FOGEWISE_SHARE_PORT="18080"
FOGEWISE_PREVIEW_HOST=""
FOGEWISE_TUNNEL_TOKEN="${FOGEWISE_TUNNEL_TOKEN:-}"

if [ -f "$PROD_CONFIG" ]; then
  while IFS='=' read -r key value; do
    case "$key" in
      FOGEWISE_DEV_SLUG) FOGEWISE_DEV_SLUG="$value" ;;
      FOGEWISE_SHARE_PORT) FOGEWISE_SHARE_PORT="$value" ;;
      FOGEWISE_PREVIEW_HOST) FOGEWISE_PREVIEW_HOST="$value" ;;
      FOGEWISE_TUNNEL_TOKEN)
        if [ -z "$FOGEWISE_TUNNEL_TOKEN" ]; then
          FOGEWISE_TUNNEL_TOKEN="$value"
        fi
        ;;
    esac
  done < "$PROD_CONFIG"
fi

FOGEWISE_DEV_SLUG="$(sanitize_slug "$FOGEWISE_DEV_SLUG")"
[ -n "$FOGEWISE_DEV_SLUG" ] || fail "Invalid developer slug."

if [ -z "$FOGEWISE_PREVIEW_HOST" ]; then
  FOGEWISE_PREVIEW_HOST="${FOGEWISE_SUBDOMAIN}-${FOGEWISE_DEV_SLUG}.fogewise.io.vn"
fi

printf '%s' "$FOGEWISE_PREVIEW_HOST" |
  grep -Eq '^[a-z0-9.-]+$' ||
  fail "Invalid preview hostname: $FOGEWISE_PREVIEW_HOST"

[[ "$FOGEWISE_SHARE_PORT" =~ ^[0-9]{2,5}$ ]] ||
  fail "Invalid share port: $FOGEWISE_SHARE_PORT"

write_default_prod_config_if_missing() {
  if [ -f "$PROD_CONFIG" ]; then
    chmod 600 "$PROD_CONFIG" 2>/dev/null || true
    return
  fi

  cat > "$PROD_CONFIG" <<EOF
FOGEWISE_DEV_SLUG=$FOGEWISE_DEV_SLUG
FOGEWISE_SHARE_PORT=$FOGEWISE_SHARE_PORT
FOGEWISE_PREVIEW_HOST=$FOGEWISE_PREVIEW_HOST
FOGEWISE_TUNNEL_TOKEN=
EOF

  chmod 600 "$PROD_CONFIG"
}

exclude_local_files() {
  if [ ! -d "$PROJECT_ROOT/.git/info" ]; then
    return
  fi

  touch "$PROJECT_ROOT/.git/info/exclude"

  for entry in \
    "fogewise-dev-launchers/.fogewise-dev.local" \
    "fogewise-dev-launchers/.fogewise-production.local"; do
    grep -Fxq "$entry" "$PROJECT_ROOT/.git/info/exclude" 2>/dev/null ||
      printf '%s\n' "$entry" >> "$PROJECT_ROOT/.git/info/exclude"
  done
}

require_tunnel_token() {
  [ -n "$FOGEWISE_TUNNEL_TOKEN" ] && return

  write_default_prod_config_if_missing

  fail "Missing FOGEWISE_TUNNEL_TOKEN.

Ask the Fogewise/Cloudflare admin to provision the preview tunnel for:
  https://$FOGEWISE_PREVIEW_HOST

Then edit:
  $PROD_CONFIG

and set:
  FOGEWISE_TUNNEL_TOKEN=<token>

No Cloudflare zone permission is required on the developer machine."
}

cleanup() {
  local exit_code=$?

  if [ -n "${CADDY_PID:-}" ] && kill -0 "$CADDY_PID" 2>/dev/null; then
    caddy stop --address "$CADDY_ADMIN" >/dev/null 2>&1 || true
    kill "$CADDY_PID" >/dev/null 2>&1 || true
    wait "$CADDY_PID" 2>/dev/null || true
  fi

  return "$exit_code"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

ensure_caddy() {
  if command -v caddy >/dev/null 2>&1; then
    return
  fi

  step "Installing Caddy"
  sudo dnf install -y dnf5-plugins
  sudo dnf copr enable -y @caddy/caddy
  sudo dnf install -y caddy
}

ensure_cloudflared() {
  if command -v cloudflared >/dev/null 2>&1; then
    return
  fi

  step "Installing cloudflared from Cloudflare RPM repository"
  curl -fsSL https://pkg.cloudflare.com/cloudflared.repo |
    sudo tee /etc/yum.repos.d/cloudflared.repo >/dev/null
  sudo dnf install -y cloudflared
}

start_preview_caddy() {
  step "Starting local preview router"

  caddy adapt --config "$CADDY_FILE" >/dev/null

  local log_file="${TMPDIR:-/tmp}/fogewise-${FOGEWISE_SUBDOMAIN}-production-caddy.log"

  caddy run --config "$CADDY_FILE" >"$log_file" 2>&1 &
  CADDY_PID=$!

  sleep 1

  kill -0 "$CADDY_PID" 2>/dev/null ||
    fail "Preview Caddy failed. Check: $log_file"
}

write_default_prod_config_if_missing
exclude_local_files
require_tunnel_token

export FOGEWISE_SUBDOMAIN
export FOGEWISE_WEB_PORT
export FOGEWISE_API_PORT
export FOGEWISE_SHARE_PORT

printf '\n\033[1;32mFogewise Production Preview\033[0m\n'
printf 'Project : %s\n' "$PROJECT_ROOT"
printf 'Public  : https://%s\n' "$FOGEWISE_PREVIEW_HOST"
printf 'Web     : 127.0.0.1:%s\n' "$FOGEWISE_WEB_PORT"
printf 'API     : 127.0.0.1:%s\n' "$FOGEWISE_API_PORT"
printf 'Router  : 127.0.0.1:%s\n' "$FOGEWISE_SHARE_PORT"

printf '\n[Fogewise] The project is NOT started by this launcher.\n'
printf '[Fogewise] Cloudflare tunnel/DNS provisioning is NOT done on the developer machine.\n'
printf '[Fogewise] Start the project yourself before sharing it.\n'

ensure_caddy
ensure_cloudflared
start_preview_caddy

printf '\n\033[1;32m[Fogewise] PUBLIC PREVIEW STARTING\033[0m\n'
printf 'Share this URL after cloudflared connects:\n'
printf '\033[1;34mhttps://%s\033[0m\n' "$FOGEWISE_PREVIEW_HOST"
printf '\nCtrl+C stops cloudflared and the local preview Caddy.\n\n'

cloudflared tunnel --protocol http2 --edge-ip-version 4 run --token "$FOGEWISE_TUNNEL_TOKEN"
