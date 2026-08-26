---
status: ready
updated_at: 2026-08-12
---

# Candidate 4 Extraction Commands — `compare_wizard_claim`

## Purpose

This runbook provides a safe extraction path for Candidate 4 from the current mixed Sprint 6 worktree without disturbing the active mixed branch state.

Use this when preparing the isolated issue branch for:

- `compare_wizard_claim`
- `1 branch = 1 issue = 1 PR`

## Safety model

This approach avoids:

- `git stash`
- `git reset --hard`
- destructive cleanup of the current mixed worktree

Instead it uses:

- a fresh scratch worktree from `HEAD`
- selective file copy from the mixed worktree
- manual shared-file cleanup for the AO-4-only hunks in reconciliation/evidence composition files

## Inputs

Assumptions:

- mixed worktree root: `/home/khovan/Workplaces/LCSP`
- current branch contains the mixed Sprint 6 delta
- target issue branch name will be chosen by the operator

Suggested environment variables:

```bash
export LCSP_REPO_ROOT=/home/khovan/Workplaces/LCSP
export LCSP_CANDIDATE4_WORKTREE=/home/khovan/Workplaces/LCSP-candidate-4
export LCSP_CANDIDATE4_BRANCH=feat/task-<candidate-4-issue-key>-compare-wizard-claim
```

## Step 1 — create a clean scratch worktree from `HEAD`

Run from the mixed worktree root:

```bash
git worktree add -b "$LCSP_CANDIDATE4_BRANCH" "$LCSP_CANDIDATE4_WORKTREE" HEAD
```

Expected result:

- a new clean worktree exists at `$LCSP_CANDIDATE4_WORKTREE`
- the current mixed worktree remains unchanged

## Step 2 — copy Candidate 4 issue-owned files into the scratch worktree

Run from `$LCSP_REPO_ROOT`:

```bash
mkdir -p "$LCSP_CANDIDATE4_WORKTREE/apps/api/src/modules/reconciliation/application/contracts/reconciliation"
mkdir -p "$LCSP_CANDIDATE4_WORKTREE/apps/api/src/modules/reconciliation/application/queries/compare-wizard-claim"
mkdir -p "$LCSP_CANDIDATE4_WORKTREE/apps/api/src/modules/reconciliation/presentation/http"
mkdir -p "$LCSP_CANDIDATE4_WORKTREE/apps/api/src/modules/reconciliation"
mkdir -p "$LCSP_CANDIDATE4_WORKTREE/packages/contracts/src/evidence"
```

