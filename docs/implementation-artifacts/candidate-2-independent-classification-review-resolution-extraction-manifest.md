---
status: ready-for-direct-extraction
updated_at: 2026-08-12
---

# Candidate 2 Extraction Manifest — Independent Classification Review Resolution

## Purpose

This manifest defines the exact extraction boundary for the AO-3 review-resolution slice to split from the current mixed worktree:

- tool / issue focus: `resolve_independent_classification_review`
- target shape: `1 branch = 1 issue = 1 PR`

It is derived from the current mixed worktree plus the verified command evidence recorded in:

- [sprint-6-agentic-verify-matrix.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-agentic-verify-matrix.md)

## Extraction readiness

Status: ready for direct branch extraction with careful shared-hunk split

Why this slice can now extract directly:

- direct handler and controller coverage exists
- adjacent AO-3 chain verification passed on the mixed worktree
- the remaining collisions are limited to composition-root and packet-composition hunks that can be split deterministically

## Exact file set to include

Tracked modified files:

- `apps/api/src/modules/classification/application/commands/resolve-classification-review/resolve-classification-review.command.ts`
- `apps/api/src/modules/classification/application/commands/resolve-classification-review/resolve-classification-review.handler.ts`
- `apps/api/src/modules/classification/application/commands/resolve-classification-review/resolve-classification-review.handler.spec.ts`
- `apps/api/src/modules/classification/classification.module.ts`
- `packages/contracts/src/evidence/agentic-tool.ts`
- `packages/contracts/src/evidence/index.ts`
- `packages/contracts/src/pbac/actions.ts`
- `packages/contracts/src/pbac/manager-policy.ts`
- `packages/contracts/src/scan/callback.ts`

Untracked packet / registration files to include:

- `apps/api/src/modules/classification/classification-review-resolution.registration.ts`
- `apps/api/src/modules/classification/presentation/http/classification-review-resolution.controller.ts`
- `apps/api/src/modules/classification/presentation/http/classification-review-resolution.controller.spec.ts`
- `packages/contracts/src/evidence/agentic-tool-ao3.ts`
- `packages/contracts/src/evidence/ao3-agentic-evidence.ts`
- `packages/contracts/src/evidence/classification-review-resolution.ts`
- `packages/contracts/src/pbac/ao3-actions.ts`
- `packages/contracts/src/pbac/ao3-manager-policy.ts`
- `packages/contracts/src/scan/callback-ao3.ts`

Conditionally include only if the Jira issue explicitly owns both submit and resolve:

- `apps/api/src/modules/classification/application/commands/submit-classification-review/submit-classification-review.handler.spec.ts`

## Minimal shared hunk rules

`apps/api/src/modules/classification/classification.module.ts` is a composition root shared with Candidate 3.

Candidate 2 must carry only:

- the import of `CLASSIFICATION_REVIEW_RESOLUTION_CONTROLLERS`
- the import of `CLASSIFICATION_REVIEW_RESOLUTION_PROVIDERS`
- the controller spread for `...CLASSIFICATION_REVIEW_RESOLUTION_CONTROLLERS`
- the provider spread for `...CLASSIFICATION_REVIEW_RESOLUTION_PROVIDERS`

Do not carry:

- `GAP_REQUIREMENTS_CONTROLLERS`
- `GAP_REQUIREMENTS_PROVIDERS`

`packages/contracts/src/evidence/agentic-tool.ts` must carry only:

- the import of `AO3_AGENTIC_TOOL_NAMES`
- the import of `AO3_AGENTIC_TOOL_EVENT_TYPES`
- the spreads for `...AO3_AGENTIC_TOOL_NAMES`
- the spreads for `...AO3_AGENTIC_TOOL_EVENT_TYPES`

Do not carry AO-4 or AO-5 packet composition hunks.

`packages/contracts/src/evidence/index.ts` must carry only:

- `export * from "./ao3-agentic-evidence.ts";`

`packages/contracts/src/pbac/actions.ts` must carry only:

- the import of `AO3_PBAC_ACTIONS`
- the spread of `...AO3_PBAC_ACTIONS`

`packages/contracts/src/pbac/manager-policy.ts` must carry only:

- the import of `AO3_MANAGER_ONLY_ACTION_VALUES`
- the spread of `...AO3_MANAGER_ONLY_ACTION_VALUES`

`packages/contracts/src/scan/callback.ts` must carry only:

- the import of `AO3_SCAN_EVENT_TYPES`
- the spread of `...AO3_SCAN_EVENT_TYPES`

Do not carry:

- `TARGETED_REANALYSIS_SCAN_EVENT_TYPES`
- any targeted-reanalysis audit/event composition hunks

## Files to exclude

Do not move these files into the Candidate 2 branch:

- `apps/api/src/modules/classification/gap-requirements.registration.ts`
- `apps/api/src/modules/classification/presentation/http/gap-requirements.controller.ts`
- `apps/api/src/modules/classification/presentation/http/gap-requirements.controller.spec.ts`
- `apps/api/src/modules/classification/application/queries/evaluate-gap-matrix/evaluate-gap-matrix.handler.ts`
- `apps/api/src/modules/classification/application/queries/evaluate-gap-matrix/evaluate-gap-matrix.handler.spec.ts`
- `apps/api/src/modules/classification/application/queries/get-gap-evidence-trace/get-gap-evidence-trace.handler.ts`
- `apps/api/src/modules/classification/application/queries/get-gap-evidence-trace/get-gap-evidence-trace.handler.spec.ts`
- `apps/api/src/modules/classification/application/queries/get-gap-requirements/get-gap-requirements.handler.ts`
- `apps/api/src/modules/classification/application/queries/get-gap-requirements/get-gap-requirements.handler.spec.ts`
- `apps/api/src/modules/classification/application/queries/get-gap-requirements/get-gap-requirements.query.ts`
- `apps/api/src/modules/classification/application/queries/propose-gap-remediation/propose-gap-remediation.handler.ts`
- `apps/api/src/modules/classification/application/queries/propose-gap-remediation/propose-gap-remediation.handler.spec.ts`
- `packages/contracts/src/evidence/agentic-tool-ao5.ts`
- `packages/contracts/src/evidence/ao5-agentic-evidence.ts`
- `packages/contracts/src/evidence/gap-requirements.ts`
- `packages/contracts/src/evidence/agentic-tool-ao4.ts`
- `packages/contracts/src/evidence/ao4-agentic-evidence.ts`
- `packages/contracts/src/evidence/wizard-claim-comparison.ts`
- `packages/contracts/src/pbac/ao5-actions.ts`
- `packages/contracts/src/pbac/ao5-manager-policy.ts`
- `packages/contracts/src/scan/callback-targeted-reanalysis.ts`

## Verification commands after extraction

Run these after moving Candidate 2 to its own branch:

```bash
pnpm --filter @lcsp/api test -- --runInBand --runTestsByPath \
  src/modules/classification/application/commands/resolve-classification-review/resolve-classification-review.handler.spec.ts \
  src/modules/classification/presentation/http/classification-review-resolution.controller.spec.ts \
  src/modules/classification/application/commands/submit-classification-review/submit-classification-review.handler.spec.ts \
  src/modules/classification/application/queries/get-gap-requirements/get-gap-requirements.handler.spec.ts \
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

- focused AO-3 review-resolution batch:
  - `resolve-classification-review.handler.spec.ts`
  - `classification-review-resolution.controller.spec.ts`
  - result: 2 suites passed, 10 tests passed
- adjacent AO-3 chain batch:
  - `submit-classification-review.handler.spec.ts`
  - `get-gap-requirements.handler.spec.ts`
  - `gap-requirements.controller.spec.ts`
  - plus the two AO-3 review-resolution specs above
  - result: 5 suites passed, 26 tests passed
- `@lcsp/api build` passed after AO-3 registration and packet-composition changes
- `git diff --check` passed on the mixed worktree after the verification run

## Practical extraction proof

Verified again on Wednesday, August 12, 2026 in detached scratch worktree:

- scratch worktree: `/home/khovan/Workplaces/LCSP-candidate-2-detached`
- exact Candidate 2 file set copied from the mixed worktree
- shared-hunk cleanup applied:
  - removed `GAP_REQUIREMENTS_CONTROLLERS`
  - removed `GAP_REQUIREMENTS_PROVIDERS`
  - restored only AO-3 additions in:
    - `classification.module.ts`
    - `agentic-tool.ts`
    - `index.ts`
    - `actions.ts`
    - `manager-policy.ts`
    - `callback.ts`
- first focused Jest run failed only because the scratch worktree had not generated Prisma client yet:
  - failure shape: `Cannot find module '.prisma/client/default'`
  - interpretation: environment/bootstrap issue, not Candidate 2 slice contamination
- after `pnpm --filter @lcsp/api build` generated Prisma client:
  - focused suites passed:
    - `resolve-classification-review.handler.spec.ts`
    - `classification-review-resolution.controller.spec.ts`
    - `submit-classification-review.handler.spec.ts`
  - result: 3 suites passed, 17 tests passed
  - rerun `@lcsp/api build` exited `0`
  - `git diff --check` passed in the detached worktree

## Remaining risks

Low, but explicit:

1. `classification.module.ts` must be hunk-split carefully to keep AO-5 gap wiring out.
2. Shared evidence/PBAC/scan composition files must carry only AO-3 hunks.
3. Detached verification requires Prisma bootstrap before Jest or the slice will fail with `.prisma/client/default` missing even when the extraction boundary is correct.
4. If Jira scope includes `submit_classification_review`, the spec-only submit diff must be intentionally included rather than accidentally omitted.

## Recommended branch handoff

When creating the real extraction branch:

1. move the exact files above
2. hunk-split `classification.module.ts`
3. hunk-split the shared contract composition files
4. run `pnpm --filter @lcsp/api build` once first in the fresh worktree so Prisma client exists
5. rerun the verification commands
6. keep AO-5 and AO-4 packet files out

If those checks pass, Candidate 2 is ready to become the isolated AO-3 review-resolution PR directly, without waiting for Candidate 3 to land first.
