---
status: ready-for-direct-extraction
updated_at: 2026-08-12
---

# Candidate 4 Extraction Manifest — Compare Wizard Claim

## Purpose

This manifest defines the exact extraction boundary for the AO-4 `compare_wizard_claim` slice to split from the current mixed worktree:

- tool / issue focus: `compare_wizard_claim`
- target shape: `1 branch = 1 issue = 1 PR`

It is derived from the current mixed worktree plus the verified command evidence recorded in:

- [sprint-6-agentic-verify-matrix.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-agentic-verify-matrix.md)

## Extraction readiness

Status: ready for direct branch extraction

Why this slice can extract cleanly now:

- the route-specific controller has been split out of `reconciliation.controller.ts`
- request parsing now lives in `compare-wizard-claim.request.ts`
- AO-4 module wiring now lives in `compare-wizard-claim.registration.ts`
- route-specific controller and handler coverage already exist

## Exact file set to include

Tracked modified files:

- `apps/api/src/modules/reconciliation/reconciliation.module.ts`
- `packages/contracts/src/evidence/agentic-tool.ts`
- `packages/contracts/src/evidence/index.ts`

Untracked production and packet files to include:

- `apps/api/src/modules/reconciliation/application/contracts/reconciliation/wizard-claim-comparison.contract.ts`
- `apps/api/src/modules/reconciliation/application/queries/compare-wizard-claim/compare-wizard-claim.query.ts`
- `apps/api/src/modules/reconciliation/application/queries/compare-wizard-claim/compare-wizard-claim.handler.ts`
- `apps/api/src/modules/reconciliation/application/queries/compare-wizard-claim/compare-wizard-claim.handler.spec.ts`
- `apps/api/src/modules/reconciliation/compare-wizard-claim.registration.ts`
- `apps/api/src/modules/reconciliation/presentation/http/compare-wizard-claim.controller.ts`
- `apps/api/src/modules/reconciliation/presentation/http/compare-wizard-claim.request.ts`
- `apps/api/src/modules/reconciliation/presentation/http/compare-wizard-claim.controller.spec.ts`
- `packages/contracts/src/evidence/agentic-tool-ao4.ts`
- `packages/contracts/src/evidence/ao4-agentic-evidence.ts`
- `packages/contracts/src/evidence/wizard-claim-comparison.ts`

Conditionally include only if the branch intentionally carries broader reconciliation support-spec cleanup:

- `apps/api/src/modules/reconciliation/presentation/http/reconciliation.controller.spec.ts`
- `apps/api/src/modules/reconciliation/presentation/http/get-artifact-chain.controller.spec.ts`
- `apps/api/src/modules/reconciliation/presentation/http/get-reconciliation-context.controller.spec.ts`

## Minimal shared hunk rules

`apps/api/src/modules/reconciliation/reconciliation.module.ts` is now a composition root.

Candidate 4 must carry only:

- the import of `COMPARE_WIZARD_CLAIM_CONTROLLERS`
- the import of `COMPARE_WIZARD_CLAIM_PROVIDERS`
- the controller spread for `...COMPARE_WIZARD_CLAIM_CONTROLLERS`
- the provider spread for `...COMPARE_WIZARD_CLAIM_PROVIDERS`

Do not widen this branch by absorbing unrelated reconciliation production files.

`packages/contracts/src/evidence/agentic-tool.ts` must carry only:

- the import of `AO4_AGENTIC_TOOL_NAMES`
- the import of `AO4_AGENTIC_TOOL_EVENT_TYPES`
- the spreads for `...AO4_AGENTIC_TOOL_NAMES`
- the spreads for `...AO4_AGENTIC_TOOL_EVENT_TYPES`

Do not carry AO-3 or AO-5 packet composition hunks.

`packages/contracts/src/evidence/index.ts` must carry only:

- `export * from "./ao4-agentic-evidence.ts";`

## Files to exclude

Do not move these files into the Candidate 4 branch unless Jira explicitly broadens the issue scope:

