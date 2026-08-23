#!/usr/bin/env bash
set -Eeuo pipefail

LAUNCHER_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
BASE_DIR="$(cd -- "$LAUNCHER_DIR/.." && pwd)"
COMMON_DIR="$BASE_DIR/common"

resolve_project_root() {
  if command -v git >/dev/null 2>&1; then
    local git_root
    git_root="$(git -C "$BASE_DIR" rev-parse --show-toplevel 2>/dev/null || true)"

    if [ -n "$git_root" ]; then
      printf '%s\n' "$git_root"
      return
    fi
  fi

  # Only when Git is unavailable / launcher is not inside a Git work tree:
  # fallback to the parent folder containing fogewise-dev-launchers/.
  dirname "$BASE_DIR"
}

PROJECT_ROOT="$(resolve_project_root)"

CONFIG_FILE="$BASE_DIR/.fogewise-dev.local"
CADDY_FILE="$COMMON_DIR/Caddyfile.dev"
HOSTS_FILE="/etc/hosts"
ADMIN_ADDRESS="127.0.0.1:20191"
CADDY_PID=""

step() {
  printf '\n\033[1;36m==> %s\033[0m\n' "$1"
}

fail() {
  printf '\n\033[1;31m[Fogewise] ERROR: %s\033[0m\n' "$1" >&2
  exit 1
}

remove_hosts_override() {
  [ -n "${FOGEWISE_DOMAIN:-}" ] || return 0

  if grep -Eq "#[[:space:]]*fogewise-local-dev[[:space:]]*$" "$HOSTS_FILE" 2>/dev/null; then
    sudo sed -i '' \
      "\|#[[:space:]]*fogewise-local-dev[[:space:]]*$|d" \
      "$HOSTS_FILE"

    sudo dscacheutil -flushcache 2>/dev/null || true
    sudo killall -HUP mDNSResponder 2>/dev/null || true
  fi
}

cleanup() {
  local exit_code=$?

  if [ -n "${CADDY_PID:-}" ] && kill -0 "$CADDY_PID" 2>/dev/null; then
    printf '\n[Fogewise] Stopping local Caddy...\n'
    caddy stop --address "$ADMIN_ADDRESS" >/dev/null 2>&1 || true
    kill "$CADDY_PID" 2>/dev/null || true
    wait "$CADDY_PID" 2>/dev/null || true
  fi

  remove_hosts_override

  if [ -n "${FOGEWISE_DOMAIN:-}" ]; then
    printf '[Fogewise] Local hosts override removed.\n'
    printf '[Fogewise] https://%s now resolves through public DNS again.\n' "$FOGEWISE_DOMAIN"
  fi

  return "$exit_code"
}

trap cleanup EXIT INT TERM HUP

add_local_exclude() {
  local entry="$1"

  if [ -d "$PROJECT_ROOT/.git/info" ]; then
    touch "$PROJECT_ROOT/.git/info/exclude"
    grep -Fxq "$entry" "$PROJECT_ROOT/.git/info/exclude" 2>/dev/null ||
      printf '%s\n' "$entry" >> "$PROJECT_ROOT/.git/info/exclude"
  fi
}

