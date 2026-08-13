---
status: ready
updated_at: 2026-08-12
---

# Candidate 2 Extraction Commands — `resolve_independent_classification_review`

## Purpose

This runbook provides a safe extraction path for Candidate 2 from the current mixed Sprint 6 worktree without disturbing the active mixed branch state.

Use this when preparing the isolated issue branch for:

- `resolve_independent_classification_review`
- `1 branch = 1 issue = 1 PR`

## Safety model

This approach avoids:

- `git stash`
- `git reset --hard`
- destructive cleanup of the current mixed worktree

Instead it uses:

- a fresh scratch worktree from `HEAD`
- selective file copy from the mixed worktree
- manual shared-file cleanup for the AO-3-only hunks in classification/evidence/PBAC/scan composition files

## Inputs

Assumptions:

- mixed worktree root: `/home/khovan/Workplaces/LCSP`
- current branch contains the mixed Sprint 6 delta
- target issue branch name will be chosen by the operator

Suggested environment variables:

```bash
export LCSP_REPO_ROOT=/home/khovan/Workplaces/LCSP
export LCSP_CANDIDATE2_WORKTREE=/home/khovan/Workplaces/LCSP-candidate-2
export LCSP_CANDIDATE2_BRANCH=feat/task-<candidate-2-issue-key>-review-resolution
```

## Step 1 — create a clean scratch worktree from `HEAD`

Run from the mixed worktree root:

```bash
git worktree add -b "$LCSP_CANDIDATE2_BRANCH" "$LCSP_CANDIDATE2_WORKTREE" HEAD
```

Expected result:

- a new clean worktree exists at `$LCSP_CANDIDATE2_WORKTREE`
- the current mixed worktree remains unchanged

## Step 2 — copy Candidate 2 issue-owned files into the scratch worktree

Run from `$LCSP_REPO_ROOT`:

```bash
mkdir -p "$LCSP_CANDIDATE2_WORKTREE/apps/api/src/modules/classification/application/commands/resolve-classification-review"
mkdir -p "$LCSP_CANDIDATE2_WORKTREE/apps/api/src/modules/classification/presentation/http"
mkdir -p "$LCSP_CANDIDATE2_WORKTREE/apps/api/src/modules/classification"
mkdir -p "$LCSP_CANDIDATE2_WORKTREE/packages/contracts/src/evidence"
mkdir -p "$LCSP_CANDIDATE2_WORKTREE/packages/contracts/src/pbac"
mkdir -p "$LCSP_CANDIDATE2_WORKTREE/packages/contracts/src/scan"
```

```bash
cp "$LCSP_REPO_ROOT/apps/api/src/modules/classification/application/commands/resolve-classification-review/resolve-classification-review.command.ts" \
  "$LCSP_CANDIDATE2_WORKTREE/apps/api/src/modules/classification/application/commands/resolve-classification-review/"
cp "$LCSP_REPO_ROOT/apps/api/src/modules/classification/application/commands/resolve-classification-review/resolve-classification-review.handler.ts" \
  "$LCSP_CANDIDATE2_WORKTREE/apps/api/src/modules/classification/application/commands/resolve-classification-review/"
cp "$LCSP_REPO_ROOT/apps/api/src/modules/classification/application/commands/resolve-classification-review/resolve-classification-review.handler.spec.ts" \
  "$LCSP_CANDIDATE2_WORKTREE/apps/api/src/modules/classification/application/commands/resolve-classification-review/"
cp "$LCSP_REPO_ROOT/apps/api/src/modules/classification/classification-review-resolution.registration.ts" \
  "$LCSP_CANDIDATE2_WORKTREE/apps/api/src/modules/classification/"
cp "$LCSP_REPO_ROOT/apps/api/src/modules/classification/presentation/http/classification-review-resolution.controller.ts" \
  "$LCSP_CANDIDATE2_WORKTREE/apps/api/src/modules/classification/presentation/http/"
cp "$LCSP_REPO_ROOT/apps/api/src/modules/classification/presentation/http/classification-review-resolution.controller.spec.ts" \
  "$LCSP_CANDIDATE2_WORKTREE/apps/api/src/modules/classification/presentation/http/"
cp "$LCSP_REPO_ROOT/apps/api/src/modules/classification/classification.module.ts" \
  "$LCSP_CANDIDATE2_WORKTREE/apps/api/src/modules/classification/"
cp "$LCSP_REPO_ROOT/packages/contracts/src/evidence/classification-review-resolution.ts" \
  "$LCSP_CANDIDATE2_WORKTREE/packages/contracts/src/evidence/"
cp "$LCSP_REPO_ROOT/packages/contracts/src/evidence/agentic-tool-ao3.ts" \
  "$LCSP_CANDIDATE2_WORKTREE/packages/contracts/src/evidence/"
cp "$LCSP_REPO_ROOT/packages/contracts/src/evidence/ao3-agentic-evidence.ts" \
  "$LCSP_CANDIDATE2_WORKTREE/packages/contracts/src/evidence/"
cp "$LCSP_REPO_ROOT/packages/contracts/src/evidence/agentic-tool.ts" \
  "$LCSP_CANDIDATE2_WORKTREE/packages/contracts/src/evidence/"
cp "$LCSP_REPO_ROOT/packages/contracts/src/evidence/index.ts" \
  "$LCSP_CANDIDATE2_WORKTREE/packages/contracts/src/evidence/"
cp "$LCSP_REPO_ROOT/packages/contracts/src/pbac/ao3-actions.ts" \
  "$LCSP_CANDIDATE2_WORKTREE/packages/contracts/src/pbac/"
cp "$LCSP_REPO_ROOT/packages/contracts/src/pbac/ao3-manager-policy.ts" \
  "$LCSP_CANDIDATE2_WORKTREE/packages/contracts/src/pbac/"
cp "$LCSP_REPO_ROOT/packages/contracts/src/pbac/actions.ts" \
  "$LCSP_CANDIDATE2_WORKTREE/packages/contracts/src/pbac/"
cp "$LCSP_REPO_ROOT/packages/contracts/src/pbac/manager-policy.ts" \
  "$LCSP_CANDIDATE2_WORKTREE/packages/contracts/src/pbac/"
cp "$LCSP_REPO_ROOT/packages/contracts/src/scan/callback-ao3.ts" \
  "$LCSP_CANDIDATE2_WORKTREE/packages/contracts/src/scan/"
cp "$LCSP_REPO_ROOT/packages/contracts/src/scan/callback.ts" \
  "$LCSP_CANDIDATE2_WORKTREE/packages/contracts/src/scan/"
```

