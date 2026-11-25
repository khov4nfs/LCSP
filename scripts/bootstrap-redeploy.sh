#!/usr/bin/env bash
set -euo pipefail

# Bootstrap redeploy runner for LCSP
# Safely extracts and executes redeploy.sh from the pinned target SHA
# without altering the working tree before preflight verification and drain.

readonly APP="${APP:-/srv/apps/LCSP}"
cd "$APP"

# CI checks each filesystem that can grow during a build. Disk-only mode also
# works when the checkout is dirty and reports capacity without changing the host.
case "${1:-}" in
  --disk-only|--ci)
    readonly MIN_FREE_MIB="${LCSP_DEPLOY_MIN_FREE_MIB:-8192}"
    if [[ ! "$MIN_FREE_MIB" =~ ^[1-9][0-9]{0,7}$ ]]; then
      echo "LCSP_DEPLOY_MIN_FREE_MIB must be a positive integer in MiB" >&2
      exit 1
    fi
    DOCKER_ROOT="$(docker info --format '{{.DockerRootDir}}')"
    if [[ ! -d "$DOCKER_ROOT" ]]; then
      echo "Docker storage directory could not be determined" >&2
      exit 1
    fi
    DISK_USAGE="$(LC_ALL=C df -Pk -- "$APP" "$DOCKER_ROOT" "${TMPDIR:-/tmp}")"
    printf '%s\n' "$DISK_USAGE"
    echo "Minimum free disk per filesystem: $MIN_FREE_MIB MiB"
    if ! awk -v minimum="$((MIN_FREE_MIB * 1024))" 'NR > 1 && $4 < minimum { low = 1 } END { exit low }' <<< "$DISK_USAGE"; then
      echo "Insufficient free disk for deploy" >&2
      [[ "$1" == --disk-only ]] && exit 0
      exit 1
    fi
    [[ "$1" == --disk-only ]] && exit 0

    # Keep is the regular deployment. Reset requires a preconfigured, site-owned
    # command so the pipeline never guesses which shared stores are safe to reset.
    case "${2:-}" in
      keep) ;;
      reset)
        if [[ ! -x /usr/local/sbin/lcsp-reset-data || ! -O /usr/local/sbin/lcsp-reset-data || -L /usr/local/sbin/lcsp-reset-data ]]; then
          echo "Reset unavailable: install the LCSP-specific /usr/local/sbin/lcsp-reset-data handler" >&2
          exit 1
        fi
        ;;
      *) echo "Deployment mode must be keep or reset" >&2; exit 1 ;;
    esac
    export LCSP_DEPLOY_DATA_MODE="$2"
    shift 2
    ;;
esac

if [[ ! "${LCSP_DEPLOY_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "LCSP_DEPLOY_EXPECTED_SHA must pin the reviewed 40-character target revision" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Production checkout has local changes; preserve them before deployment" >&2
  exit 1
fi

# CI accepts only a current main or develop tip from the configured origin.
# Legacy CLI calls without a branch retain their existing develop check.
readonly TARGET_BRANCH="${LCSP_DEPLOY_BRANCH:-develop}"
readonly TARGET_REF="refs/remotes/origin/$TARGET_BRANCH"
if [[ -n "${LCSP_DEPLOY_BRANCH:-}" ]]; then
  case "$TARGET_BRANCH" in
    main|develop) ;;
    *) echo "Unsupported LCSP deployment branch: $TARGET_BRANCH" >&2; exit 1 ;;
  esac
  git fetch --no-tags origin "+refs/heads/$TARGET_BRANCH:$TARGET_REF"
elif git remote get-url origin >/dev/null 2>&1; then
  git fetch origin
fi

if ! git cat-file -e "${LCSP_DEPLOY_EXPECTED_SHA}^{commit}" 2>/dev/null; then
  echo "Target revision ${LCSP_DEPLOY_EXPECTED_SHA} is missing in git repository" >&2
  exit 1
fi

echo "==> Verify origin/$TARGET_BRANCH matches expected SHA before drain"
readonly ORIGIN_TARGET_SHA="$(git rev-parse --verify "$TARGET_REF" 2>/dev/null || true)"
if [[ -n "${LCSP_DEPLOY_BRANCH:-}$ORIGIN_TARGET_SHA" && "$ORIGIN_TARGET_SHA" != "$LCSP_DEPLOY_EXPECTED_SHA" ]]; then
  echo "origin/$TARGET_BRANCH ($ORIGIN_TARGET_SHA) does not match expected SHA ($LCSP_DEPLOY_EXPECTED_SHA); aborting before drain" >&2
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
