#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

# --live-only is for resuming after the API e2e receipts have been reviewed.
case "${1:-}" in
  '') bash tests/run-w4-api-regression.sh --e2e ;;
  --live-only) ;;
  --resume-live)
    if [[ $# != 2 || ! -f "$2" ]]; then
      printf 'Resume requires a saved receipt path.\n' >&2; exit 2
    fi
    # Restart only the retained test container; never recreate the checkpoint database.
    test_postgres=lcsp-api-test-postgres-55441-lcsp_w2_base
    docker start "$test_postgres" >/dev/null
    for attempt in {1..30}; do
      if docker exec "$test_postgres" pg_isready -U postgres -d lcsp_w4_live >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done
    docker exec "$test_postgres" pg_isready -U postgres -d lcsp_w4_live
    export LCSP_W4_EVAL_RESUME_RECEIPT="$2"
    ;;
  *) printf 'Usage: bash tests/run-w4-final-verification.sh [--live-only | --resume-live receipt.json]\n' >&2; exit 2 ;;
esac
pnpm --dir apps/api run build

run_id="$(date -u +%Y%m%d-%H%M%S)"
label="final-bounded-absence-$run_id"
mkdir -p reports/w4-live-eval
printf 'One live Root execution: one rule, two source files. Per-execution budgets: 120 seconds, 20 model calls, stop after 150000 reported input tokens.\nEvidence: reports/w4-live-eval/%s.json\n' "$label"
LCSP_W4_EVAL_ROUTE="${LCSP_W4_EVAL_ROUTE:-fallback-02}" \
  LCSP_W4_EVAL_LABEL="$label" \
  node tests/assessment-root-live-eval.mjs bounded-absence \
  2>&1 | tee "reports/w4-live-eval/$label.log"
