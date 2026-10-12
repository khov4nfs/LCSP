#!/usr/bin/env bash
# User-run affected canonical integration; every database/container is disposable.
set -euo pipefail

cd "$(dirname "$0")/.."
RELEASE_PYTHON="deepagents/.venv/bin/python"
if [[ "${1:-}" == "--self-check" ]]; then
  test "$#" -eq 1
  test -x "$RELEASE_PYTHON"
  test -f tests/assessment-domain-vertical.mjs
  test -f deepagents/tests/vertical/assessment_deletion.py
  test -f tests/assessment-lifecycle-migrated-db.mjs
  test -f apps/api/test/assessment-lifecycle-protocol.test.ts
  test -f tests/compliance-rule-set-vertical.mjs
  test -f tests/assessment-hitl-vertical.mjs
  test -f tests/run-api-regression.sh
  echo "PASS — runner paths; no build/database/container operation"
  exit 0
fi
RELEASE_DOMAIN_REUSE_BUILD=false
RELEASE_REMAINING_CANONICAL=false
RELEASE_BROAD_REGRESSION=false
RELEASE_REGRESSION_TESTS_ONLY=false
RELEASE_SKIP_API_UNIT=false
RELEASE_WEB_PYTHON_ONLY=false
RELEASE_PYTHON_ONLY=false
for RELEASE_CHECK_ARG in "$@"; do
  case "$RELEASE_CHECK_ARG" in
    --reuse-build) RELEASE_DOMAIN_REUSE_BUILD=true ;;
    --remaining-canonical) RELEASE_REMAINING_CANONICAL=true ;;
    --regression) RELEASE_BROAD_REGRESSION=true ;;
    --regression-tests) RELEASE_BROAD_REGRESSION=true; RELEASE_REGRESSION_TESTS_ONLY=true ;;
    --regression-after-unit) RELEASE_BROAD_REGRESSION=true; RELEASE_REGRESSION_TESTS_ONLY=true; RELEASE_SKIP_API_UNIT=true ;;
    --web-python) RELEASE_BROAD_REGRESSION=true; RELEASE_REGRESSION_TESTS_ONLY=true; RELEASE_SKIP_API_UNIT=true; RELEASE_WEB_PYTHON_ONLY=true ;;
    --python-only) RELEASE_BROAD_REGRESSION=true; RELEASE_REGRESSION_TESTS_ONLY=true; RELEASE_SKIP_API_UNIT=true; RELEASE_WEB_PYTHON_ONLY=true; RELEASE_PYTHON_ONLY=true ;;
    *) echo "Unsupported check argument: $RELEASE_CHECK_ARG" >&2; exit 2 ;;
  esac
done
if [[ "$RELEASE_REMAINING_CANONICAL" == true && "$RELEASE_BROAD_REGRESSION" == true ]]; then
  echo "Choose one check group" >&2
  exit 2
fi
if [[ "$RELEASE_WEB_PYTHON_ONLY" == true && "$RELEASE_DOMAIN_REUSE_BUILD" == false ]]; then
  echo "Web/Python-only verification requires --reuse-build" >&2
  exit 2
fi
if [[ "$RELEASE_DOMAIN_REUSE_BUILD" == true ]]; then
  test -f apps/api/dist/src/main.js
fi
RELEASE_CHECK_GROUP=domain
RELEASE_CHECK_SCOPE=DISPOSABLE_CANONICAL_DOMAIN_AND_DELETE
if [[ "$RELEASE_REMAINING_CANONICAL" == true ]]; then
  RELEASE_CHECK_GROUP=canonical
  RELEASE_CHECK_SCOPE=DISPOSABLE_CANONICAL_PERSISTENCE_RULE_SET_HITL
fi
if [[ "$RELEASE_BROAD_REGRESSION" == true ]]; then
  RELEASE_CHECK_GROUP=regression
  RELEASE_CHECK_SCOPE=DISPOSABLE_CURRENT_RELEASE_BROAD_REGRESSION
  if [[ "$RELEASE_REGRESSION_TESTS_ONLY" == true ]]; then
    RELEASE_CHECK_SCOPE=DISPOSABLE_CURRENT_RELEASE_REGRESSION_TESTS
  fi
  if [[ "$RELEASE_SKIP_API_UNIT" == true ]]; then
    RELEASE_CHECK_SCOPE=DISPOSABLE_CURRENT_RELEASE_AFFECTED_E2E_WEB_PYTHON
  fi
  if [[ "$RELEASE_WEB_PYTHON_ONLY" == true ]]; then
    RELEASE_CHECK_SCOPE=CURRENT_RELEASE_WEB_PYTHON_FIXTURE_REGRESSION
  fi
  if [[ "$RELEASE_PYTHON_ONLY" == true ]]; then
    RELEASE_CHECK_SCOPE=CURRENT_RELEASE_PYTHON_FIXTURE_REGRESSION
  fi
