---
status: ready
updated_at: 2026-08-12
---

# Candidate 3 Extraction Commands — `get_gap_requirements`

## Purpose

This runbook provides a safe extraction path for Candidate 3 from the current mixed Sprint 6 worktree without disturbing the active mixed branch state.

Use this when preparing the isolated issue branch for:

- `get_gap_requirements`
- the directly adjacent AO-5 gap tool chain
- `1 branch = 1 issue = 1 PR`

## Safety model

This approach avoids:

- `git stash`
- `git reset --hard`
- destructive cleanup of the current mixed worktree

Instead it uses:

- a fresh scratch worktree from `HEAD`
- selective file copy from the mixed worktree
- manual shared-file cleanup for the AO-5-only hunks in composition files

## Inputs

Assumptions:

- mixed worktree root: `/home/khovan/Workplaces/LCSP`
- current branch contains the mixed Sprint 6 delta
- target issue branch name will be chosen by the operator

Suggested environment variables:

```bash
export LCSP_REPO_ROOT=/home/khovan/Workplaces/LCSP
export LCSP_CANDIDATE3_WORKTREE=/home/khovan/Workplaces/LCSP-candidate-3
export LCSP_CANDIDATE3_BRANCH=feat/task-<candidate-3-issue-key>-gap-requirements
```

## Step 1 — create a clean scratch worktree from `HEAD`

Run from the mixed worktree root:

```bash
git worktree add -b "$LCSP_CANDIDATE3_BRANCH" "$LCSP_CANDIDATE3_WORKTREE" HEAD
```

Expected result:

- a new clean worktree exists at `$LCSP_CANDIDATE3_WORKTREE`
- the current mixed worktree remains unchanged

## Step 2 — copy Candidate 3 issue-owned files into the scratch worktree

Run from `$LCSP_REPO_ROOT`:

```bash
mkdir -p "$LCSP_CANDIDATE3_WORKTREE/apps/api/src/modules/classification/application/queries/evaluate-gap-matrix"
mkdir -p "$LCSP_CANDIDATE3_WORKTREE/apps/api/src/modules/classification/application/queries/get-gap-evidence-trace"
mkdir -p "$LCSP_CANDIDATE3_WORKTREE/apps/api/src/modules/classification/application/queries/propose-gap-remediation"
mkdir -p "$LCSP_CANDIDATE3_WORKTREE/apps/api/src/modules/classification/application/queries/get-gap-requirements"
mkdir -p "$LCSP_CANDIDATE3_WORKTREE/apps/api/src/modules/classification/presentation/http"
mkdir -p "$LCSP_CANDIDATE3_WORKTREE/apps/api/src/modules/classification"
mkdir -p "$LCSP_CANDIDATE3_WORKTREE/packages/contracts/src/evidence"
mkdir -p "$LCSP_CANDIDATE3_WORKTREE/packages/contracts/src/pbac"
```

