#!/usr/bin/env bash
set -euo pipefail

# Bootstrap redeploy runner for LCSP
# Safely extracts and executes redeploy.sh from the pinned target SHA
# without altering the working tree before preflight verification and drain.

readonly APP="${APP:-/srv/apps/LCSP}"
cd "$APP"

if [[ ! "${LCSP_DEPLOY_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "LCSP_DEPLOY_EXPECTED_SHA must pin the reviewed 40-character target revision" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Production checkout has local changes; preserve them before deployment" >&2
  exit 1
fi

if git remote get-url origin >/dev/null 2>&1; then
  echo "==> Fetch target revision without modifying working tree"
  git fetch origin
fi

if ! git cat-file -e "${LCSP_DEPLOY_EXPECTED_SHA}^{commit}" 2>/dev/null; then
  echo "Target revision ${LCSP_DEPLOY_EXPECTED_SHA} is missing in git repository" >&2
  exit 1
fi

echo "==> Verify origin/develop matches expected SHA before drain"
readonly ORIGIN_DEVELOP_SHA="$(git rev-parse origin/develop 2>/dev/null || true)"
if [[ -n "$ORIGIN_DEVELOP_SHA" && "$ORIGIN_DEVELOP_SHA" != "$LCSP_DEPLOY_EXPECTED_SHA" ]]; then
  echo "origin/develop (${ORIGIN_DEVELOP_SHA}) does not match expected SHA (${LCSP_DEPLOY_EXPECTED_SHA}); aborting before drain" >&2
  exit 1
fi

echo "==> Extract and execute target redeploy.sh from ${LCSP_DEPLOY_EXPECTED_SHA}"
mkdir -p "${APP}/.cache"
readonly TARGET_SCRIPT="${APP}/.cache/redeploy.bootstrap.${LCSP_DEPLOY_EXPECTED_SHA}.sh"
git show "${LCSP_DEPLOY_EXPECTED_SHA}:redeploy.sh" > "$TARGET_SCRIPT"
chmod +x "$TARGET_SCRIPT"

cleanup() {
  rm -f "$TARGET_SCRIPT"
}
trap cleanup EXIT

export LCSP_REDEPLOY_BOOTSTRAPPED="$LCSP_DEPLOY_EXPECTED_SHA"
bash "$TARGET_SCRIPT" "$@"

rm -f "$TARGET_SCRIPT"
trap - EXIT
