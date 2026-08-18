#!/usr/bin/env bash
set -Eeuo pipefail

LAUNCHER_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
BASE_DIR="$(cd -- "$LAUNCHER_DIR/.." && pwd)"
COMPOSE_FILE="$BASE_DIR/common/docker-compose.local-infra.yml"
HOSTS_FILE="/etc/hosts"

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
    return
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
    return
  fi

  return 0
}

printf '\n[Fogewise] Stopping local PostgreSQL + RabbitMQ + Redis...\n'
compose_cmd -f "$COMPOSE_FILE" down >/dev/null 2>&1 || true

if grep -Eq '^[[:space:]]*127\.0\.0\.1[[:space:]]+fogewise-redis([[:space:]]+.*)?#[[:space:]]*fogewise-local-infra[[:space:]]*$' "$HOSTS_FILE" 2>/dev/null; then
  sudo sed -i '\|^[[:space:]]*127\.0\.0\.1[[:space:]]\+fogewise-redis\([[:space:]].*\)\?#[[:space:]]*fogewise-local-infra[[:space:]]*$|d' "$HOSTS_FILE"
fi

sudo resolvectl flush-caches 2>/dev/null || true

printf '[Fogewise] Local infra containers were stopped.\n'
printf '[Fogewise] Host alias fogewise-redis was removed.\n'