```bash
cp "$LCSP_REPO_ROOT/apps/api/src/modules/classification/application/queries/evaluate-gap-matrix/evaluate-gap-matrix.handler.ts" \
  "$LCSP_CANDIDATE3_WORKTREE/apps/api/src/modules/classification/application/queries/evaluate-gap-matrix/"
cp "$LCSP_REPO_ROOT/apps/api/src/modules/classification/application/queries/evaluate-gap-matrix/evaluate-gap-matrix.handler.spec.ts" \
  "$LCSP_CANDIDATE3_WORKTREE/apps/api/src/modules/classification/application/queries/evaluate-gap-matrix/"
cp "$LCSP_REPO_ROOT/apps/api/src/modules/classification/application/queries/get-gap-evidence-trace/get-gap-evidence-trace.handler.ts" \
  "$LCSP_CANDIDATE3_WORKTREE/apps/api/src/modules/classification/application/queries/get-gap-evidence-trace/"
cp "$LCSP_REPO_ROOT/apps/api/src/modules/classification/application/queries/get-gap-evidence-trace/get-gap-evidence-trace.handler.spec.ts" \
  "$LCSP_CANDIDATE3_WORKTREE/apps/api/src/modules/classification/application/queries/get-gap-evidence-trace/"
cp "$LCSP_REPO_ROOT/apps/api/src/modules/classification/application/queries/propose-gap-remediation/propose-gap-remediation.handler.ts" \
  "$LCSP_CANDIDATE3_WORKTREE/apps/api/src/modules/classification/application/queries/propose-gap-remediation/"
cp "$LCSP_REPO_ROOT/apps/api/src/modules/classification/application/queries/propose-gap-remediation/propose-gap-remediation.handler.spec.ts" \
  "$LCSP_CANDIDATE3_WORKTREE/apps/api/src/modules/classification/application/queries/propose-gap-remediation/"
cp "$LCSP_REPO_ROOT/apps/api/src/modules/classification/application/queries/get-gap-requirements/get-gap-requirements.handler.ts" \
  "$LCSP_CANDIDATE3_WORKTREE/apps/api/src/modules/classification/application/queries/get-gap-requirements/"
cp "$LCSP_REPO_ROOT/apps/api/src/modules/classification/application/queries/get-gap-requirements/get-gap-requirements.handler.spec.ts" \
  "$LCSP_CANDIDATE3_WORKTREE/apps/api/src/modules/classification/application/queries/get-gap-requirements/"
cp "$LCSP_REPO_ROOT/apps/api/src/modules/classification/application/queries/get-gap-requirements/get-gap-requirements.query.ts" \
  "$LCSP_CANDIDATE3_WORKTREE/apps/api/src/modules/classification/application/queries/get-gap-requirements/"
cp "$LCSP_REPO_ROOT/apps/api/src/modules/classification/presentation/http/gap-requirements.controller.ts" \
  "$LCSP_CANDIDATE3_WORKTREE/apps/api/src/modules/classification/presentation/http/"
cp "$LCSP_REPO_ROOT/apps/api/src/modules/classification/presentation/http/gap-requirements.controller.spec.ts" \
  "$LCSP_CANDIDATE3_WORKTREE/apps/api/src/modules/classification/presentation/http/"
cp "$LCSP_REPO_ROOT/apps/api/src/modules/classification/gap-requirements.registration.ts" \
  "$LCSP_CANDIDATE3_WORKTREE/apps/api/src/modules/classification/"
cp "$LCSP_REPO_ROOT/apps/api/src/modules/classification/classification.module.ts" \
  "$LCSP_CANDIDATE3_WORKTREE/apps/api/src/modules/classification/"
cp "$LCSP_REPO_ROOT/packages/contracts/src/evidence/gap-requirements.ts" \
  "$LCSP_CANDIDATE3_WORKTREE/packages/contracts/src/evidence/"
cp "$LCSP_REPO_ROOT/packages/contracts/src/evidence/agentic-tool-ao5.ts" \
  "$LCSP_CANDIDATE3_WORKTREE/packages/contracts/src/evidence/"
cp "$LCSP_REPO_ROOT/packages/contracts/src/evidence/ao5-agentic-evidence.ts" \
  "$LCSP_CANDIDATE3_WORKTREE/packages/contracts/src/evidence/"
cp "$LCSP_REPO_ROOT/packages/contracts/src/evidence/agentic-tool.ts" \
  "$LCSP_CANDIDATE3_WORKTREE/packages/contracts/src/evidence/"
cp "$LCSP_REPO_ROOT/packages/contracts/src/evidence/index.ts" \
  "$LCSP_CANDIDATE3_WORKTREE/packages/contracts/src/evidence/"
cp "$LCSP_REPO_ROOT/packages/contracts/src/pbac/ao5-actions.ts" \
  "$LCSP_CANDIDATE3_WORKTREE/packages/contracts/src/pbac/"
cp "$LCSP_REPO_ROOT/packages/contracts/src/pbac/ao5-manager-policy.ts" \
  "$LCSP_CANDIDATE3_WORKTREE/packages/contracts/src/pbac/"
cp "$LCSP_REPO_ROOT/packages/contracts/src/pbac/actions.ts" \
  "$LCSP_CANDIDATE3_WORKTREE/packages/contracts/src/pbac/"
cp "$LCSP_REPO_ROOT/packages/contracts/src/pbac/manager-policy.ts" \
  "$LCSP_CANDIDATE3_WORKTREE/packages/contracts/src/pbac/"
```

