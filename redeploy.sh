#!/usr/bin/env bash
set -euo pipefail

readonly APP=/srv/apps/LCSP
readonly ECOSYSTEM_FILE=ecosystem.config.cjs
readonly API_HEALTH_URL=http://127.0.0.1:8080/health
readonly WEB_HEALTH_URL=http://127.0.0.1:3002/
readonly LEGACY_PM2_APPS=(
  lcsp-scanner-worker
  lcsp-engineering-assessment-worker
  lcsp-gap-analysis-worker
  lcsp-legal-source-recovery-worker
  lcsp-targeted-reanalysis-worker
  lcsp-final-report-worker
  lcsp-technical-profile-worker
  lcsp-ai-usage-flow-worker
  lcsp-conflict-detection-worker
  lcsp-verified-profile-worker
  lcsp-legal-retrieval-worker
  lcsp-classification-worker
)
readonly EXPECTED_PM2_APPS=(
  lcsp-api
  lcsp-web
  lcsp-agent-runtime
)

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

remove_legacy_pm2_apps() {
  local app
  echo "==> Remove legacy assessment workers"
  for app in "${LEGACY_PM2_APPS[@]}"; do
    if pm2 describe "$app" >/dev/null 2>&1; then
      echo "Deleting stale PM2 app: $app"
      pm2 delete "$app"
    fi
  done
}

assert_expected_pm2_apps() {
  local app
  for app in "${EXPECTED_PM2_APPS[@]}"; do
    if ! pm2 describe "$app" >/dev/null 2>&1; then
      echo "Expected PM2 app is missing: $app" >&2
      return 1
    fi
  done

  for app in "${LEGACY_PM2_APPS[@]}"; do
    if pm2 describe "$app" >/dev/null 2>&1; then
      echo "Legacy PM2 app is still registered after deploy: $app" >&2
      return 1
    fi
  done
}

restart_pm2() {
  # A failed replacement leaves admission drained; never kill unrelated PM2 apps.
  pm2 startOrRestart "$ECOSYSTEM_FILE" --update-env
  assert_expected_pm2_apps
}

require_command curl
require_command dotenv
require_command docker
require_command git
require_command npm
require_command pm2
require_command pnpm

cd "$APP"

if [[ ! "${LCSP_DEPLOY_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "LCSP_DEPLOY_EXPECTED_SHA must pin the reviewed PR revision" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Production checkout has local changes; preserve them before deployment" >&2
  exit 1
fi

echo "==> Drain actual native execution before changing source or persistence"
node scripts/drain-agent-runtime.mjs

echo "==> Pull source"
git pull --ff-only
if [[ "$(git rev-parse HEAD)" != "$LCSP_DEPLOY_EXPECTED_SHA" ]]; then
  echo "Pulled revision differs from the expected PR SHA; no build/restart performed" >&2
  exit 1
fi

echo "==> Install Node dependencies"
pnpm install --frozen-lockfile

echo "==> Install LCSP Agent Runtime"
.venv/bin/python -m pip install ./deepagents

echo "==> Build LCSP repository sandbox image"
docker build \
  -f deepagents/Dockerfile \
  -t lcsp-agent-runtime:production-sandbox \
  .

echo "==> Build API"
dotenv -e .env.pm2 -- pnpm --filter @lcsp/api build

echo "==> Apply database migrations"
dotenv -e .env.pm2 -- pnpm --filter @lcsp/api prisma:migrate:deploy

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

echo "==> LCSP redeploy completed"
