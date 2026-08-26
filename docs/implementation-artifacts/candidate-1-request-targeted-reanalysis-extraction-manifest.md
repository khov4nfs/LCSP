---
status: ready-for-direct-extraction
updated_at: 2026-08-12
---

# Candidate 1 Extraction Manifest — Request Targeted Reanalysis

## Purpose

This manifest defines the exact extraction boundary for the first Sprint 6 issue slice to split from the current mixed worktree:

- tool / issue focus: `request_targeted_reanalysis`
- target shape: `1 branch = 1 issue = 1 PR`

It is derived from the current mixed worktree plus the verified command evidence recorded in:

- [sprint-6-agentic-verify-matrix.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-agentic-verify-matrix.md)

## Extraction readiness

Status: ready for direct branch extraction

Why this slice is first:

- direct handler verification exists
- scan callback / claim lifecycle regression coverage exists
- shared callback contract overlap has been reduced to a minimal composition hunk
- no remaining Sprint 6 blocker requires Candidate 2/3/4 to land first

## Exact file set to include

Tracked modified files:

- `apps/api/src/modules/scan/application/commands/request-targeted-reanalysis/request-targeted-reanalysis.handler.ts`
- `apps/api/src/modules/scan/application/commands/request-targeted-reanalysis/request-targeted-reanalysis.handler.spec.ts`
- `apps/api/src/modules/scan/application/commands/process-scan-callback/process-scan-callback.handler.spec.ts`
- `apps/api/src/modules/scan/presentation/http/scan.controller.spec.ts`
- `packages/contracts/src/scan/callback.ts`

Untracked packet file to include:

- `packages/contracts/src/scan/callback-targeted-reanalysis.ts`

## Minimal shared hunk rule

`packages/contracts/src/scan/callback.ts` is no longer Candidate 1-only. It now composes:

- `AO3_SCAN_EVENT_TYPES`
- `TARGETED_REANALYSIS_SCAN_EVENT_TYPES`

Candidate 1 must carry only:

- the import of `TARGETED_REANALYSIS_SCAN_EVENT_TYPES`
- the spread of `TARGETED_REANALYSIS_SCAN_EVENT_TYPES`

Build-safe compatibility exception:

- keep the pre-existing inline `classificationReviewRequested`
- keep the pre-existing inline `classificationReviewRequestedAudit`

Reason:

- the current base application build still compiles `submit-classification-review.handler.ts`
- that handler depends on request-side classification review event constants even when Candidate 2 has not yet been extracted into the branch

Do not carry:

- `callback-ao3.ts`
- the `AO3_SCAN_EVENT_TYPES` import/spread

## Files to exclude

Do not move these files into the Candidate 1 branch:

- `packages/contracts/src/scan/callback-ao3.ts`
- `packages/contracts/src/evidence/agentic-tool.ts`
- `packages/contracts/src/evidence/index.ts`
- `packages/contracts/src/rbac/actions.ts`
- `packages/contracts/src/rbac/manager-policy.ts`

Also leave out unchanged adjacent files unless a fresh edit is made intentionally:

- `apps/api/src/modules/scan/presentation/http/scan.controller.ts`
- `apps/api/src/modules/scan/scan.module.ts`
- `apps/api/src/platform/outbox/outbox.repository.ts`
- `apps/api/src/platform/outbox/outbox-publisher.service.ts`

## Verification commands after extraction

Run these after moving Candidate 1 to its own branch:

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

## Verified evidence from the mixed worktree

Verified on Wednesday, August 12, 2026:

- scan targeted-reanalysis regression batch:
  - `request-targeted-reanalysis.handler.spec.ts`
  - `process-scan-callback.handler.spec.ts`
  - `scan.controller.spec.ts`
  - plus AO-3 classification-review adjacency specs used during callback-packet split validation
  - result: 5 suites passed, 29 tests passed
- `@lcsp/api build` passed after `callback-targeted-reanalysis.ts` extraction and `callback.ts` composition split
- `git diff --check` passed on the mixed worktree after the verification run

## Remaining risks

Low, but explicit:

1. `packages/contracts/src/scan/callback.ts` must be hunk-split carefully.
2. The branch must not accidentally absorb AO-3 packet composition, but it currently must retain the legacy request-side classification review constants in `callback.ts` until Candidate 2 lands.
3. Outbox / repository files are verified-adjacent but intentionally excluded to keep the PR tight.

## Recommended branch handoff

When creating the real extraction branch:

1. move the exact files above
2. hunk-split `packages/contracts/src/scan/callback.ts`
3. rerun the verification commands
4. keep all AO-3/AO-4/AO-5 packet files out

If those checks pass, Candidate 1 is ready to become the first isolated Sprint 6 issue PR directly.
