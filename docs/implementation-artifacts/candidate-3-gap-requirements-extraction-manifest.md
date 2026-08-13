---
status: ready-for-direct-extraction
updated_at: 2026-08-12
---

# Candidate 3 Extraction Manifest — Gap Requirements and Gap Tool Chain

## Purpose

This manifest defines the exact extraction boundary for the next AO-5 slice to split from the current mixed worktree:

- tool / issue focus: `get_gap_requirements` plus the directly adjacent gap tool chain
- target shape: `1 branch = 1 issue = 1 PR`

It is derived from the current mixed worktree plus the verified command evidence recorded in:

- [sprint-6-agentic-verify-matrix.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-agentic-verify-matrix.md)

## Extraction readiness

Status: ready for direct branch extraction

Why this slice is next:

- direct handler coverage exists across the AO-5 gap tool chain
- controller coverage exists for the new `gap-requirements` endpoint
- shared contract and PBAC overlap has already been reduced to packet files plus minimal composition hunks
- `classification.module.ts` is now thin enough to patch-split at the composition-root level

## Exact file set to include

Tracked modified files:

- `apps/api/src/modules/classification/application/queries/evaluate-gap-matrix/evaluate-gap-matrix.handler.ts`
- `apps/api/src/modules/classification/application/queries/evaluate-gap-matrix/evaluate-gap-matrix.handler.spec.ts`
- `apps/api/src/modules/classification/application/queries/get-gap-evidence-trace/get-gap-evidence-trace.handler.ts`
- `apps/api/src/modules/classification/application/queries/get-gap-evidence-trace/get-gap-evidence-trace.handler.spec.ts`
- `apps/api/src/modules/classification/application/queries/propose-gap-remediation/propose-gap-remediation.handler.ts`
- `apps/api/src/modules/classification/application/queries/propose-gap-remediation/propose-gap-remediation.handler.spec.ts`
- `apps/api/src/modules/classification/application/queries/get-gap-requirements/get-gap-requirements.handler.ts`
- `apps/api/src/modules/classification/application/queries/get-gap-requirements/get-gap-requirements.handler.spec.ts`
- `apps/api/src/modules/classification/application/queries/get-gap-requirements/get-gap-requirements.query.ts`
- `apps/api/src/modules/classification/classification.module.ts`
- `apps/api/src/modules/classification/presentation/http/gap-requirements.controller.ts`
- `apps/api/src/modules/classification/presentation/http/gap-requirements.controller.spec.ts`
- `packages/contracts/src/evidence/agentic-tool.ts`
- `packages/contracts/src/evidence/index.ts`
- `packages/contracts/src/pbac/actions.ts`
- `packages/contracts/src/pbac/manager-policy.ts`

Untracked packet / registration files to include:

- `apps/api/src/modules/classification/gap-requirements.registration.ts`
- `packages/contracts/src/evidence/agentic-tool-ao5.ts`
- `packages/contracts/src/evidence/ao5-agentic-evidence.ts`
- `packages/contracts/src/evidence/gap-requirements.ts`
- `packages/contracts/src/pbac/ao5-actions.ts`
- `packages/contracts/src/pbac/ao5-manager-policy.ts`

## Minimal shared hunk rules

`apps/api/src/modules/classification/classification.module.ts` is a composition root shared with Candidate 2.

Candidate 3 must carry only:

- the import of `GAP_REQUIREMENTS_CONTROLLERS`
- the import of `GAP_REQUIREMENTS_PROVIDERS`
- the controller spread for `...GAP_REQUIREMENTS_CONTROLLERS`
- the provider spread for `...GAP_REQUIREMENTS_PROVIDERS`

Do not carry:

- `CLASSIFICATION_REVIEW_RESOLUTION_CONTROLLERS`
- `CLASSIFICATION_REVIEW_RESOLUTION_PROVIDERS`

`packages/contracts/src/evidence/agentic-tool.ts` must carry only:

- the import of `AO5_AGENTIC_TOOL_NAMES`
- the import of `AO5_AGENTIC_TOOL_EVENT_TYPES`
- the spreads for `...AO5_AGENTIC_TOOL_NAMES`
- the spreads for `...AO5_AGENTIC_TOOL_EVENT_TYPES`