Conditionally include only if the issue explicitly owns both submit and resolve:

```bash
cp "$LCSP_REPO_ROOT/apps/api/src/modules/classification/application/commands/submit-classification-review/submit-classification-review.handler.spec.ts" \
  "$LCSP_CANDIDATE2_WORKTREE/apps/api/src/modules/classification/application/commands/submit-classification-review/"
```

## Step 3 — remove foreign shared-hunk content from shared files

Open these scratch-worktree files:

- [classification.module.ts](/home/khovan/Workplaces/LCSP-candidate-2/apps/api/src/modules/classification/classification.module.ts)
- [agentic-tool.ts](/home/khovan/Workplaces/LCSP-candidate-2/packages/contracts/src/evidence/agentic-tool.ts)
- [index.ts](/home/khovan/Workplaces/LCSP-candidate-2/packages/contracts/src/evidence/index.ts)
- [actions.ts](/home/khovan/Workplaces/LCSP-candidate-2/packages/contracts/src/pbac/actions.ts)
- [manager-policy.ts](/home/khovan/Workplaces/LCSP-candidate-2/packages/contracts/src/pbac/manager-policy.ts)
- [callback.ts](/home/khovan/Workplaces/LCSP-candidate-2/packages/contracts/src/scan/callback.ts)

Keep only Candidate 2 / AO-3 content:

- `classification.module.ts`
  - `CLASSIFICATION_REVIEW_RESOLUTION_CONTROLLERS`
  - `CLASSIFICATION_REVIEW_RESOLUTION_PROVIDERS`
- `agentic-tool.ts`
  - `AO3_AGENTIC_TOOL_NAMES`
  - `AO3_AGENTIC_TOOL_EVENT_TYPES`
- `index.ts`
  - `export * from "./ao3-agentic-evidence.ts";`
- `actions.ts`
  - `AO3_PBAC_ACTIONS`
- `manager-policy.ts`
  - `AO3_MANAGER_ONLY_ACTION_VALUES`
- `callback.ts`
  - `AO3_SCAN_EVENT_TYPES`

Remove foreign content:

- AO-5 composition imports/spreads
- AO-4 composition imports/spreads
- AO-6 composition imports/spreads
- `GAP_REQUIREMENTS_CONTROLLERS`
- `GAP_REQUIREMENTS_PROVIDERS`
- `TARGETED_REANALYSIS_SCAN_EVENT_TYPES`

After cleanup, each shared file in the scratch worktree should reflect AO-3 only.

## Step 4 — inspect the scratch diff before staging

Run from `$LCSP_CANDIDATE2_WORKTREE`:

