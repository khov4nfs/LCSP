#!/usr/bin/env bash
set -euo pipefail

readonly APP=/srv/apps/lcsp-pm2
readonly ECOSYSTEM_FILE=ecosystem.config.cjs
readonly API_HEALTH_URL=http://127.0.0.1:8080/health
readonly WEB_HEALTH_URL=http://127.0.0.1:3001/

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command is unavailable: $1" >&2
    exit 1
  }
}

wait_for_health() {
  local name=$1
  local url=$2
  local attempts=${3:-20}

  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if curl --fail --silent --show-error --max-time 5 "$url" >/dev/null; then
      echo "${name} is healthy"
      return 0
    fi

    sleep 1
  done

  echo "${name} did not become healthy: ${url}" >&2
  return 1
}

restart_pm2() {
  if pm2 startOrRestart "$ECOSYSTEM_FILE" --update-env; then
    return 0
  fi

  echo "==> PM2 process list is inconsistent; rebuilding the PM2 daemon state"
  pm2 kill || true
  sleep 2
  pm2 start "$ECOSYSTEM_FILE" --update-env
}

require_command curl
require_command dotenv
require_command git
require_command npm
require_command pm2
require_command pnpm

cd "$APP"

echo "==> Pull source"
git pull --ff-only

echo "==> Install Node dependencies"
pnpm install --frozen-lockfile

echo "==> Install Python workers"
.venv/bin/python -m pip install ./lcsp-python-workers

echo "==> Build scanner TS/JS analyzer"
cd "$APP/lcsp-python-workers/src/lcsp_workers/scanner/ts_js_bridge/ts-js-analyzer"
npm ci
npm run build
npm prune --omit=dev

cd "$APP"

echo "==> Build API"
dotenv -e .env.pm2 -- pnpm --filter @lcsp/api build

echo "==> Build Web"
dotenv -e .env.pm2 -- pnpm --filter @lcsp/web build

echo "==> Restart PM2"
restart_pm2
pm2 save

echo "==> Status"
pm2 status

echo "==> API"
wait_for_health "API" "$API_HEALTH_URL"

echo "==> Web"
wait_for_health "Web" "$WEB_HEALTH_URL"

echo "==> Workers"
for port in {8101..8108}; do
  wait_for_health "Worker ${port}" "http://127.0.0.1:${port}/health"
done

echo "==> LCSP redeploy completed"
