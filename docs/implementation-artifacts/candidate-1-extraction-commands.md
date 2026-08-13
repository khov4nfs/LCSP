---
status: ready
updated_at: 2026-08-12
---

# Candidate 1 Extraction Commands — `request_targeted_reanalysis`

## Purpose

This runbook provides a safe extraction path for Candidate 1 from the current mixed Sprint 6 worktree without destroying or re-staging the active branch state.

Use this when preparing the isolated issue branch for:

- `request_targeted_reanalysis`
- `1 branch = 1 issue = 1 PR`

## Safety model

This approach avoids:

- `git stash`
- `git reset --hard`
- destructive cleanup of the current mixed worktree

Instead it uses:

- a fresh scratch worktree from `HEAD`
- selective file copy from the mixed worktree
- one manual shared-file cleanup step for `packages/contracts/src/scan/callback.ts`

## Inputs

Assumptions:

- mixed worktree root: `/home/khovan/Workplaces/LCSP`
- current branch contains the mixed Sprint 6 delta
- target issue branch name will be chosen by the operator

Suggested environment variables:

```bash
export LCSP_REPO_ROOT=/home/khovan/Workplaces/LCSP
export LCSP_CANDIDATE1_WORKTREE=/home/khovan/Workplaces/LCSP-candidate-1
export LCSP_CANDIDATE1_BRANCH=feat/task-<candidate-1-issue-key>-request-targeted-reanalysis
```

## Step 1 — create a clean scratch worktree from `HEAD`

Run from the mixed worktree root:

```bash
git worktree add -b "$LCSP_CANDIDATE1_BRANCH" "$LCSP_CANDIDATE1_WORKTREE" HEAD
```

Expected result:

- a new clean worktree exists at `$LCSP_CANDIDATE1_WORKTREE`
- the current mixed worktree remains unchanged

## Step 2 — copy Candidate 1 issue-owned files into the scratch worktree

Run from `$LCSP_REPO_ROOT`:

```bash
mkdir -p "$LCSP_CANDIDATE1_WORKTREE/apps/api/src/modules/scan/application/commands/request-targeted-reanalysis"
mkdir -p "$LCSP_CANDIDATE1_WORKTREE/apps/api/src/modules/scan/application/commands/process-scan-callback"
mkdir -p "$LCSP_CANDIDATE1_WORKTREE/apps/api/src/modules/scan/presentation/http"
mkdir -p "$LCSP_CANDIDATE1_WORKTREE/packages/contracts/src/scan"
```

```bash
cp "$LCSP_REPO_ROOT/apps/api/src/modules/scan/application/commands/request-targeted-reanalysis/request-targeted-reanalysis.handler.ts" \
  "$LCSP_CANDIDATE1_WORKTREE/apps/api/src/modules/scan/application/commands/request-targeted-reanalysis/"
cp "$LCSP_REPO_ROOT/apps/api/src/modules/scan/application/commands/request-targeted-reanalysis/request-targeted-reanalysis.handler.spec.ts" \
  "$LCSP_CANDIDATE1_WORKTREE/apps/api/src/modules/scan/application/commands/request-targeted-reanalysis/"
cp "$LCSP_REPO_ROOT/apps/api/src/modules/scan/application/commands/process-scan-callback/process-scan-callback.handler.spec.ts" \
  "$LCSP_CANDIDATE1_WORKTREE/apps/api/src/modules/scan/application/commands/process-scan-callback/"
cp "$LCSP_REPO_ROOT/apps/api/src/modules/scan/presentation/http/scan.controller.spec.ts" \
  "$LCSP_CANDIDATE1_WORKTREE/apps/api/src/modules/scan/presentation/http/"
cp "$LCSP_REPO_ROOT/packages/contracts/src/scan/callback.ts" \
  "$LCSP_CANDIDATE1_WORKTREE/packages/contracts/src/scan/"
cp "$LCSP_REPO_ROOT/packages/contracts/src/scan/callback-targeted-reanalysis.ts" \
  "$LCSP_CANDIDATE1_WORKTREE/packages/contracts/src/scan/"
```