fi
RELEASE_DOMAIN_CONTAINER="lcsp-release-domain-$("$RELEASE_PYTHON" -c 'from uuid import uuid4; print(uuid4().hex)')"
RELEASE_DOMAIN_EVIDENCE="reports/release-$RELEASE_CHECK_GROUP/$("$RELEASE_PYTHON" -c 'from datetime import UTC,datetime; print(datetime.now(UTC).strftime("%Y%m%d%H%M%S"))')_$$"
mkdir -p "$RELEASE_DOMAIN_EVIDENCE"
RELEASE_DOMAIN_OWNED=false
finish() {
  RELEASE_DOMAIN_EXIT=$?
  if [[ "$RELEASE_DOMAIN_OWNED" == true ]]; then
    docker rm -f "$RELEASE_DOMAIN_CONTAINER" >/dev/null || RELEASE_DOMAIN_EXIT=1
  fi
  printf '{"scope":"%s","exitCode":%s}\n' "$RELEASE_CHECK_SCOPE" "$RELEASE_DOMAIN_EXIT" > "$RELEASE_DOMAIN_EVIDENCE/report.json"
  echo "Evidence directory: $PWD/$RELEASE_DOMAIN_EVIDENCE"
  exit "$RELEASE_DOMAIN_EXIT"
}
trap finish EXIT
if [[ "$RELEASE_WEB_PYTHON_ONLY" == false ]]; then
  docker run -d --name "$RELEASE_DOMAIN_CONTAINER" --label lcsp.release-disposable=true \
    -e POSTGRES_PASSWORD=postgres -p 127.0.0.1::5432 postgres:16-alpine >/dev/null
  RELEASE_DOMAIN_OWNED=true
  for RELEASE_READY_ATTEMPT in $(seq 1 60); do
    if docker exec "$RELEASE_DOMAIN_CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
      break
    fi
    if [[ "$RELEASE_READY_ATTEMPT" -eq 60 ]]; then
      echo "FAIL — owned disposable PostgreSQL startup"
      exit 1
    fi
    sleep 1
  done
  export LCSP_TEST_PG_PORT
  LCSP_TEST_PG_PORT="$(docker port "$RELEASE_DOMAIN_CONTAINER" 5432/tcp)"
  LCSP_TEST_PG_PORT="${LCSP_TEST_PG_PORT##*:}"
  export LCSP_ASSESSMENT_TEST_API_PORT LCSP_TEST_AGENT_SERVER_PORT
  read -r LCSP_ASSESSMENT_TEST_API_PORT LCSP_TEST_AGENT_SERVER_PORT < <("$RELEASE_PYTHON" -c '
import socket
with socket.socket() as api, socket.socket() as agent:
    api.bind(("127.0.0.1",0)); agent.bind(("127.0.0.1",0))
    print(api.getsockname()[1], agent.getsockname()[1])
  ')
  export LCSP_COMPLIANCE_RULE_SET_TEST_API_PORT="$LCSP_ASSESSMENT_TEST_API_PORT"
  export LCSP_HITL_TEST_API_PORT="$LCSP_ASSESSMENT_TEST_API_PORT"
  export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:$LCSP_TEST_PG_PORT/postgres?schema=public"
fi
export NODE_OPTIONS="--max-old-space-size=1536"
if [[ "$RELEASE_DOMAIN_REUSE_BUILD" == false ]]; then
  pnpm --filter @lcsp/api prisma:generate
  pnpm run build:runtime-packages
  pnpm --dir apps/api run build
fi
if [[ "$RELEASE_BROAD_REGRESSION" == true ]]; then
  if [[ "$RELEASE_REGRESSION_TESTS_ONLY" == false ]]; then
    pnpm run typecheck
    pnpm run check:imports
    pnpm run check:contracts
    pnpm run check:legal-v1-retired
    pnpm run check:billing-release-gate
    pnpm run test:dev-scripts
    pnpm --dir apps/api run lint
    pnpm --filter @lcsp/web lint
  fi
  if [[ "$RELEASE_WEB_PYTHON_ONLY" == false ]]; then
    if [[ "$RELEASE_SKIP_API_UNIT" == false ]]; then
      bash tests/run-api-regression.sh
    fi
    if [[ "$RELEASE_SKIP_API_UNIT" == true ]]; then
      bash tests/run-api-regression.sh --e2e --runTestsByPath test/assessment.e2e-spec.ts
    else
      bash tests/run-api-regression.sh --e2e
    fi
  fi
  if [[ "$RELEASE_PYTHON_ONLY" == false ]]; then
    pnpm run test:web
  fi
  # Image-backed tests run in the separate required Docker integration job.
  LCSP_DOCKER_SANDBOX_E2E=0 LCSP_PRODUCTION_AGENT_SERVER_IMAGE_E2E=0 \
    PYTHONPATH=deepagents "$RELEASE_PYTHON" -m pytest deepagents/tests -q
elif [[ "$RELEASE_REMAINING_CANONICAL" == true ]]; then
  node tests/assessment-lifecycle-migrated-db.mjs
  node tests/compliance-rule-set-vertical.mjs
  node tests/assessment-hitl-vertical.mjs
  node tests/assessment-hitl-vertical.mjs --unresolvable-only
else
  node tests/assessment-domain-vertical.mjs
fi