Do not carry AO-3 or AO-4 packet composition hunks.

`packages/contracts/src/evidence/index.ts` must carry only:

- `export * from "./ao5-agentic-evidence.ts";`

`packages/contracts/src/pbac/actions.ts` must carry only:

- the import of `AO5_PBAC_ACTIONS`
- the spread of `...AO5_PBAC_ACTIONS`

`packages/contracts/src/pbac/manager-policy.ts` must carry only:

- the import of `AO5_MANAGER_ONLY_ACTION_VALUES`
- the spread of `...AO5_MANAGER_ONLY_ACTION_VALUES`

## Files to exclude

Do not move these files into the Candidate 3 branch:

- `apps/api/src/modules/classification/classification-review-resolution.registration.ts`
- `apps/api/src/modules/classification/presentation/http/classification-review-resolution.controller.ts`
- `apps/api/src/modules/classification/presentation/http/classification-review-resolution.controller.spec.ts`
- `apps/api/src/modules/classification/application/commands/resolve-classification-review/resolve-classification-review.command.ts`
- `apps/api/src/modules/classification/application/commands/resolve-classification-review/resolve-classification-review.handler.ts`
- `apps/api/src/modules/classification/application/commands/resolve-classification-review/resolve-classification-review.handler.spec.ts`
- `packages/contracts/src/evidence/agentic-tool-ao3.ts`
- `packages/contracts/src/evidence/ao3-agentic-evidence.ts`
- `packages/contracts/src/evidence/classification-review-resolution.ts`
- `packages/contracts/src/evidence/agentic-tool-ao4.ts`
- `packages/contracts/src/evidence/ao4-agentic-evidence.ts`
- `packages/contracts/src/evidence/wizard-claim-comparison.ts`
- `packages/contracts/src/pbac/ao3-actions.ts`
- `packages/contracts/src/pbac/ao3-manager-policy.ts`

Also leave out unchanged adjacent files unless a fresh edit is made intentionally:

- `apps/api/src/modules/classification/presentation/http/gap-matrix-evaluation.controller.ts`
- `apps/api/src/modules/classification/presentation/http/gap-evidence-trace.controller.ts`
- `apps/api/src/modules/classification/presentation/http/gap-remediation.controller.ts`

## Verification commands after extraction

Run these after moving Candidate 3 to its own branch:

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

## Verified evidence from the mixed worktree

Verified on Wednesday, August 12, 2026:

- focused AO-5 gap chain batch:
  - `evaluate-gap-matrix.handler.spec.ts`
  - `get-gap-evidence-trace.handler.spec.ts`
  - `get-gap-requirements.handler.spec.ts`
  - `propose-gap-remediation.handler.spec.ts`
  - `gap-requirements.controller.spec.ts`
  - result: 5 suites passed, 17 tests passed
- AO-3/AO-5 registration split batch:
  - `classification-review-resolution.controller.spec.ts`
  - `gap-requirements.controller.spec.ts`
  - `resolve-classification-review.handler.spec.ts`
  - `get-gap-requirements.handler.spec.ts`
  - result: 4 suites passed, 19 tests passed
- `@lcsp/api build` passed after `gap-requirements.registration.ts` and AO-5 packet composition changes
- `git diff --check` passed on the mixed worktree after the verification run

## Remaining risks

Low, but explicit:

1. `classification.module.ts` must be hunk-split carefully to keep AO-3 review-resolution wiring out.
2. `agentic-tool.ts`, `index.ts`, `actions.ts`, and `manager-policy.ts` must carry only AO-5 composition hunks.
3. Do not accidentally absorb AO-4 packet files while moving shared evidence barrel changes.

## Recommended branch handoff

When creating the real extraction branch:

1. move the exact files above
2. hunk-split `classification.module.ts`
3. hunk-split the shared contract composition files
4. rerun the verification commands
5. keep AO-3 and AO-4 packet files out

If those checks pass, Candidate 3 is ready to become an isolated Sprint 6 issue PR directly. If the team wants to minimize repeated edits to `classification.module.ts`, Candidate 3 can still land before Candidate 2.