load_or_create_config() {
  local default_subdomain launcher_folder_name answer
  default_subdomain="$(basename "$PROJECT_ROOT" | tr '[:upper:]' '[:lower:]')"
  launcher_folder_name="$(basename "$LAUNCHER_DIR" | tr '[:upper:]' '[:lower:]')"

  FOGEWISE_SUBDOMAIN=""
  FOGEWISE_WEB_PORT="3000"
  FOGEWISE_API_PORT="4000"

  if [ -f "$CONFIG_FILE" ]; then
    while IFS='=' read -r key value; do
      case "$key" in
        FOGEWISE_SUBDOMAIN) FOGEWISE_SUBDOMAIN="$value" ;;
        FOGEWISE_WEB_PORT) FOGEWISE_WEB_PORT="$value" ;;
        FOGEWISE_API_PORT) FOGEWISE_API_PORT="$value" ;;
      esac
    done < "$CONFIG_FILE"
  fi

  # Migration for the previous bug where fogewise-dev-launchers
  # itself became the subdomain.
  if [ -n "$FOGEWISE_SUBDOMAIN" ] &&
     [ "$FOGEWISE_SUBDOMAIN" = "$launcher_folder_name" ] &&
     [ "$launcher_folder_name" != "$default_subdomain" ]; then
    printf '[Fogewise] Auto-fix old subdomain: %s -> %s\n' \
      "$FOGEWISE_SUBDOMAIN" "$default_subdomain"
    FOGEWISE_SUBDOMAIN="$default_subdomain"
  fi

  if [ -z "$FOGEWISE_SUBDOMAIN" ]; then
    printf 'Fogewise subdomain [%s]: ' "$default_subdomain"
    read -r answer
    FOGEWISE_SUBDOMAIN="${answer:-$default_subdomain}"
    FOGEWISE_SUBDOMAIN="$(printf '%s' "$FOGEWISE_SUBDOMAIN" | tr '[:upper:]' '[:lower:]')"
  fi

  printf '%s' "$FOGEWISE_SUBDOMAIN" |
    grep -Eq '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' ||
    fail "Invalid subdomain: $FOGEWISE_SUBDOMAIN"

  [[ "$FOGEWISE_WEB_PORT" =~ ^[0-9]{2,5}$ ]] ||
    fail "Invalid WEB port: $FOGEWISE_WEB_PORT"

  [[ "$FOGEWISE_API_PORT" =~ ^[0-9]{2,5}$ ]] ||
    fail "Invalid API port: $FOGEWISE_API_PORT"

  cat > "$CONFIG_FILE" <<EOF
FOGEWISE_SUBDOMAIN=$FOGEWISE_SUBDOMAIN
FOGEWISE_WEB_PORT=$FOGEWISE_WEB_PORT
FOGEWISE_API_PORT=$FOGEWISE_API_PORT
EOF

  add_local_exclude "fogewise-dev-launchers/.fogewise-dev.local"
  add_local_exclude "fogewise-dev-launchers/.fogewise-dev.trusted-*"

  export FOGEWISE_SUBDOMAIN
  export FOGEWISE_WEB_PORT
  export FOGEWISE_API_PORT

  FOGEWISE_DOMAIN="${FOGEWISE_SUBDOMAIN}.fogewise.io.vn"
  FOGEWISE_PHOENIX_DOMAIN="phoenix.${FOGEWISE_DOMAIN}"
  export FOGEWISE_DOMAIN
  export FOGEWISE_PHOENIX_DOMAIN
}