## Step 3 — remove foreign shared-hunk content from shared files

Open these scratch-worktree files:

- [classification.module.ts](/home/khovan/Workplaces/LCSP-candidate-3/apps/api/src/modules/classification/classification.module.ts)
- [agentic-tool.ts](/home/khovan/Workplaces/LCSP-candidate-3/packages/contracts/src/evidence/agentic-tool.ts)
- [index.ts](/home/khovan/Workplaces/LCSP-candidate-3/packages/contracts/src/evidence/index.ts)
- [actions.ts](/home/khovan/Workplaces/LCSP-candidate-3/packages/contracts/src/pbac/actions.ts)
- [manager-policy.ts](/home/khovan/Workplaces/LCSP-candidate-3/packages/contracts/src/pbac/manager-policy.ts)

Keep only Candidate 3 / AO-5 content:

- `classification.module.ts`
  - `GAP_REQUIREMENTS_CONTROLLERS`
  - `GAP_REQUIREMENTS_PROVIDERS`
- `agentic-tool.ts`
  - `AO5_AGENTIC_TOOL_NAMES`
  - `AO5_AGENTIC_TOOL_EVENT_TYPES`
- `index.ts`
  - `export * from "./ao5-agentic-evidence.ts";`
- `actions.ts`
  - `AO5_PBAC_ACTIONS`
- `manager-policy.ts`
  - `AO5_MANAGER_ONLY_ACTION_VALUES`

Remove foreign content:

- all AO-3 composition imports/spreads
- all AO-4 composition imports/spreads
- all AO-6 composition imports/spreads
- review-resolution wiring in `classification.module.ts`

After cleanup, each shared file in the scratch worktree should reflect AO-5 only.

## Step 4 — inspect the scratch diff before staging

Run from `$LCSP_CANDIDATE3_WORKTREE`:

```bash
git diff -- \
  apps/api/src/modules/classification/application/queries/evaluate-gap-matrix/evaluate-gap-matrix.handler.ts \
  apps/api/src/modules/classification/application/queries/evaluate-gap-matrix/evaluate-gap-matrix.handler.spec.ts \
  apps/api/src/modules/classification/application/queries/get-gap-evidence-trace/get-gap-evidence-trace.handler.ts \
  apps/api/src/modules/classification/application/queries/get-gap-evidence-trace/get-gap-evidence-trace.handler.spec.ts \
  apps/api/src/modules/classification/application/queries/propose-gap-remediation/propose-gap-remediation.handler.ts \
  apps/api/src/modules/classification/application/queries/propose-gap-remediation/propose-gap-remediation.handler.spec.ts \
  apps/api/src/modules/classification/application/queries/get-gap-requirements/get-gap-requirements.handler.ts \
  apps/api/src/modules/classification/application/queries/get-gap-requirements/get-gap-requirements.handler.spec.ts \
  apps/api/src/modules/classification/application/queries/get-gap-requirements/get-gap-requirements.query.ts \
  apps/api/src/modules/classification/presentation/http/gap-requirements.controller.ts \
  apps/api/src/modules/classification/presentation/http/gap-requirements.controller.spec.ts \
  apps/api/src/modules/classification/gap-requirements.registration.ts \
  apps/api/src/modules/classification/classification.module.ts \
  packages/contracts/src/evidence/gap-requirements.ts \
  packages/contracts/src/evidence/agentic-tool-ao5.ts \
  packages/contracts/src/evidence/ao5-agentic-evidence.ts \
  packages/contracts/src/evidence/agentic-tool.ts \
  packages/contracts/src/evidence/index.ts \
  packages/contracts/src/pbac/ao5-actions.ts \
  packages/contracts/src/pbac/ao5-manager-policy.ts \
  packages/contracts/src/pbac/actions.ts \
  packages/contracts/src/pbac/manager-policy.ts
```