## Step 3 — remove foreign shared-hunk content from `callback.ts`

Open this file in the scratch worktree:

- [callback.ts](/home/khovan/Workplaces/LCSP-candidate-1/packages/contracts/src/scan/callback.ts)

Keep only Candidate 1 content:

- the import of `TARGETED_REANALYSIS_SCAN_EVENT_TYPES`
- the spread of `...TARGETED_REANALYSIS_SCAN_EVENT_TYPES`

Keep these compatibility constants inline in `callback.ts`:

- `classificationReviewRequested`
- `classificationReviewRequestedAudit`

Why:

- the current base application build still compiles `submit-classification-review.handler.ts`
- that file depends on request-side classification review event constants even when the Candidate 2 AO-3 packet files are not present in the isolated Candidate 1 slice

Remove foreign content:

- the import of `AO3_SCAN_EVENT_TYPES`
- the spread of `...AO3_SCAN_EVENT_TYPES`

After cleanup, `callback.ts` in the scratch worktree should reflect Candidate 1 only.

## Step 4 — inspect the scratch diff before staging

Run from `$LCSP_CANDIDATE1_WORKTREE`:

```bash
git diff -- apps/api/src/modules/scan/application/commands/request-targeted-reanalysis/request-targeted-reanalysis.handler.ts \
  apps/api/src/modules/scan/application/commands/request-targeted-reanalysis/request-targeted-reanalysis.handler.spec.ts \
  apps/api/src/modules/scan/application/commands/process-scan-callback/process-scan-callback.handler.spec.ts \
  apps/api/src/modules/scan/presentation/http/scan.controller.spec.ts \
  packages/contracts/src/scan/callback.ts \
  packages/contracts/src/scan/callback-targeted-reanalysis.ts
```

Verify:

- no AO-3 imports/spreads remain in `callback.ts`
- the two inline compatibility constants above still exist in `callback.ts`
- no AO-4/AO-5 shared barrels were copied

## Step 5 — stage only Candidate 1 files

Run from `$LCSP_CANDIDATE1_WORKTREE`:

```bash
git add \
  apps/api/src/modules/scan/application/commands/request-targeted-reanalysis/request-targeted-reanalysis.handler.ts \
  apps/api/src/modules/scan/application/commands/request-targeted-reanalysis/request-targeted-reanalysis.handler.spec.ts \
  apps/api/src/modules/scan/application/commands/process-scan-callback/process-scan-callback.handler.spec.ts \
  apps/api/src/modules/scan/presentation/http/scan.controller.spec.ts \
  packages/contracts/src/scan/callback.ts \
  packages/contracts/src/scan/callback-targeted-reanalysis.ts
```

Optional verification:

```bash
git diff --cached --stat
```

## Step 6 — run Candidate 1 verification

Run from `$LCSP_CANDIDATE1_WORKTREE`:

```bash
pnpm --filter @lcsp/api test -- --runInBand --runTestsByPath \
  src/modules/scan/application/commands/request-targeted-reanalysis/request-targeted-reanalysis.handler.spec.ts \
  src/modules/scan/application/commands/process-scan-callback/process-scan-callback.handler.spec.ts \
  src/modules/scan/presentation/http/scan.controller.spec.ts
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
git commit -m "feat(scan): isolate targeted reanalysis issue slice"
```

Then open the PR from `$LCSP_CANDIDATE1_BRANCH`.

## Stop conditions

Do not commit if any of these are true:

- `packages/contracts/src/scan/callback.ts` still contains `AO3_SCAN_EVENT_TYPES`
- `packages/contracts/src/scan/callback.ts` no longer contains `classificationReviewRequested` and `classificationReviewRequestedAudit`
- scratch worktree contains `packages/contracts/src/evidence/*` packet files
- scratch worktree contains `packages/contracts/src/pbac/*` packet files
- verification commands fail

## Source authority

- [candidate-1-request-targeted-reanalysis-extraction-manifest.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/candidate-1-request-targeted-reanalysis-extraction-manifest.md)
- [sprint-6-extraction-playbook.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-extraction-playbook.md)
