#!/usr/bin/env bash
set -euo pipefail

readonly APP="${APP:-/srv/apps/LCSP}"
readonly ECOSYSTEM_FILE=ecosystem.config.cjs
readonly MIGRATION_ENV_FILE="${APP}/.env.migration"
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

if [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
fi

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

# An explicit branch must go through bootstrap, which fetches and pins that
# branch before loading this script. Keep direct invocations compatible.
if [[ -n "${LCSP_DEPLOY_BRANCH:-}" ]]; then
  case "$LCSP_DEPLOY_BRANCH" in
    main|develop) ;;
    *) echo "Unsupported LCSP deployment branch: $LCSP_DEPLOY_BRANCH" >&2; exit 1 ;;
  esac
  if [[ "${LCSP_REDEPLOY_BOOTSTRAPPED:-}" != "$LCSP_DEPLOY_EXPECTED_SHA" ]]; then
    exec bash scripts/bootstrap-redeploy.sh "$@"
  fi
elif git remote get-url origin >/dev/null 2>&1; then
  echo "==> Fetch target revision without modifying working tree"
  git fetch origin
fi

if ! git cat-file -e "${LCSP_DEPLOY_EXPECTED_SHA}^{commit}" 2>/dev/null; then
  echo "Target revision ${LCSP_DEPLOY_EXPECTED_SHA} is missing in git repository" >&2
  exit 1
fi

readonly TARGET_BRANCH="${LCSP_DEPLOY_BRANCH:-develop}"
echo "==> Verify origin/$TARGET_BRANCH matches expected SHA before drain"
readonly ORIGIN_TARGET_SHA="$(git rev-parse --verify "refs/remotes/origin/$TARGET_BRANCH" 2>/dev/null || true)"
if [[ -n "${LCSP_DEPLOY_BRANCH:-}$ORIGIN_TARGET_SHA" && "$ORIGIN_TARGET_SHA" != "$LCSP_DEPLOY_EXPECTED_SHA" ]]; then
  echo "origin/$TARGET_BRANCH ($ORIGIN_TARGET_SHA) does not match expected SHA ($LCSP_DEPLOY_EXPECTED_SHA); aborting before drain" >&2
  exit 1
fi

if [[ "${LCSP_REDEPLOY_BOOTSTRAPPED:-}" != "$LCSP_DEPLOY_EXPECTED_SHA" ]]; then
  echo "==> Bootstrap: ensuring redeploy.sh is running exactly from revision ${LCSP_DEPLOY_EXPECTED_SHA}"
  mkdir -p "${APP}/.cache"
  readonly BOOTSTRAP_REDEPLOY="${APP}/.cache/redeploy.bootstrap.${LCSP_DEPLOY_EXPECTED_SHA}.sh"
  git show "${LCSP_DEPLOY_EXPECTED_SHA}:redeploy.sh" > "$BOOTSTRAP_REDEPLOY"
  chmod +x "$BOOTSTRAP_REDEPLOY"
  export LCSP_REDEPLOY_BOOTSTRAPPED="$LCSP_DEPLOY_EXPECTED_SHA"
  exec bash "$BOOTSTRAP_REDEPLOY" "$@"
fi

echo "==> Verify migration credentials and privilege separation preflight pinned to ${LCSP_DEPLOY_EXPECTED_SHA} (before drain)"
mkdir -p "${APP}/.cache"
readonly BOOTSTRAP_PREFLIGHT="${APP}/.cache/check-migration-privilege-preflight.bootstrap.${LCSP_DEPLOY_EXPECTED_SHA}.mjs"
git show "${LCSP_DEPLOY_EXPECTED_SHA}:scripts/check-migration-privilege-preflight.mjs" > "$BOOTSTRAP_PREFLIGHT"

cleanup_bootstrap_preflight() {
  rm -f "$BOOTSTRAP_PREFLIGHT"
}
trap cleanup_bootstrap_preflight EXIT

node "$BOOTSTRAP_PREFLIGHT" \
  --env-file "${APP}/.env.pm2" \
  --migration-env-file "$MIGRATION_ENV_FILE" \
  --production

rm -f "$BOOTSTRAP_PREFLIGHT"
trap - EXIT

echo "==> Drain actual native execution before changing source or persistence"
node scripts/drain-agent-runtime.mjs

echo "==> Check out the verified source revision"
# CI can switch between main and develop without rewriting either local branch
# or overwriting ignored runtime configuration. Attached legacy callers still fast-forward.
if [[ -n "${LCSP_DEPLOY_BRANCH:-}" ]] || ! git symbolic-ref -q HEAD >/dev/null; then
  git switch --detach --no-overwrite-ignore "$LCSP_DEPLOY_EXPECTED_SHA"
else
  git pull --ff-only
fi
if [[ "$(git rev-parse HEAD)" != "$LCSP_DEPLOY_EXPECTED_SHA" ]]; then
  echo "Pulled revision differs from the expected PR SHA; no build/restart performed" >&2
  exit 1
fi

echo "==> Install Node dependencies"
pnpm install --frozen-lockfile

echo "==> Prepare Git CLI packages"
pnpm run prepare:cli

echo "==> Install LCSP Agent Runtime"
if command -v uv >/dev/null 2>&1; then
  uv pip install --python .venv/bin/python ./deepagents
elif ! .venv/bin/python -m pip --version >/dev/null 2>&1; then
  .venv/bin/python -m ensurepip
  .venv/bin/python -m pip install ./deepagents
else
  .venv/bin/python -m pip install ./deepagents
fi

echo "==> Build LCSP repository sandbox image"
docker build \
  -f deepagents/Dockerfile \
  -t lcsp-agent-runtime:production-sandbox \
  .

echo "==> Build API"
dotenv -e .env.pm2 -- pnpm --filter @lcsp/api build

if [[ "${LCSP_DEPLOY_DATA_MODE:-keep}" == reset ]]; then
  # Complete the Web build before a reset can affect any persistent data.
  echo "==> Build Web"
  dotenv -e .env.pm2 -- pnpm --filter @lcsp/web build

  # The native drain has completed. Stop LCSP writers before the root-owned
  # handler resets its stores. A failed handler leaves these apps stopped so
  # they cannot write to a partially reset environment.
  echo "==> Stop LCSP processes and reset LCSP data"
  pm2 stop "${EXPECTED_PM2_APPS[@]}"
  /usr/local/sbin/lcsp-reset-data "$APP" "$LCSP_DEPLOY_EXPECTED_SHA"
fi

echo "==> Verify migration credentials and privilege separation preflight (updated checkout)"
node scripts/check-migration-privilege-preflight.mjs \
  --env-file "${APP}/.env.pm2" \
  --migration-env-file "$MIGRATION_ENV_FILE" \
  --production

echo "==> Apply database migrations"
dotenv -e .env.pm2 -e "$MIGRATION_ENV_FILE" -- pnpm --filter @lcsp/api prisma:migrate:deploy

# Keep the existing migration-before-Web order for regular deployments.
if [[ "${LCSP_DEPLOY_DATA_MODE:-keep}" != reset ]]; then
  echo "==> Build Web"
  dotenv -e .env.pm2 -- pnpm --filter @lcsp/web build
fi

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