ensure_caddyfile() {
  [ -f "$CADDY_FILE" ] && return

  cat > "$CADDY_FILE" <<'EOF'
{
    admin 127.0.0.1:20191
    auto_https disable_redirects
}

{$FOGEWISE_SUBDOMAIN}.fogewise.io.vn {
    bind 127.0.0.1
    tls internal

    @phoenix_traces path /v1/traces /v1/traces/*
    handle @phoenix_traces {
        reverse_proxy 127.0.0.1:6006
    }

    @api path /api /api/*
    handle @api {
        reverse_proxy 127.0.0.1:{$FOGEWISE_API_PORT}
    }

    handle {
        reverse_proxy 127.0.0.1:{$FOGEWISE_WEB_PORT}
    }
}

phoenix.{$FOGEWISE_SUBDOMAIN}.fogewise.io.vn {
    bind 127.0.0.1
    tls internal

    handle {
        reverse_proxy 127.0.0.1:6006
    }
}
EOF
}

ensure_hosts() {
  local existing escaped escaped_phoenix
  escaped="${FOGEWISE_DOMAIN//./\\.}"
  escaped_phoenix="${FOGEWISE_PHOENIX_DOMAIN//./\\.}"

  # Repair stale Fogewise entry from an earlier interrupted launcher.
  remove_hosts_override

  # Never overwrite a hosts entry that Fogewise does not own.
  existing="$(grep -E "(^|[[:space:]])(${escaped}|${escaped_phoenix})([[:space:]]|$)" "$HOSTS_FILE" 2>/dev/null || true)"
  if [ -n "$existing" ]; then
    fail "$FOGEWISE_DOMAIN or $FOGEWISE_PHOENIX_DOMAIN already exists in /etc/hosts without the Fogewise marker. Remove/fix that entry manually first."
  fi

  printf '127.0.0.1 %s # fogewise-local-dev\n' "$FOGEWISE_DOMAIN" |
    sudo tee -a "$HOSTS_FILE" >/dev/null
  printf '127.0.0.1 %s # fogewise-local-dev\n' "$FOGEWISE_PHOENIX_DOMAIN" |
    sudo tee -a "$HOSTS_FILE" >/dev/null

  sudo dscacheutil -flushcache 2>/dev/null || true
  sudo killall -HUP mDNSResponder 2>/dev/null || true
}

verify_resolution() {
  ping -c 1 "$FOGEWISE_DOMAIN"
  ping -c 1 "$FOGEWISE_DOMAIN" | grep -q '127\.0\.0\.1' ||
    fail "$FOGEWISE_DOMAIN does not resolve to 127.0.0.1."
  ping -c 1 "$FOGEWISE_PHOENIX_DOMAIN"
  ping -c 1 "$FOGEWISE_PHOENIX_DOMAIN" | grep -q '127\.0\.0\.1' ||
    fail "$FOGEWISE_PHOENIX_DOMAIN does not resolve to 127.0.0.1."
}

print_header() {
  printf '\n\033[1;32mFogewise Local Development\033[0m\n'
  printf 'Launcher: %s\n' "$LAUNCHER_DIR"
  printf 'Project : %s\n' "$PROJECT_ROOT"
  printf 'Domain  : https://%s\n' "$FOGEWISE_DOMAIN"
  printf 'Phoenix : https://%s\n' "$FOGEWISE_PHOENIX_DOMAIN"
  printf 'Web     : 127.0.0.1:%s\n' "$FOGEWISE_WEB_PORT"
  printf 'API     : 127.0.0.1:%s\n' "$FOGEWISE_API_PORT"
}

ensure_caddy() {
  if command -v caddy >/dev/null 2>&1; then
    return
  fi

  step "Caddy not found - installing"

  if command -v brew >/dev/null 2>&1; then
    brew install caddy
  else
    fail "Homebrew/Caddy not found. Install Homebrew and run: brew install caddy"
  fi
}

load_or_create_config
print_header

ensure_caddy
ensure_caddyfile

step "Configuring local DNS override"
ensure_hosts

step "Verifying local resolution"
verify_resolution

step "Checking Caddyfile"
caddy adapt --config "$CADDY_FILE" >/dev/null

step "Starting local Caddy"
LOG_FILE="${TMPDIR:-/tmp}/fogewise-${FOGEWISE_SUBDOMAIN}-caddy.log"

sudo env \
  FOGEWISE_SUBDOMAIN="$FOGEWISE_SUBDOMAIN" \
  FOGEWISE_WEB_PORT="$FOGEWISE_WEB_PORT" \
  FOGEWISE_API_PORT="$FOGEWISE_API_PORT" \
  "$(command -v caddy)" run --config "$CADDY_FILE" \
  >"$LOG_FILE" 2>&1 &

CADDY_PID=$!
sleep 2

kill -0 "$CADDY_PID" 2>/dev/null ||
  fail "Caddy exited during startup. Check: $LOG_FILE"

step "Trusting Caddy Local CA"
sudo env \
  FOGEWISE_SUBDOMAIN="$FOGEWISE_SUBDOMAIN" \
  FOGEWISE_WEB_PORT="$FOGEWISE_WEB_PORT" \
  FOGEWISE_API_PORT="$FOGEWISE_API_PORT" \
  "$(command -v caddy)" trust --address "$ADMIN_ADDRESS" || true

printf '\n\033[1;32m[Fogewise] CADDY READY: https://%s\033[0m\n' "$FOGEWISE_DOMAIN"
printf '[Fogewise] Launcher KHÔNG chạy project.\n'
printf '[Fogewise] Dev tự mở terminal khác tại: %s\n' "$PROJECT_ROOT"
printf '[Fogewise] Sau đó tự chạy command dev của project.\n'
printf '[Fogewise] Giữ terminal này mở. Ctrl+C để stop Caddy.\n\n'

wait "$CADDY_PID"