```bash
git diff -- \
  apps/api/src/modules/classification/application/commands/resolve-classification-review/resolve-classification-review.command.ts \
  apps/api/src/modules/classification/application/commands/resolve-classification-review/resolve-classification-review.handler.ts \
  apps/api/src/modules/classification/application/commands/resolve-classification-review/resolve-classification-review.handler.spec.ts \
  apps/api/src/modules/classification/classification-review-resolution.registration.ts \
  apps/api/src/modules/classification/presentation/http/classification-review-resolution.controller.ts \
  apps/api/src/modules/classification/presentation/http/classification-review-resolution.controller.spec.ts \
  apps/api/src/modules/classification/classification.module.ts \
  packages/contracts/src/evidence/classification-review-resolution.ts \
  packages/contracts/src/evidence/agentic-tool-ao3.ts \
  packages/contracts/src/evidence/ao3-agentic-evidence.ts \
  packages/contracts/src/evidence/agentic-tool.ts \
  packages/contracts/src/evidence/index.ts \
  packages/contracts/src/pbac/ao3-actions.ts \
  packages/contracts/src/pbac/ao3-manager-policy.ts \
  packages/contracts/src/pbac/actions.ts \
  packages/contracts/src/pbac/manager-policy.ts \
  packages/contracts/src/scan/callback-ao3.ts \
  packages/contracts/src/scan/callback.ts
```

Verify:

- no AO-4/AO-5/AO-6 imports/spreads remain in shared files
- `classification.module.ts` contains only AO-3 review-resolution registration wiring
- `callback.ts` contains only AO-3 scan event composition

## Step 5 — stage only Candidate 2 files

Run from `$LCSP_CANDIDATE2_WORKTREE`:

```bash
git add \
  apps/api/src/modules/classification/application/commands/resolve-classification-review/resolve-classification-review.command.ts \
  apps/api/src/modules/classification/application/commands/resolve-classification-review/resolve-classification-review.handler.ts \
  apps/api/src/modules/classification/application/commands/resolve-classification-review/resolve-classification-review.handler.spec.ts \
  apps/api/src/modules/classification/classification-review-resolution.registration.ts \
  apps/api/src/modules/classification/presentation/http/classification-review-resolution.controller.ts \
  apps/api/src/modules/classification/presentation/http/classification-review-resolution.controller.spec.ts \
  apps/api/src/modules/classification/classification.module.ts \
  packages/contracts/src/evidence/classification-review-resolution.ts \
  packages/contracts/src/evidence/agentic-tool-ao3.ts \
  packages/contracts/src/evidence/ao3-agentic-evidence.ts \
  packages/contracts/src/evidence/agentic-tool.ts \
  packages/contracts/src/evidence/index.ts \
  packages/contracts/src/pbac/ao3-actions.ts \
  packages/contracts/src/pbac/ao3-manager-policy.ts \
  packages/contracts/src/pbac/actions.ts \
  packages/contracts/src/pbac/manager-policy.ts \
  packages/contracts/src/scan/callback-ao3.ts \
  packages/contracts/src/scan/callback.ts
```

Optional verification:

```bash
git diff --cached --stat
```

## Step 6 — run Candidate 2 verification

Run from `$LCSP_CANDIDATE2_WORKTREE`:

Bootstrap Prisma client first in the fresh scratch worktree. Without this, Jest may fail with:

- `Cannot find module '.prisma/client/default'`

That failure is an environment bootstrap issue, not evidence that the Candidate 2 extraction boundary is wrong.

```bash
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55432/lcsp_api_test?schema=public' \
pnpm --filter @lcsp/api build
```

Then run the focused suites:

```bash
pnpm --filter @lcsp/api test -- --runInBand --runTestsByPath \
  src/modules/classification/application/commands/resolve-classification-review/resolve-classification-review.handler.spec.ts \
  src/modules/classification/presentation/http/classification-review-resolution.controller.spec.ts \
  src/modules/classification/application/commands/submit-classification-review/submit-classification-review.handler.spec.ts \
  src/modules/classification/application/queries/get-gap-requirements/get-gap-requirements.handler.spec.ts \
  src/modules/classification/presentation/http/gap-requirements.controller.spec.ts
```

```bash
git diff --check
```

## Step 7 — commit and open the issue PR

Suggested commit shape:

```bash
git commit -m "feat(classification): isolate review resolution issue slice"
```

Then open the PR from `$LCSP_CANDIDATE2_BRANCH`.

## Stop conditions

Do not commit if any of these are true:

- `classification.module.ts` still contains `GAP_REQUIREMENTS_CONTROLLERS` or `GAP_REQUIREMENTS_PROVIDERS`
- shared files still contain AO-4/AO-5/AO-6 packet imports/spreads
- `callback.ts` still contains `TARGETED_REANALYSIS_SCAN_EVENT_TYPES`
- Jest fails before running tests because `.prisma/client/default` is missing and Prisma bootstrap has not been run yet
- verification commands fail

## Source authority

- [candidate-2-independent-classification-review-resolution-extraction-manifest.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/candidate-2-independent-classification-review-resolution-extraction-manifest.md)
- [sprint-6-extraction-playbook.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-extraction-playbook.md)