Verify:

- no AO-3/AO-4/AO-6 imports/spreads remain in shared files
- `classification.module.ts` contains only AO-5 registration wiring

## Step 5 — stage only Candidate 3 files

Run from `$LCSP_CANDIDATE3_WORKTREE`:

```bash
git add \
  apps/api/src/modules/classification/application/queries/evaluate-gap-matrix/evaluate-gap-matrix.handler.ts \
  apps/api/src/modules/classification/application/queries/evaluate-gap-matrix/evaluate-gap-matrix.handler.spec.ts \
  apps/api/src/modules/classification/application/queries/get-gap-evidence-trace/get-gap-evidence-trace.handler.ts \
  apps/api/src/modules/classification/application/queries/get-gap-evidence-trace/get-gap-evidence-trace.handler.spec.ts \
  apps/api/src/modules/classification/application/queries/propose-gap-remediation/propose-gap-remediation.handler.ts \
  apps/api/src/modules/classification/application/queries/propose-gap-remediation/propose-gap-remediation.handler.spec.ts \
  apps/api/src/modules/classification/application/queries/get-gap-requirements/get-gap-requirements.handler.ts \
  apps/api/src/modules/classification/application/queries/get-gap-requirements/get-gap-requirements.handler.spec.ts \
  apps/api/src/modules/classification/application/queries/get-gap-requirements/get-gap-requirements.query.ts \
  apps/api/src/modules/classification/presentation/http/gap-requirements.controller.ts \
  apps/api/src/modules/classification/presentation/http/gap-requirements.controller.spec.ts \
  apps/api/src/modules/classification/gap-requirements.registration.ts \
  apps/api/src/modules/classification/classification.module.ts \
  packages/contracts/src/evidence/gap-requirements.ts \
  packages/contracts/src/evidence/agentic-tool-ao5.ts \
  packages/contracts/src/evidence/ao5-agentic-evidence.ts \
  packages/contracts/src/evidence/agentic-tool.ts \
  packages/contracts/src/evidence/index.ts \
  packages/contracts/src/pbac/ao5-actions.ts \
  packages/contracts/src/pbac/ao5-manager-policy.ts \
  packages/contracts/src/pbac/actions.ts \
  packages/contracts/src/pbac/manager-policy.ts
```

Optional verification:

```bash
git diff --cached --stat
```

## Step 6 — run Candidate 3 verification

Run from `$LCSP_CANDIDATE3_WORKTREE`:

```bash
pnpm --filter @lcsp/api test -- --runInBand --runTestsByPath \
  src/modules/classification/application/queries/evaluate-gap-matrix/evaluate-gap-matrix.handler.spec.ts \
  src/modules/classification/application/queries/get-gap-evidence-trace/get-gap-evidence-trace.handler.spec.ts \
  src/modules/classification/application/queries/get-gap-requirements/get-gap-requirements.handler.spec.ts \
  src/modules/classification/application/queries/propose-gap-remediation/propose-gap-remediation.handler.spec.ts \
  src/modules/classification/presentation/http/gap-requirements.controller.spec.ts
```

```bash
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55432/lcsp_api_test?schema=public' \
pnpm --filter @lcsp/api build
```

```bash
git diff --check
```

## Step 7 — commit and open the issue PR

Suggested commit shape:

```bash
git commit -m "feat(classification): isolate gap requirements issue slice"
```

Then open the PR from `$LCSP_CANDIDATE3_BRANCH`.

## Stop conditions

Do not commit if any of these are true:

- `classification.module.ts` still contains `CLASSIFICATION_REVIEW_RESOLUTION_CONTROLLERS` or `CLASSIFICATION_REVIEW_RESOLUTION_PROVIDERS`
- shared files still contain AO-3/AO-4/AO-6 packet imports/spreads
- scratch worktree contains `packages/contracts/src/scan/*` callback packet files
- verification commands fail

## Source authority

- [candidate-3-gap-requirements-extraction-manifest.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/candidate-3-gap-requirements-extraction-manifest.md)
- [sprint-6-extraction-playbook.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-extraction-playbook.md)
