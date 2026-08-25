#!/usr/bin/env bash
set -Eeuo pipefail

LAUNCHER_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
BASE_DIR="$(cd -- "$LAUNCHER_DIR/.." && pwd)"
COMPOSE_FILE="$BASE_DIR/common/docker-compose.local-infra.yml"
HOSTS_FILE="/etc/hosts"

step() {
  printf '\n\033[1;36m==> %s\033[0m\n' "$1"
}

fail() {
  printf '\n\033[1;31m[Fogewise] ERROR: %s\033[0m\n' "$1" >&2
  exit 1
}

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
    return
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
    return
  fi

  fail "Docker Compose plugin not found. Install docker + docker compose on Fedora first."
}

container_health() {
  local container_name="$1"
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_name" 2>/dev/null || true
}

wait_for_healthy_container() {
  local container_name="$1"
  local label="$2"
  local timeout_seconds="${3:-60}"
  local started_at current_state elapsed

  started_at="$(date +%s)"

  while true; do
    current_state="$(container_health "$container_name")"
    if [ "$current_state" = "healthy" ] || [ "$current_state" = "running" ]; then
      return 0
    fi

    elapsed="$(( $(date +%s) - started_at ))"
    if [ "$elapsed" -ge "$timeout_seconds" ]; then
      fail "$label did not become healthy within ${timeout_seconds}s (last state: ${current_state:-unknown})."
    fi

    sleep 1
  done
}

ensure_docker() {
  command -v docker >/dev/null 2>&1 || fail "Docker is not installed."

  if ! systemctl is-active --quiet docker 2>/dev/null; then
    step "Starting Docker service"
    sudo systemctl enable --now docker
  fi
}

ensure_hosts_alias() {
  if grep -Eq '^[[:space:]]*127\.0\.0\.1[[:space:]]+fogewise-redis([[:space:]]+.*)?#[[:space:]]*fogewise-local-infra[[:space:]]*$' "$HOSTS_FILE" 2>/dev/null; then
    return
  fi

  if grep -Eq '(^|[[:space:]])fogewise-redis([[:space:]]|$)' "$HOSTS_FILE" 2>/dev/null; then
    fail "fogewise-redis already exists in /etc/hosts without the Fogewise marker. Remove/fix that entry manually first."
  fi

  printf '127.0.0.1 fogewise-redis # fogewise-local-infra\n' |
    sudo tee -a "$HOSTS_FILE" >/dev/null
  sudo resolvectl flush-caches 2>/dev/null || true
}

print_summary() {
  cat <<'EOF'

[Fogewise] Local infra is ready for Fedora.

Use these local endpoints from the host machine:
  DATABASE_URL=postgresql://fogewise:6f9242d8c5d84112a7f8c7f11f6e6372b7f8b5b61a83b7a4@127.0.0.1:5432/lcsp_dev?schema=public
  RABBITMQ_URL=amqp://fogewise:10e0064b19b1dc9727458cdbb0e4f3998d8988628619d807@127.0.0.1:5672

Useful checks:
  PostgreSQL: postgresql://fogewise@127.0.0.1:5432/lcsp_dev
  RabbitMQ UI: http://127.0.0.1:15672
  RabbitMQ user: fogewise
  Redis host alias: fogewise-redis -> 127.0.0.1
EOF
}

[ -f "$COMPOSE_FILE" ] || fail "Compose file not found: $COMPOSE_FILE"

step "Ensuring Docker is available"
ensure_docker

step "Ensuring host alias for fogewise-redis"
ensure_hosts_alias

step "Starting local PostgreSQL + RabbitMQ + Redis"
compose_cmd -f "$COMPOSE_FILE" up -d

step "Waiting for PostgreSQL + RabbitMQ + Redis health checks"
wait_for_healthy_container "fogewise-postgres" "PostgreSQL"
wait_for_healthy_container "fogewise-rabbitmq" "RabbitMQ"
wait_for_healthy_container "fogewise-redis" "Redis"

step "Current container status"
compose_cmd -f "$COMPOSE_FILE" ps

print_summary