```bash
cp "$LCSP_REPO_ROOT/apps/api/src/modules/reconciliation/application/contracts/reconciliation/wizard-claim-comparison.contract.ts" \
  "$LCSP_CANDIDATE4_WORKTREE/apps/api/src/modules/reconciliation/application/contracts/reconciliation/"
cp "$LCSP_REPO_ROOT/apps/api/src/modules/reconciliation/application/queries/compare-wizard-claim/compare-wizard-claim.query.ts" \
  "$LCSP_CANDIDATE4_WORKTREE/apps/api/src/modules/reconciliation/application/queries/compare-wizard-claim/"
cp "$LCSP_REPO_ROOT/apps/api/src/modules/reconciliation/application/queries/compare-wizard-claim/compare-wizard-claim.handler.ts" \
  "$LCSP_CANDIDATE4_WORKTREE/apps/api/src/modules/reconciliation/application/queries/compare-wizard-claim/"
cp "$LCSP_REPO_ROOT/apps/api/src/modules/reconciliation/application/queries/compare-wizard-claim/compare-wizard-claim.handler.spec.ts" \
  "$LCSP_CANDIDATE4_WORKTREE/apps/api/src/modules/reconciliation/application/queries/compare-wizard-claim/"
cp "$LCSP_REPO_ROOT/apps/api/src/modules/reconciliation/compare-wizard-claim.registration.ts" \
  "$LCSP_CANDIDATE4_WORKTREE/apps/api/src/modules/reconciliation/"
cp "$LCSP_REPO_ROOT/apps/api/src/modules/reconciliation/presentation/http/compare-wizard-claim.controller.ts" \
  "$LCSP_CANDIDATE4_WORKTREE/apps/api/src/modules/reconciliation/presentation/http/"
cp "$LCSP_REPO_ROOT/apps/api/src/modules/reconciliation/presentation/http/compare-wizard-claim.request.ts" \
  "$LCSP_CANDIDATE4_WORKTREE/apps/api/src/modules/reconciliation/presentation/http/"
cp "$LCSP_REPO_ROOT/apps/api/src/modules/reconciliation/presentation/http/compare-wizard-claim.controller.spec.ts" \
  "$LCSP_CANDIDATE4_WORKTREE/apps/api/src/modules/reconciliation/presentation/http/"
cp "$LCSP_REPO_ROOT/apps/api/src/modules/reconciliation/reconciliation.module.ts" \
  "$LCSP_CANDIDATE4_WORKTREE/apps/api/src/modules/reconciliation/"
cp "$LCSP_REPO_ROOT/packages/contracts/src/evidence/wizard-claim-comparison.ts" \
  "$LCSP_CANDIDATE4_WORKTREE/packages/contracts/src/evidence/"
cp "$LCSP_REPO_ROOT/packages/contracts/src/evidence/agentic-tool-ao4.ts" \
  "$LCSP_CANDIDATE4_WORKTREE/packages/contracts/src/evidence/"
cp "$LCSP_REPO_ROOT/packages/contracts/src/evidence/ao4-agentic-evidence.ts" \
  "$LCSP_CANDIDATE4_WORKTREE/packages/contracts/src/evidence/"
cp "$LCSP_REPO_ROOT/packages/contracts/src/evidence/agentic-tool.ts" \
  "$LCSP_CANDIDATE4_WORKTREE/packages/contracts/src/evidence/"
cp "$LCSP_REPO_ROOT/packages/contracts/src/evidence/index.ts" \
  "$LCSP_CANDIDATE4_WORKTREE/packages/contracts/src/evidence/"
```

## Step 3 — remove foreign shared-hunk content from shared files

Open these scratch-worktree files:

- [reconciliation.module.ts](/home/khovan/Workplaces/LCSP-candidate-4/apps/api/src/modules/reconciliation/reconciliation.module.ts)
- [agentic-tool.ts](/home/khovan/Workplaces/LCSP-candidate-4/packages/contracts/src/evidence/agentic-tool.ts)
- [index.ts](/home/khovan/Workplaces/LCSP-candidate-4/packages/contracts/src/evidence/index.ts)

Keep only Candidate 4 / AO-4 content:

- `reconciliation.module.ts`
  - `COMPARE_WIZARD_CLAIM_CONTROLLERS`
  - `COMPARE_WIZARD_CLAIM_PROVIDERS`
- `agentic-tool.ts`
  - `AO4_AGENTIC_TOOL_NAMES`
  - `AO4_AGENTIC_TOOL_EVENT_TYPES`
- `index.ts`
  - `export * from "./ao4-agentic-evidence.ts";`

Remove foreign content:

- all AO-3 composition imports/spreads
- all AO-5 composition imports/spreads
- all AO-6 composition imports/spreads
- unrelated reconciliation support-spec cleanup scope

After cleanup, each shared file in the scratch worktree should reflect AO-4 only.

## Step 4 — inspect the scratch diff before staging

Run from `$LCSP_CANDIDATE4_WORKTREE`:

```bash
git diff -- \
  apps/api/src/modules/reconciliation/application/contracts/reconciliation/wizard-claim-comparison.contract.ts \
  apps/api/src/modules/reconciliation/application/queries/compare-wizard-claim/compare-wizard-claim.query.ts \
  apps/api/src/modules/reconciliation/application/queries/compare-wizard-claim/compare-wizard-claim.handler.ts \
  apps/api/src/modules/reconciliation/application/queries/compare-wizard-claim/compare-wizard-claim.handler.spec.ts \
  apps/api/src/modules/reconciliation/compare-wizard-claim.registration.ts \
  apps/api/src/modules/reconciliation/presentation/http/compare-wizard-claim.controller.ts \
  apps/api/src/modules/reconciliation/presentation/http/compare-wizard-claim.request.ts \
  apps/api/src/modules/reconciliation/presentation/http/compare-wizard-claim.controller.spec.ts \
  apps/api/src/modules/reconciliation/reconciliation.module.ts \
  packages/contracts/src/evidence/wizard-claim-comparison.ts \
  packages/contracts/src/evidence/agentic-tool-ao4.ts \
  packages/contracts/src/evidence/ao4-agentic-evidence.ts \
  packages/contracts/src/evidence/agentic-tool.ts \
  packages/contracts/src/evidence/index.ts
```

Verify:

- no AO-3/AO-5/AO-6 imports/spreads remain in shared files
- `reconciliation.module.ts` contains only AO-4 registration wiring

## Step 5 — stage only Candidate 4 files

Run from `$LCSP_CANDIDATE4_WORKTREE`:

```bash
git add \
  apps/api/src/modules/reconciliation/application/contracts/reconciliation/wizard-claim-comparison.contract.ts \
  apps/api/src/modules/reconciliation/application/queries/compare-wizard-claim/compare-wizard-claim.query.ts \
  apps/api/src/modules/reconciliation/application/queries/compare-wizard-claim/compare-wizard-claim.handler.ts \
  apps/api/src/modules/reconciliation/application/queries/compare-wizard-claim/compare-wizard-claim.handler.spec.ts \
  apps/api/src/modules/reconciliation/compare-wizard-claim.registration.ts \
  apps/api/src/modules/reconciliation/presentation/http/compare-wizard-claim.controller.ts \
  apps/api/src/modules/reconciliation/presentation/http/compare-wizard-claim.request.ts \
  apps/api/src/modules/reconciliation/presentation/http/compare-wizard-claim.controller.spec.ts \
  apps/api/src/modules/reconciliation/reconciliation.module.ts \
  packages/contracts/src/evidence/wizard-claim-comparison.ts \
  packages/contracts/src/evidence/agentic-tool-ao4.ts \
  packages/contracts/src/evidence/ao4-agentic-evidence.ts \
  packages/contracts/src/evidence/agentic-tool.ts \
  packages/contracts/src/evidence/index.ts
```

Optional verification:

```bash
git diff --cached --stat
```

## Step 6 — run Candidate 4 verification

Run from `$LCSP_CANDIDATE4_WORKTREE`:

Bootstrap Prisma client first in the fresh scratch worktree. This keeps Jest from failing for environment reasons before the Candidate 4 slice is actually exercised.

```bash
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55432/lcsp_api_test?schema=public' \
pnpm --filter @lcsp/api build
```

Then run the focused suites:

```bash
pnpm --filter @lcsp/api test -- --runInBand --runTestsByPath \
  src/modules/reconciliation/application/queries/compare-wizard-claim/compare-wizard-claim.handler.spec.ts \
  src/modules/reconciliation/presentation/http/compare-wizard-claim.controller.spec.ts
```

```bash
git diff --check
```

## Step 7 — commit and open the issue PR

Suggested commit shape:

```bash
git commit -m "feat(reconciliation): isolate compare wizard claim issue slice"
```

Then open the PR from `$LCSP_CANDIDATE4_BRANCH`.

## Stop conditions

Do not commit if any of these are true:

- `reconciliation.module.ts` still contains foreign reconciliation registration hunks outside Candidate 4 scope
- shared evidence files still contain AO-3/AO-5/AO-6 packet imports/spreads
- scratch worktree contains `packages/contracts/src/rbac/*` packet files
- verification commands fail

## Source authority

- [candidate-4-compare-wizard-claim-extraction-manifest.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/candidate-4-compare-wizard-claim-extraction-manifest.md)
- [sprint-6-extraction-playbook.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-extraction-playbook.md)