- `apps/api/src/modules/reconciliation/application/commands/approve-verified-profile/approve-verified-profile.handler.spec.ts`
- `apps/api/src/modules/reconciliation/application/commands/reconcile-profile-to-verified-profile/reconcile-profile-to-verified-profile.handler.spec.ts`
- `apps/api/src/modules/reconciliation/application/queries/get-artifact-chain/get-artifact-chain.handler.spec.ts`
- `apps/api/src/modules/reconciliation/application/queries/get-assessment-context/get-assessment-context.handler.spec.ts`
- `apps/api/src/modules/reconciliation/application/queries/get-reconciliation-context/get-reconciliation-context.handler.spec.ts`
- `apps/api/src/modules/reconciliation/application/queries/get-verified-profile/get-verified-profile.handler.spec.ts`
- `apps/api/src/modules/reconciliation/application/queries/propose-missing-targets/propose-missing-targets.handler.spec.ts`
- `apps/api/src/modules/reconciliation/presentation/http/reconciliation.controller.ts`
- `packages/contracts/src/pbac/actions.ts`
- `packages/contracts/src/pbac/manager-policy.ts`
- `packages/contracts/src/evidence/agentic-tool-ao3.ts`
- `packages/contracts/src/evidence/ao3-agentic-evidence.ts`
- `packages/contracts/src/evidence/classification-review-resolution.ts`
- `packages/contracts/src/evidence/agentic-tool-ao5.ts`
- `packages/contracts/src/evidence/ao5-agentic-evidence.ts`
- `packages/contracts/src/evidence/gap-requirements.ts`

## Verification commands after extraction

Run these after moving Candidate 4 to its own branch:

```bash
pnpm --filter @lcsp/api test -- --runInBand --runTestsByPath \
  src/modules/reconciliation/application/queries/compare-wizard-claim/compare-wizard-claim.handler.spec.ts \
  src/modules/reconciliation/presentation/http/compare-wizard-claim.controller.spec.ts
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

- focused AO-4 compare-wizard-claim batch:
  - `compare-wizard-claim.handler.spec.ts`
  - `compare-wizard-claim.controller.spec.ts`
  - plus the dedicated reconciliation controller-spec split batch used during route extraction
  - result: 5 suites passed, 17 tests passed
- `@lcsp/api build` passed after splitting:
  - `compare-wizard-claim.controller.ts`
  - `compare-wizard-claim.request.ts`
  - `compare-wizard-claim.registration.ts`
- `git diff --check` passed on the mixed worktree after the verification run

## Practical extraction proof

Verified again on Wednesday, August 12, 2026 in detached scratch worktree:

- scratch worktree: `/home/khovan/Workplaces/LCSP-candidate-4-detached`
- exact Candidate 4 file set copied from the mixed worktree
- shared-hunk cleanup applied:
  - `reconciliation.module.ts` retained only `COMPARE_WIZARD_CLAIM_CONTROLLERS` and `COMPARE_WIZARD_CLAIM_PROVIDERS`
  - `agentic-tool.ts` retained only AO-4 packet imports/spreads
  - `index.ts` retained only `ao4-agentic-evidence.ts` as the additional packet export
- focused suites passed after scratch bootstrap:
  - `compare-wizard-claim.handler.spec.ts`
  - `compare-wizard-claim.controller.spec.ts`
  - result: 2 suites passed, 7 tests passed
- detached `@lcsp/api build` bootstrap completed successfully after Prisma generation
- `git diff --check` passed in the detached worktree

## Remaining risks

Low, but explicit:

1. `reconciliation.module.ts` must be hunk-split carefully if another branch touches the same composition-root block.
2. `reconciliation.controller.spec.ts` should stay out unless broader support cleanup is intentionally accepted as issue-local blocker work.
3. `agentic-tool.ts` and `index.ts` must carry only AO-4 composition hunks.
4. Fresh detached verification still benefits from running `pnpm --filter @lcsp/api build` first so Prisma client is guaranteed before Jest.

## Recommended branch handoff

When creating the real extraction branch:

1. move the exact files above
2. hunk-split `reconciliation.module.ts`
3. hunk-split `agentic-tool.ts` and `index.ts`
4. run `pnpm --filter @lcsp/api build` once first in the fresh worktree so Prisma client exists
5. rerun the verification commands
6. keep unrelated reconciliation support specs out unless needed to keep the isolated branch green

If those checks pass, Candidate 4 is ready to become the isolated AO-4 compare-wizard-claim PR directly.
