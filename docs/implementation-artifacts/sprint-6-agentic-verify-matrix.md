---
status: in-progress
updated_at: 2026-08-12
---

# Sprint 6 Agentic Verify Matrix

## Purpose

This artifact records the current verification state of the mixed Sprint 6 worktree on branch `feat/task-ao-3-03-resolve-independent-classification-review`.

## Companion runtime audit

- [sprint-6-tool-runtime-status.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/sprint-6-tool-runtime-status.md) — source-backed runtime coverage audit across the full Sprint 6 tool catalog.


It is not a release sign-off. It is a splitting and audit aid so the current mixed branch can be decomposed back into `1 branch = 1 issue = 1 PR`.

## Verified command evidence

- `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/lcsp_api_test?schema=public pnpm --filter @lcsp/api build`
  - Result: passed on 2026-08-12
- `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/lcsp_api_test?schema=public pnpm run typecheck`
  - Result: targeted Sprint 6 grep clean on 2026-08-12
- `pnpm run check:contracts`
  - Result: targeted Sprint 6 grep clean on 2026-08-12
- `pnpm --filter @lcsp/api test -- --runInBand --runTestsByPath ...`
  - Result: 35 suites passed, 136 tests passed on 2026-08-12 for the Sprint 6 + scan/outbox regression batch listed below
- `pnpm --filter @lcsp/api test -- --runInBand --runTestsByPath src/modules/reconciliation/presentation/http/reconciliation.controller.spec.ts src/modules/reconciliation/presentation/http/compare-wizard-claim.controller.spec.ts src/modules/reconciliation/application/queries/compare-wizard-claim/compare-wizard-claim.handler.spec.ts`
  - Result: 3 suites passed, 17 tests passed on 2026-08-12 after splitting `compare-wizard-claim` controller coverage into its own spec file
- `pnpm --filter @lcsp/api test -- --runInBand --runTestsByPath src/modules/reconciliation/presentation/http/reconciliation.controller.spec.ts src/modules/reconciliation/presentation/http/compare-wizard-claim.controller.spec.ts src/modules/reconciliation/presentation/http/get-artifact-chain.controller.spec.ts src/modules/reconciliation/presentation/http/get-reconciliation-context.controller.spec.ts src/modules/reconciliation/application/queries/compare-wizard-claim/compare-wizard-claim.handler.spec.ts`
  - Result: 5 suites passed, 17 tests passed on 2026-08-12 after splitting `getArtifactChain` and `getReconciliationContext` controller coverage into dedicated spec files
- `pnpm --filter @lcsp/api test -- --runInBand --runTestsByPath src/modules/reconciliation/presentation/http/reconciliation.controller.spec.ts src/modules/reconciliation/presentation/http/compare-wizard-claim.controller.spec.ts src/modules/reconciliation/presentation/http/get-artifact-chain.controller.spec.ts src/modules/reconciliation/presentation/http/get-reconciliation-context.controller.spec.ts src/modules/reconciliation/application/queries/compare-wizard-claim/compare-wizard-claim.handler.spec.ts`
  - Result: 5 suites passed, 17 tests passed on 2026-08-12 after extracting `compare_wizard_claim` into its own controller and request-parsing helper
- `pnpm --filter @lcsp/api test -- --runInBand --runTestsByPath src/modules/reconciliation/presentation/http/reconciliation.controller.spec.ts src/modules/reconciliation/presentation/http/compare-wizard-claim.controller.spec.ts src/modules/reconciliation/presentation/http/get-artifact-chain.controller.spec.ts src/modules/reconciliation/presentation/http/get-reconciliation-context.controller.spec.ts src/modules/reconciliation/application/queries/compare-wizard-claim/compare-wizard-claim.handler.spec.ts`
  - Result: 5 suites passed, 17 tests passed on 2026-08-12 after extracting AO-4 controller/handler module wiring into `compare-wizard-claim.registration.ts`
- `pnpm --filter @lcsp/api test -- --runInBand --runTestsByPath src/modules/classification/presentation/http/classification-review-resolution.controller.spec.ts src/modules/classification/presentation/http/gap-requirements.controller.spec.ts src/modules/classification/application/commands/resolve-classification-review/resolve-classification-review.handler.spec.ts src/modules/classification/application/queries/get-gap-requirements/get-gap-requirements.handler.spec.ts`
  - Result: 4 suites passed, 19 tests passed on 2026-08-12 after extracting AO-3 and AO-5 module wiring into dedicated registration files
- `pnpm --filter @lcsp/api test -- --runInBand --runTestsByPath src/modules/classification/presentation/http/classification-review-resolution.controller.spec.ts src/modules/classification/presentation/http/gap-requirements.controller.spec.ts src/modules/reconciliation/presentation/http/compare-wizard-claim.controller.spec.ts src/modules/reconciliation/application/queries/compare-wizard-claim/compare-wizard-claim.handler.spec.ts src/modules/scan/application/commands/request-targeted-reanalysis/request-targeted-reanalysis.handler.spec.ts`
  - Result: 5 suites passed, 14 tests passed on 2026-08-12 after moving AO-3, AO-4, and AO-5 shared contract/RBAC additions into issue-owned packet files
- `pnpm --filter @lcsp/api test -- --runInBand --runTestsByPath src/modules/scan/application/commands/request-targeted-reanalysis/request-targeted-reanalysis.handler.spec.ts src/modules/scan/application/commands/process-scan-callback/process-scan-callback.handler.spec.ts src/modules/scan/presentation/http/scan.controller.spec.ts src/modules/classification/application/commands/resolve-classification-review/resolve-classification-review.handler.spec.ts src/modules/classification/application/commands/submit-classification-review/submit-classification-review.handler.spec.ts`
  - Result: 5 suites passed, 29 tests passed on 2026-08-12 after splitting `packages/contracts/src/scan/callback.ts` into AO-3 and targeted-reanalysis packet files
- `pnpm run check:contracts`
  - Result: failed on 2026-08-12, but the reported literal violations were repo-wide pre-existing files outside the new Sprint 6 packet files; no violation was reported against:
    - `packages/contracts/src/evidence/agentic-tool-ao3.ts`
    - `packages/contracts/src/evidence/agentic-tool-ao4.ts`
    - `packages/contracts/src/evidence/agentic-tool-ao5.ts`
    - `packages/contracts/src/evidence/ao3-agentic-evidence.ts`
    - `packages/contracts/src/evidence/ao4-agentic-evidence.ts`
    - `packages/contracts/src/evidence/ao5-agentic-evidence.ts`
    - `packages/contracts/src/rbac/ao3-actions.ts`
    - `packages/contracts/src/rbac/ao5-actions.ts`
    - `packages/contracts/src/rbac/ao3-manager-policy.ts`
    - `packages/contracts/src/rbac/ao5-manager-policy.ts`
- `pnpm run check:contracts 2>&1 | rg 'packages/contracts/src/evidence/agentic-tool-ao|packages/contracts/src/evidence/ao[345]-agentic-evidence|packages/contracts/src/rbac/ao[35]-(actions|manager-policy)'`
  - Result: no matches on 2026-08-12, confirming the new AO-3/AO-4/AO-5 packet files were not named by the contract-literal checker output
- `pnpm --filter @lcsp/api test -- --runInBand --runTestsByPath src/modules/legal-rule-catalog/presentation/http/admin-source-catalog.controller.spec.ts src/modules/legal-rule-catalog/application/queries/get-admin-source-catalog/get-admin-source-catalog.handler.spec.ts`
  - Result: 2 suites passed, 5 tests passed on 2026-08-12 after implementing AO-6-01 `get_admin_source_catalog`
- `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/lcsp_api_test?schema=public pnpm --filter @lcsp/api build`
  - Result: passed on 2026-08-12 after wiring AO-6-01 contracts, handler, service, and controller

## Verified suite batch

### Classification / AO-3 / AO-5

- `src/modules/classification/application/commands/rerun-classification/rerun-classification.handler.spec.ts`
- `src/modules/classification/application/commands/resolve-classification-review/resolve-classification-review.handler.spec.ts`
- `src/modules/classification/application/commands/submit-classification-review/submit-classification-review.handler.spec.ts`
- `src/modules/classification/application/queries/evaluate-gap-matrix/evaluate-gap-matrix.handler.spec.ts`
- `src/modules/classification/application/queries/get-gap-evidence-trace/get-gap-evidence-trace.handler.spec.ts`
- `src/modules/classification/application/queries/get-gap-requirements/get-gap-requirements.handler.spec.ts`
- `src/modules/classification/application/queries/propose-gap-remediation/propose-gap-remediation.handler.spec.ts`
- `src/modules/classification/presentation/http/classification-review-resolution.controller.spec.ts`
- `src/modules/classification/presentation/http/gap-requirements.controller.spec.ts`

### Evidence / AO-2

- `src/modules/evidence/application/queries/find-provider-invocations/find-provider-invocations.handler.spec.ts`
- `src/modules/evidence/application/queries/find-similar-symbols/find-similar-symbols.handler.spec.ts`
- `src/modules/evidence/application/queries/get-evidence-subgraph/get-evidence-subgraph.handler.spec.ts`
- `src/modules/evidence/application/queries/get-finding-detail/get-finding-detail.handler.spec.ts`
- `src/modules/evidence/application/queries/get-scan-coverage/get-scan-coverage.handler.spec.ts`
- `src/modules/evidence/application/queries/get-symbol-context/get-symbol-context.handler.spec.ts`
- `src/modules/evidence/application/queries/inspect-data-path/inspect-data-path.handler.spec.ts`
- `src/modules/evidence/application/queries/inspect-decision-path/inspect-decision-path.handler.spec.ts`
- `src/modules/evidence/application/queries/inspect-deployment-context/inspect-deployment-context.handler.spec.ts`
- `src/modules/evidence/application/queries/inspect-human-review-path/inspect-human-review-path.handler.spec.ts`
- `src/modules/evidence/application/queries/search-evidence/search-evidence.handler.spec.ts`
- `src/modules/evidence/application/queries/trace-static-flow/trace-static-flow.handler.spec.ts`

### Reconciliation / AO-4

- `src/modules/reconciliation/application/commands/approve-verified-profile/approve-verified-profile.handler.spec.ts`
- `src/modules/reconciliation/application/commands/reconcile-profile-to-verified-profile/reconcile-profile-to-verified-profile.handler.spec.ts`
- `src/modules/reconciliation/application/queries/compare-wizard-claim/compare-wizard-claim.handler.spec.ts`
- `src/modules/reconciliation/presentation/http/compare-wizard-claim.controller.spec.ts`
- `src/modules/reconciliation/presentation/http/get-artifact-chain.controller.spec.ts`
- `src/modules/reconciliation/presentation/http/get-reconciliation-context.controller.spec.ts`
- `src/modules/reconciliation/application/queries/get-artifact-chain/get-artifact-chain.handler.spec.ts`
- `src/modules/reconciliation/application/queries/get-assessment-context/get-assessment-context.handler.spec.ts`
- `src/modules/reconciliation/application/queries/get-reconciliation-context/get-reconciliation-context.handler.spec.ts`
- `src/modules/reconciliation/application/queries/get-verified-profile/get-verified-profile.handler.spec.ts`
- `src/modules/reconciliation/application/queries/propose-missing-targets/propose-missing-targets.handler.spec.ts`
- `src/modules/reconciliation/presentation/http/reconciliation.controller.spec.ts`

### Scan / Outbox regression tied to targeted reanalysis

- `src/modules/scan/application/commands/request-targeted-reanalysis/request-targeted-reanalysis.handler.spec.ts`
- `src/modules/scan/application/commands/process-scan-callback/process-scan-callback.handler.spec.ts`
- `src/modules/scan/presentation/http/scan.controller.spec.ts`
- `src/platform/outbox/outbox.repository.spec.ts`
- `src/platform/outbox/outbox-publisher.service.spec.ts`

## Changed non-spec files and verification mode

| File | Verification mode | Notes |
| --- | --- | --- |
| `apps/api/src/modules/classification/application/commands/resolve-classification-review/resolve-classification-review.command.ts` | Indirect + handler spec | Constructor/input path exercised through handler spec. |
| `apps/api/src/modules/classification/application/commands/resolve-classification-review/resolve-classification-review.handler.ts` | Direct spec | Covered by `resolve-classification-review.handler.spec.ts`. |
| `apps/api/src/modules/classification/application/queries/evaluate-gap-matrix/evaluate-gap-matrix.handler.ts` | Direct spec | Covered by `evaluate-gap-matrix.handler.spec.ts`. |
| `apps/api/src/modules/classification/application/queries/get-gap-evidence-trace/get-gap-evidence-trace.handler.ts` | Direct spec | Covered by `get-gap-evidence-trace.handler.spec.ts`. |
| `apps/api/src/modules/classification/application/queries/get-gap-requirements/get-gap-requirements.handler.ts` | Direct spec | Covered by `get-gap-requirements.handler.spec.ts`. |
| `apps/api/src/modules/classification/application/queries/get-gap-requirements/get-gap-requirements.query.ts` | Indirect + handler spec | Query object exercised through handler spec. |
| `apps/api/src/modules/classification/application/queries/propose-gap-remediation/propose-gap-remediation.handler.ts` | Direct spec | Covered by `propose-gap-remediation.handler.spec.ts`. |
| `apps/api/src/modules/classification/classification-review-resolution.registration.ts` | Indirect build + focused AO-3/AO-5 suites | Registration file exercised through module compile path and focused controller/handler suites. |
| `apps/api/src/modules/classification/gap-requirements.registration.ts` | Indirect build + focused AO-3/AO-5 suites | Registration file exercised through module compile path and focused controller/handler suites. |
| `apps/api/src/modules/classification/presentation/http/classification-review-resolution.controller.ts` | Direct spec | Covered by controller spec. |
| `apps/api/src/modules/classification/presentation/http/gap-requirements.controller.ts` | Direct spec | Covered by controller spec. |
| `apps/api/src/modules/classification/classification.module.ts` | Indirect build verification + focused AO-3/AO-5 suites | No direct module spec; build/import wiring passed after registration-file refactor. |
| `apps/api/src/modules/reconciliation/application/contracts/reconciliation/wizard-claim-comparison.contract.ts` | Indirect build/typecheck | Contract wiring validated via handler/controller compile path. |
| `apps/api/src/modules/reconciliation/application/queries/compare-wizard-claim/compare-wizard-claim.handler.ts` | Direct spec | Covered by handler spec. |
| `apps/api/src/modules/reconciliation/application/queries/compare-wizard-claim/compare-wizard-claim.query.ts` | Indirect + handler spec | Query object exercised through handler spec. |
| `apps/api/src/modules/reconciliation/compare-wizard-claim.registration.ts` | Indirect build + focused reconciliation suites | Registration file exercised through module compile path and compare-wizard-claim controller/handler suites. |
| `apps/api/src/modules/reconciliation/presentation/http/compare-wizard-claim.controller.ts` | Direct spec | Covered by `compare-wizard-claim.controller.spec.ts`. |
| `apps/api/src/modules/reconciliation/presentation/http/compare-wizard-claim.request.ts` | Indirect + controller spec | Request parsing exercised through controller spec invalid-input cases. |
| `apps/api/src/modules/reconciliation/presentation/http/reconciliation.controller.ts` | Direct spec | Covered by `reconciliation.controller.spec.ts`, `get-artifact-chain.controller.spec.ts`, and `get-reconciliation-context.controller.spec.ts`. |
| `apps/api/src/modules/reconciliation/reconciliation.module.ts` | Indirect build verification | No direct module spec; build/import wiring passed. |
| `packages/contracts/src/scan/callback-ao3.ts` | Indirect build + focused scan/classification suites | AO-3 scan-event packet composed into `callback.ts`, exercised by classification review consumers. |
| `packages/contracts/src/scan/callback-targeted-reanalysis.ts` | Indirect build + focused scan/classification suites | Targeted-reanalysis scan-event packet composed into `callback.ts`, exercised by scan request/claim/callback consumers. |
| `apps/api/src/modules/scan/application/commands/request-targeted-reanalysis/request-targeted-reanalysis.handler.ts` | Direct spec + regression spec | Covered by handler spec plus scan/outbox regression suites. |
| `packages/contracts/src/evidence/agentic-tool-ao3.ts` | Indirect build + focused Sprint 6 suites | AO-3 packet composed into `agentic-tool.ts`, exercised by classification review consumers. |
| `packages/contracts/src/evidence/agentic-tool-ao4.ts` | Indirect build + focused Sprint 6 suites | AO-4 packet composed into `agentic-tool.ts`, exercised by compare-wizard-claim consumers. |
| `packages/contracts/src/evidence/agentic-tool-ao5.ts` | Indirect build + focused Sprint 6 suites | AO-5 packet composed into `agentic-tool.ts`, exercised by gap-requirements consumers. |
| `packages/contracts/src/evidence/ao3-agentic-evidence.ts` | Indirect build + focused Sprint 6 suites | AO-3 barrel packet exporting issue-owned contracts. |
| `packages/contracts/src/evidence/ao4-agentic-evidence.ts` | Indirect build + focused Sprint 6 suites | AO-4 barrel packet exporting issue-owned contracts. |
| `packages/contracts/src/evidence/ao5-agentic-evidence.ts` | Indirect build + focused Sprint 6 suites | AO-5 barrel packet exporting issue-owned contracts. |
| `packages/contracts/src/evidence/agentic-tool.ts` | Indirect typecheck/build/spec imports | Used by multiple handler/controller specs. |
| `packages/contracts/src/evidence/classification-review-resolution.ts` | Indirect typecheck/build/spec imports | Used by command/controller specs. |
| `packages/contracts/src/evidence/gap-requirements.ts` | Indirect typecheck/build/spec imports | Used by handler/controller specs. |
| `packages/contracts/src/evidence/index.ts` | Indirect typecheck/build | Barrel export verification only. |
| `packages/contracts/src/evidence/wizard-claim-comparison.ts` | Indirect typecheck/build/spec imports | Used by compare-wizard-claim path. |
| `packages/contracts/src/rbac/ao3-actions.ts` | Indirect build + focused Sprint 6 suites | AO-3 RBAC packet composed into `actions.ts`. |
| `packages/contracts/src/rbac/ao5-actions.ts` | Indirect build + focused Sprint 6 suites | AO-5 RBAC packet composed into `actions.ts`. |
| `packages/contracts/src/rbac/ao3-manager-policy.ts` | Indirect build + focused Sprint 6 suites | AO-3 manager-only packet composed into `manager-policy.ts`. |
| `packages/contracts/src/rbac/ao5-manager-policy.ts` | Indirect build + focused Sprint 6 suites | AO-5 manager-only packet composed into `manager-policy.ts`. |
| `packages/contracts/src/rbac/actions.ts` | Indirect typecheck/build/spec imports | Verified through controller/handler compile path. |
| `packages/contracts/src/rbac/manager-policy.ts` | Indirect typecheck/build/spec imports | Verified through controller/handler compile path. |
| `packages/contracts/src/scan/callback.ts` | Indirect typecheck/build/spec imports | Verified through scan/reconciliation/classification imports and tests. |

## Current issue buckets inside the mixed worktree

### AO-2

- Evidence query tool specs
- `packages/contracts/src/evidence/agentic-tool.ts`

### AO-3

- `request-targeted-reanalysis`
- `submit-classification-review`
- `resolve-classification-review`
- `rerun-classification` support spec updates

### AO-4

- `compare-wizard-claim`
- `propose-missing-targets`
- `get-assessment-context`
- `get-artifact-chain`
- `get-reconciliation-context`
- `get-verified-profile`
- `approve-verified-profile`
- `reconcile-profile-to-verified-profile`
- `reconciliation.controller.ts`
- `reconciliation.module.ts`

### AO-5

- `get-gap-requirements`
- `evaluate-gap-matrix`
- `get-gap-evidence-trace`
- `propose-gap-remediation`
- `classification.module.ts`

## Files still mixed across issue boundaries

These files must be split carefully when returning to `1 branch = 1 issue = 1 PR`:

- `packages/contracts/src/evidence/agentic-tool.ts`
- `packages/contracts/src/evidence/index.ts`
- `packages/contracts/src/rbac/actions.ts`
- `packages/contracts/src/rbac/manager-policy.ts`
- `packages/contracts/src/scan/callback.ts`
- `apps/api/src/modules/classification/classification.module.ts`
- `apps/api/src/modules/reconciliation/reconciliation.module.ts`

## Recommended PR split order from the current mixed branch

### Candidate 1: targeted reanalysis command path

Scope:

- `apps/api/src/modules/scan/application/commands/request-targeted-reanalysis/request-targeted-reanalysis.handler.ts`
- `apps/api/src/modules/scan/application/commands/request-targeted-reanalysis/request-targeted-reanalysis.handler.spec.ts`
- `apps/api/src/modules/scan/application/commands/process-scan-callback/process-scan-callback.handler.spec.ts`
- `apps/api/src/modules/scan/presentation/http/scan.controller.spec.ts`
- `packages/contracts/src/scan/callback.ts`

Why first:

- Has direct handler verification plus scan/outbox regression coverage.
- Contains the capacity, idempotency, checkpoint, and callback lifecycle work that other agentic flows depend on operationally.
- Detailed extraction handoff: [candidate-1-request-targeted-reanalysis-extraction-manifest.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/candidate-1-request-targeted-reanalysis-extraction-manifest.md)

Split caution:

- Avoid taking unrelated AO-3 classification-review files in the same PR.
- Avoid taking the current mixed changes in:
  - `packages/contracts/src/evidence/agentic-tool.ts`
  - `packages/contracts/src/evidence/index.ts`
  - `packages/contracts/src/rbac/actions.ts`
  - `packages/contracts/src/rbac/manager-policy.ts`
  because the current diff in those files is dominated by AO-3/AO-4/AO-5 additions unrelated to targeted reanalysis.

#### Candidate 1 exact changed-file set from the current mixed worktree

Include:

- `apps/api/src/modules/scan/application/commands/request-targeted-reanalysis/request-targeted-reanalysis.handler.ts`
- `apps/api/src/modules/scan/application/commands/request-targeted-reanalysis/request-targeted-reanalysis.handler.spec.ts`
- `apps/api/src/modules/scan/application/commands/process-scan-callback/process-scan-callback.handler.spec.ts`
- `apps/api/src/modules/scan/presentation/http/scan.controller.spec.ts`
- `packages/contracts/src/scan/callback-targeted-reanalysis.ts`
- `packages/contracts/src/scan/callback.ts`

Include minimal composition hunk only, not the full shared scan callback diff:

- `packages/contracts/src/scan/callback.ts`

Do not include from the current branch:

- `packages/contracts/src/evidence/agentic-tool.ts`
- `packages/contracts/src/evidence/index.ts`
- `packages/contracts/src/rbac/actions.ts`
- `packages/contracts/src/rbac/manager-policy.ts`
- `packages/contracts/src/scan/callback-ao3.ts`

Unchanged but functionally adjacent files that can stay out of the PR if they are not otherwise modified:

- `apps/api/src/modules/scan/presentation/http/scan.controller.ts`
- `apps/api/src/modules/scan/scan.module.ts`
- `apps/api/src/platform/outbox/outbox.repository.ts`
- `apps/api/src/platform/outbox/outbox-publisher.service.ts`

Reason:

- They already pass regression with the candidate's changed files.
- They are dependency-adjacent, but they are not changed in the current mixed worktree, so including them would widen the PR without adding needed deltas.
- `packages/contracts/src/scan/callback.ts` is now a thinner composition file for scan event packets, so Candidate 1 no longer needs to absorb AO-3 review event constants directly.

### Candidate 2: independent classification review resolution

Scope:

- `resolve-classification-review` command/handler/spec
- `classification-review-resolution.controller.ts`
- `classification-review-resolution.controller.spec.ts`
- `packages/contracts/src/evidence/classification-review-resolution.ts`

Why next:

- Clean business slice with direct handler and controller coverage.
- Operationally adjacent to AO-3 without requiring the broader reconciliation tree.
- Detailed extraction handoff: [candidate-2-independent-classification-review-resolution-extraction-manifest.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/candidate-2-independent-classification-review-resolution-extraction-manifest.md)

Split caution:

- Keep `submit-classification-review` out unless the issue explicitly includes both submit + resolve.
- `classification.module.ts` is currently a mixed wiring file that also adds AO-5 `get-gap-requirements` registrations, so Candidate 2 cannot be extracted cleanly by file selection alone.

#### Candidate 2 exact changed-file set from the current mixed worktree

Include:

- `apps/api/src/modules/classification/application/commands/resolve-classification-review/resolve-classification-review.command.ts`
- `apps/api/src/modules/classification/application/commands/resolve-classification-review/resolve-classification-review.handler.ts`
- `apps/api/src/modules/classification/application/commands/resolve-classification-review/resolve-classification-review.handler.spec.ts`
- `apps/api/src/modules/classification/classification-review-resolution.registration.ts`
- `apps/api/src/modules/classification/presentation/http/classification-review-resolution.controller.ts`
- `apps/api/src/modules/classification/presentation/http/classification-review-resolution.controller.spec.ts`
- `packages/contracts/src/evidence/agentic-tool-ao3.ts`
- `packages/contracts/src/evidence/ao3-agentic-evidence.ts`
- `packages/contracts/src/evidence/classification-review-resolution.ts`
- `packages/contracts/src/rbac/ao3-actions.ts`
- `packages/contracts/src/rbac/ao3-manager-policy.ts`

Conditionally include only if the issue is defined as "submit + resolve" together:

- `apps/api/src/modules/classification/application/commands/submit-classification-review/submit-classification-review.handler.spec.ts`

Include minimal composition hunks only, not the full mixed shared-file diff:

- `packages/contracts/src/evidence/agentic-tool.ts`
- `packages/contracts/src/evidence/index.ts`
- `packages/contracts/src/rbac/actions.ts`
- `packages/contracts/src/rbac/manager-policy.ts`

Mixed-file blocker:

- `apps/api/src/modules/classification/classification.module.ts`

Reason:

- The current diff in `classification.module.ts` combines:
  - Candidate 2 wiring:
    - `ResolveClassificationReviewHandler`
    - `ClassificationReviewResolutionController`
  - Candidate 3 wiring:
    - `GetGapRequirementsHandler`
    - `GapRequirementsController`

Current extraction options:

1. Preferred current state: keep `classification.module.ts` as a thin composition root and move issue-owned wiring into dedicated registration files.
2. Candidate 3 can now carry `gap-requirements.registration.ts` plus a minimal composition-root hunk.
3. Candidate 2 can now carry `classification-review-resolution.registration.ts` plus a minimal composition-root hunk.

#### Candidate 2 overlap with Candidate 1

Direct changed-file overlap:

- None

Shared-file/process overlap:

- Both candidates are in AO-3, but Candidate 1 currently touches scan/callback lifecycle files while Candidate 2 currently touches classification review files.
- The practical collision risk is not direct file overlap with Candidate 1; it is shared AO-3 sequencing and any future edits to cross-cutting contract barrels.
- The module-layer collision with Candidate 3 is now reduced to the composition-root import/spread lines in `classification.module.ts`; issue-owned wiring lives in dedicated registration files.

### Candidate 3: gap requirements and gap tool chain

Scope:

- `get-gap-requirements` query/handler/spec
- `gap-requirements.controller.ts`
- `gap-requirements.controller.spec.ts`
- `evaluate-gap-matrix.handler.ts/spec.ts`
- `get-gap-evidence-trace.handler.ts/spec.ts`
- `propose-gap-remediation.handler.ts/spec.ts`

Why next:

- Strong direct spec coverage across the whole gap chain.
- Natural AO-5 grouping for classification and remediation gates.
- Detailed extraction handoff: [candidate-3-gap-requirements-extraction-manifest.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/candidate-3-gap-requirements-extraction-manifest.md)

Split caution:

- `classification.module.ts` is shared wiring and must be handled carefully if AO-3 pieces are split separately first.

#### Candidate 3 exact changed-file set from the current mixed worktree

Include:

- `apps/api/src/modules/classification/application/queries/evaluate-gap-matrix/evaluate-gap-matrix.handler.ts`
- `apps/api/src/modules/classification/application/queries/evaluate-gap-matrix/evaluate-gap-matrix.handler.spec.ts`
- `apps/api/src/modules/classification/application/queries/get-gap-evidence-trace/get-gap-evidence-trace.handler.ts`
- `apps/api/src/modules/classification/application/queries/get-gap-evidence-trace/get-gap-evidence-trace.handler.spec.ts`
- `apps/api/src/modules/classification/application/queries/propose-gap-remediation/propose-gap-remediation.handler.ts`
- `apps/api/src/modules/classification/application/queries/propose-gap-remediation/propose-gap-remediation.handler.spec.ts`
- `apps/api/src/modules/classification/application/queries/get-gap-requirements/get-gap-requirements.handler.ts`
- `apps/api/src/modules/classification/application/queries/get-gap-requirements/get-gap-requirements.handler.spec.ts`
- `apps/api/src/modules/classification/application/queries/get-gap-requirements/get-gap-requirements.query.ts`
- `apps/api/src/modules/classification/gap-requirements.registration.ts`
- `apps/api/src/modules/classification/presentation/http/gap-requirements.controller.ts`
- `apps/api/src/modules/classification/presentation/http/gap-requirements.controller.spec.ts`
- `packages/contracts/src/evidence/agentic-tool-ao5.ts`
- `packages/contracts/src/evidence/ao5-agentic-evidence.ts`
- `packages/contracts/src/evidence/gap-requirements.ts`
- `packages/contracts/src/rbac/ao5-actions.ts`
- `packages/contracts/src/rbac/ao5-manager-policy.ts`

Include minimal composition hunks only, not the full mixed shared-file diff:

- `packages/contracts/src/evidence/agentic-tool.ts`
- `packages/contracts/src/evidence/index.ts`
- `packages/contracts/src/rbac/actions.ts`
- `packages/contracts/src/rbac/manager-policy.ts`

Conditionally include only if you are willing to patch-split mixed module wiring:

- `apps/api/src/modules/classification/classification.module.ts`

Mixed-file blocker:

- `apps/api/src/modules/classification/classification.module.ts`

Reason:

- The current diff in `classification.module.ts` combines:
  - Candidate 2 wiring:
    - `ResolveClassificationReviewHandler`
    - `ClassificationReviewResolutionController`
  - Candidate 3 wiring:
    - `GetGapRequirementsHandler`
    - `GapRequirementsController`

Current extraction options:

1. Preferred current state: Candidate 3 carries `gap-requirements.registration.ts` plus the minimal composition-root hunk in `classification.module.ts`.
2. Candidate 2 carries `classification-review-resolution.registration.ts` plus its minimal composition-root hunk.
3. If desired, Candidate 3 can still ship before Candidate 2 to minimize repeated edits to the composition root.

#### Candidate 3 overlap with Candidate 2

Direct changed-file overlap:

- `apps/api/src/modules/classification/classification.module.ts`

Shared-file/process overlap:

- Both candidates currently avoid touching the mixed barrel/permission files if split carefully.
- The real collision is module wiring, not handler/query/controller implementation files.

#### Recommended order between Candidate 2 and Candidate 3

Recommended:

1. Candidate 1: targeted reanalysis command path
2. Candidate 3: gap requirements and gap tool chain
3. Candidate 2: independent classification review resolution

Reason:

- Candidate 3 owns the larger AO-5 surface and already carries the natural `classification.module.ts` AO-5 additions.
- Candidate 2 is operationally smaller once AO-5 module churn is out of the way.
- The registration-file refactor reduces the amount of repeated churn required in `classification.module.ts`.
- Doing Candidate 3 first still minimizes repeated edits to the composition root; Candidate 2 can then add only the review-resolution wiring in a follow-up PR.

### Candidate 4: reconciliation and wizard verification tools

Scope:

- Core new production slice:
  - `compare-wizard-claim` query/handler/spec
  - `compare-wizard-claim.registration.ts`
  - `compare-wizard-claim.controller.ts`
  - `compare-wizard-claim.request.ts`
  - `compare-wizard-claim.controller.spec.ts`
  - `reconciliation.module.ts`
  - `packages/contracts/src/evidence/wizard-claim-comparison.ts`
- Already-existing reconciliation tool paths with touched support specs:
  - `get-assessment-context`
  - `get-artifact-chain`
  - `get-reconciliation-context`
  - `get-verified-profile`
  - `propose-missing-targets`
  - `approve-verified-profile`
  - `reconcile-profile-to-verified-profile`

Why later:

- Strongly verified, and the compare-wizard-claim route now has its own controller and spec.
- Remaining noise is mostly support cleanup around pre-existing reconciliation endpoints, not around the new AO-4 production path itself.
- Detailed extraction handoff: [candidate-4-compare-wizard-claim-extraction-manifest.md](/home/khovan/Workplaces/LCSP/docs/implementation-artifacts/candidate-4-compare-wizard-claim-extraction-manifest.md)

#### Candidate 4 exact changed-file set from the current mixed worktree

Include as the production delta for a `compare-wizard-claim` issue:

- `apps/api/src/modules/reconciliation/application/contracts/reconciliation/wizard-claim-comparison.contract.ts`
- `apps/api/src/modules/reconciliation/application/queries/compare-wizard-claim/compare-wizard-claim.query.ts`
- `apps/api/src/modules/reconciliation/application/queries/compare-wizard-claim/compare-wizard-claim.handler.ts`
- `apps/api/src/modules/reconciliation/application/queries/compare-wizard-claim/compare-wizard-claim.handler.spec.ts`
- `apps/api/src/modules/reconciliation/compare-wizard-claim.registration.ts`
- `apps/api/src/modules/reconciliation/presentation/http/compare-wizard-claim.controller.ts`
- `apps/api/src/modules/reconciliation/presentation/http/compare-wizard-claim.request.ts`
- `apps/api/src/modules/reconciliation/presentation/http/compare-wizard-claim.controller.spec.ts`
- `apps/api/src/modules/reconciliation/reconciliation.module.ts`
- `packages/contracts/src/evidence/agentic-tool-ao4.ts`
- `packages/contracts/src/evidence/ao4-agentic-evidence.ts`
- `packages/contracts/src/evidence/wizard-claim-comparison.ts`
- `packages/contracts/src/evidence/agentic-tool.ts`
- `packages/contracts/src/evidence/index.ts`

Conditionally include only if the issue branch intentionally carries broader endpoint-support cleanup:

- `apps/api/src/modules/reconciliation/presentation/http/reconciliation.controller.spec.ts`
- `apps/api/src/modules/reconciliation/presentation/http/get-artifact-chain.controller.spec.ts`
- `apps/api/src/modules/reconciliation/presentation/http/get-reconciliation-context.controller.spec.ts`

Do not treat these touched files as new AO-4 production scope by themselves:

- `apps/api/src/modules/reconciliation/application/commands/approve-verified-profile/approve-verified-profile.handler.spec.ts`
- `apps/api/src/modules/reconciliation/application/commands/reconcile-profile-to-verified-profile/reconcile-profile-to-verified-profile.handler.spec.ts`
- `apps/api/src/modules/reconciliation/application/queries/get-artifact-chain/get-artifact-chain.handler.spec.ts`
- `apps/api/src/modules/reconciliation/application/queries/get-assessment-context/get-assessment-context.handler.spec.ts`
- `apps/api/src/modules/reconciliation/application/queries/get-reconciliation-context/get-reconciliation-context.handler.spec.ts`
- `apps/api/src/modules/reconciliation/application/queries/get-verified-profile/get-verified-profile.handler.spec.ts`
- `apps/api/src/modules/reconciliation/application/queries/propose-missing-targets/propose-missing-targets.handler.spec.ts`
- `apps/api/src/modules/reconciliation/presentation/http/reconciliation.controller.ts`

Do not include from the current branch:

- `packages/contracts/src/rbac/actions.ts`
- `packages/contracts/src/rbac/manager-policy.ts`

Mixed-file blocker:

- `apps/api/src/modules/reconciliation/presentation/http/reconciliation.controller.spec.ts` is no longer required for the minimal `compare-wizard-claim` slice, but it remains mixed support cleanup if included.

Reason:

- `compare-wizard-claim.controller.ts` now owns the real AO-4 endpoint: `GET :assessmentId/wizard-claim-comparison`.
- `compare-wizard-claim.request.ts` owns the route-specific request parsing/validation.
- `compare-wizard-claim.registration.ts` owns the AO-4-specific controller/handler registration packet.
- `reconciliation.module.ts` is now a thinner composition root that spreads the AO-4 registration packet.
- `compare-wizard-claim.controller.spec.ts` carries the route-specific controller assertions for the new endpoint.
- `reconciliation.controller.spec.ts` still combines:
  - existing `getVerifiedProfile`, `getAssessmentContext`, and `proposeMissingTargets` coverage
  - shared helper cleanup (`queryBusWithResolvedValue`) that is not issue-specific
- `get-artifact-chain.controller.spec.ts` and `get-reconciliation-context.controller.spec.ts` now carry the two support endpoint assertions that previously lived in the mixed controller spec.

Current extraction options:

1. Preferred: keep `compare-wizard-claim.controller.ts`, `compare-wizard-claim.request.ts`, and `compare-wizard-claim.controller.spec.ts` in the AO-4 branch and leave `reconciliation.controller.ts` / `reconciliation.controller.spec.ts` for existing-endpoint ownership.
2. Keep `get-artifact-chain.controller.spec.ts` and `get-reconciliation-context.controller.spec.ts` with whichever issue explicitly owns those existing endpoints, not with the minimal AO-4 compare-wizard-claim branch.
3. Or explicitly classify the wider controller-spec cleanup as acceptable blocking-test work for the `compare-wizard-claim` issue.

#### Candidate 4 practical overlap

Direct changed-file overlap with other candidates:

- none in production handler/query files

Shared-file/process overlap:

- `packages/contracts/src/evidence/agentic-tool.ts` currently mixes AO-3, AO-4, and AO-5 tool-name/event additions.
- `packages/contracts/src/evidence/index.ts` currently mixes AO-3, AO-4, and AO-5 barrel exports.
- `packages/contracts/src/rbac/actions.ts` and `packages/contracts/src/rbac/manager-policy.ts` currently mix AO-3 and AO-5 permission additions; they do not yet carry an AO-4-specific delta in the current diff.

Recommended extraction rule:

- keep Candidate 4 focused on `compare-wizard-claim` production files first
- use `compare-wizard-claim.controller.spec.ts` as the default controller-test file for the isolated branch
- only absorb wider reconciliation spec cleanup if it is required to keep the endpoint tests green in the isolated branch
- carry only the AO-4 packet files plus the minimal `agentic-tool.ts` / `index.ts` composition hunks

### Candidate 5: AO-2 evidence query spec cleanup

Scope:

- Evidence query specs currently updated for typecheck/lint correctness

Why later:

- Current changes are mostly test-harness stabilization rather than new production logic.
- Useful to keep paired with whichever production issue actually owns the corresponding query behavior.

#### Candidate 5 exact changed-file set from the current mixed worktree

Current files are spec-only:

- `apps/api/src/modules/evidence/application/queries/find-provider-invocations/find-provider-invocations.handler.spec.ts`
- `apps/api/src/modules/evidence/application/queries/find-similar-symbols/find-similar-symbols.handler.spec.ts`
- `apps/api/src/modules/evidence/application/queries/get-evidence-subgraph/get-evidence-subgraph.handler.spec.ts`
- `apps/api/src/modules/evidence/application/queries/get-finding-detail/get-finding-detail.handler.spec.ts`
- `apps/api/src/modules/evidence/application/queries/get-scan-coverage/get-scan-coverage.handler.spec.ts`
- `apps/api/src/modules/evidence/application/queries/get-symbol-context/get-symbol-context.handler.spec.ts`
- `apps/api/src/modules/evidence/application/queries/inspect-data-path/inspect-data-path.handler.spec.ts`
- `apps/api/src/modules/evidence/application/queries/inspect-decision-path/inspect-decision-path.handler.spec.ts`
- `apps/api/src/modules/evidence/application/queries/inspect-deployment-context/inspect-deployment-context.handler.spec.ts`
- `apps/api/src/modules/evidence/application/queries/inspect-human-review-path/inspect-human-review-path.handler.spec.ts`
- `apps/api/src/modules/evidence/application/queries/search-evidence/search-evidence.handler.spec.ts`
- `apps/api/src/modules/evidence/application/queries/trace-static-flow/trace-static-flow.handler.spec.ts`

Interpretation:

- This is not a clean product-slice PR on its own.
- These files are best redistributed into the corresponding tool issue branches as typed-test support, not shipped as one standalone issue unless Jira explicitly creates a dedicated “AO-2 test harness cleanup” task.

#### Candidate 5 redistribution map by tool ownership

Each spec below should follow the production tool issue that owns the corresponding AO-2 packet:

| Spec file | Owning tool | Owning packet | Redistribution rule |
| --- | --- | --- | --- |
| `apps/api/src/modules/evidence/application/queries/get-scan-coverage/get-scan-coverage.handler.spec.ts` | `get_scan_coverage` | `docs/implementation/tasks/modules/agentic-evidence-tools/packets/ao-2-01-get-scan-coverage.md` | Carry with the `get_scan_coverage` issue branch; do not group under a generic AO-2 cleanup PR. |
| `apps/api/src/modules/evidence/application/queries/search-evidence/search-evidence.handler.spec.ts` | `search_evidence` | `docs/implementation/tasks/modules/agentic-evidence-tools/packets/ao-2-02-search-evidence.md` | Carry with the `search_evidence` issue branch. |
| `apps/api/src/modules/evidence/application/queries/get-finding-detail/get-finding-detail.handler.spec.ts` | `get_finding_detail` | `docs/implementation/tasks/modules/agentic-evidence-tools/packets/ao-2-03-get-finding-detail.md` | Carry with the `get_finding_detail` issue branch. |
| `apps/api/src/modules/evidence/application/queries/get-symbol-context/get-symbol-context.handler.spec.ts` | `get_symbol_context` | `docs/implementation/tasks/modules/agentic-evidence-tools/packets/ao-2-04-get-symbol-context.md` | Carry with the `get_symbol_context` issue branch. |
| `apps/api/src/modules/evidence/application/queries/get-evidence-subgraph/get-evidence-subgraph.handler.spec.ts` | `get_evidence_subgraph` | `docs/implementation/tasks/modules/agentic-evidence-tools/packets/ao-2-05-get-evidence-subgraph.md` | Carry with the `get_evidence_subgraph` issue branch. |
| `apps/api/src/modules/evidence/application/queries/trace-static-flow/trace-static-flow.handler.spec.ts` | `trace_static_flow` | `docs/implementation/tasks/modules/agentic-evidence-tools/packets/ao-2-06-trace-static-flow.md` | Carry with the `trace_static_flow` issue branch. |
| `apps/api/src/modules/evidence/application/queries/find-similar-symbols/find-similar-symbols.handler.spec.ts` | `find_similar_symbols` | `docs/implementation/tasks/modules/agentic-evidence-tools/packets/ao-2-07-find-similar-symbols.md` | Carry with the `find_similar_symbols` issue branch. |
| `apps/api/src/modules/evidence/application/queries/find-provider-invocations/find-provider-invocations.handler.spec.ts` | `find_provider_invocations` | `docs/implementation/tasks/modules/agentic-evidence-tools/packets/ao-2-08-find-provider-invocations.md` | Carry with the `find_provider_invocations` issue branch. |
| `apps/api/src/modules/evidence/application/queries/inspect-data-path/inspect-data-path.handler.spec.ts` | `inspect_data_path` | `docs/implementation/tasks/modules/agentic-evidence-tools/packets/ao-2-09-inspect-data-path.md` | Carry with the `inspect_data_path` issue branch. |
| `apps/api/src/modules/evidence/application/queries/inspect-decision-path/inspect-decision-path.handler.spec.ts` | `inspect_decision_path` | `docs/implementation/tasks/modules/agentic-evidence-tools/packets/ao-2-10-inspect-decision-path.md` | Carry with the `inspect_decision_path` issue branch. |
| `apps/api/src/modules/evidence/application/queries/inspect-human-review-path/inspect-human-review-path.handler.spec.ts` | `inspect_human_review_path` | `docs/implementation/tasks/modules/agentic-evidence-tools/packets/ao-2-11-inspect-human-review-path.md` | Carry with the `inspect_human_review_path` issue branch. |
| `apps/api/src/modules/evidence/application/queries/inspect-deployment-context/inspect-deployment-context.handler.spec.ts` | `inspect_deployment_context` | `docs/implementation/tasks/modules/agentic-evidence-tools/packets/ao-2-12-inspect-deployment-context.md` | Carry with the `inspect_deployment_context` issue branch. |

Operational rule:

- If a given AO-2 tool branch has no production diff left in the current mixed worktree, its spec file should still move with the Jira issue/tool branch that owns the packet, not be left behind in a shared cleanup branch.
- Only create a standalone AO-2 cleanup issue if Jira explicitly authorizes a non-product “test harness stabilization” task. Current evidence does not justify inventing that issue implicitly.

## Shared file split map

These files are not safe to move wholesale into a single issue branch from the current mixed worktree.

### `packages/contracts/src/evidence/agentic-tool.ts`

Current mixed additions:

- composition spreads for:
  - `AO4_AGENTIC_TOOL_NAMES`
  - `AO5_AGENTIC_TOOL_NAMES`
  - `AO3_AGENTIC_TOOL_NAMES`
  - `AO4_AGENTIC_TOOL_EVENT_TYPES`
  - `AO5_AGENTIC_TOOL_EVENT_TYPES`
  - `AO3_AGENTIC_TOOL_EVENT_TYPES`

Split rule:

- keep this file as thin composition only
- carry issue-owned packet files with the owning branch
- composition-root spread hunks should stay minimal and follow the packet file

### `packages/contracts/src/evidence/agentic-tool-ao3.ts`

Current owned additions:

- AO-3:
  - `resolveIndependentClassificationReview`
  - `classificationReviewResolved`

Split rule:

- candidate-local to AO-3 review resolution

### `packages/contracts/src/evidence/agentic-tool-ao4.ts`

Current owned additions:

- AO-4:
  - `compareWizardClaim`
  - `wizardClaimCompared`

Split rule:

- candidate-local to AO-4 compare-wizard-claim

### `packages/contracts/src/evidence/agentic-tool-ao5.ts`

Current owned additions:

- AO-5:
  - `getGapRequirements`
  - `gapRequirementsRead`

Split rule:

- candidate-local to AO-5 gap requirements

### `packages/contracts/src/evidence/index.ts`

Current mixed additions:

- composition exports for:
  - `./ao4-agentic-evidence.ts`
  - `./ao5-agentic-evidence.ts`
  - `./ao3-agentic-evidence.ts`

Split rule:

- keep this file as thin composition only
- issue-owned packet file should travel with the owning branch

### `packages/contracts/src/evidence/ao3-agentic-evidence.ts`

Current owned additions:

- AO-3:
  - `./classification-review-resolution.ts`

Split rule:

- candidate-local to AO-3 review resolution

### `packages/contracts/src/evidence/ao4-agentic-evidence.ts`

Current owned additions:

- AO-4:
  - `./wizard-claim-comparison.ts`

Split rule:

- candidate-local to AO-4 compare-wizard-claim

### `packages/contracts/src/evidence/ao5-agentic-evidence.ts`

Current owned additions:

- AO-5:
  - `./gap-requirements.ts`

Split rule:

- candidate-local to AO-5 gap requirements

### `packages/contracts/src/rbac/actions.ts`

Current mixed additions:

- composition spreads for:
  - `AO5_RBAC_ACTIONS`
  - `AO3_RBAC_ACTIONS`

Split rule:

- keep this file as thin composition only
- issue-owned RBAC packet should travel with the owning branch

### `packages/contracts/src/rbac/ao3-actions.ts`

Current owned additions:

- AO-3:
  - `classificationReviewResolve`

Split rule:

- candidate-local to AO-3 review resolution

### `packages/contracts/src/rbac/ao5-actions.ts`

Current owned additions:

- AO-5:
  - `gapRequirementsRead`

Split rule:

- candidate-local to AO-5 gap requirements

### `packages/contracts/src/rbac/manager-policy.ts`

Current mixed additions:

- composition spreads for:
  - `AO5_MANAGER_ONLY_ACTION_VALUES`
  - `AO3_MANAGER_ONLY_ACTION_VALUES`

Split rule:

- keep this file as thin composition only
- keep issue-owned manager-policy packet in lockstep with the matching RBAC action packet

### `packages/contracts/src/rbac/ao3-manager-policy.ts`

Current owned additions:

- AO-3:
  - `RBAC_ACTIONS.classificationReviewResolve`

Split rule:

- candidate-local to AO-3 review resolution

### `packages/contracts/src/rbac/ao5-manager-policy.ts`

Current owned additions:

- AO-5:
  - `RBAC_ACTIONS.gapRequirementsRead`

Split rule:

- candidate-local to AO-5 gap requirements

### `packages/contracts/src/scan/callback.ts`

Current mixed additions:

- composition spreads for:
  - `AO3_SCAN_EVENT_TYPES`
  - `TARGETED_REANALYSIS_SCAN_EVENT_TYPES`

Split rule:

- keep this file as thin composition only
- Candidate 1 should carry `callback-targeted-reanalysis.ts` plus the minimal composition hunk
- AO-3 review resolution should carry `callback-ao3.ts` plus the matching minimal composition hunk if needed

### `packages/contracts/src/scan/callback-ao3.ts`

Current owned additions:

- AO-3:
  - `classificationReviewRequested`
  - `classificationReviewResolved`
  - `classificationReviewRequestedAudit`
  - `classificationReviewResolvedAudit`

Split rule:

- candidate-local to AO-3 classification review submit/resolve flows

### `packages/contracts/src/scan/callback-targeted-reanalysis.ts`

Current owned additions:

- Candidate 1 / targeted reanalysis:
  - `targetedReanalysisQueuedAudit`
  - `targetedReanalysisRunningAudit`
  - `targetedReanalysisRetryAudit`
  - `targetedReanalysisTerminalAudit`

Split rule:

- candidate-local to Candidate 1 targeted reanalysis

### `apps/api/src/modules/classification/classification.module.ts`

Current mixed additions:

- composition-root imports/spreads for:
  - `CLASSIFICATION_REVIEW_RESOLUTION_CONTROLLERS`
  - `CLASSIFICATION_REVIEW_RESOLUTION_PROVIDERS`
  - `GAP_REQUIREMENTS_CONTROLLERS`
  - `GAP_REQUIREMENTS_PROVIDERS`

Split rule:

- keep this file as thin composition only
- Candidate 3 should carry `gap-requirements.registration.ts` plus the minimal module hunk first
- Candidate 2 should add `classification-review-resolution.registration.ts` plus its minimal module hunk afterward

### `apps/api/src/modules/classification/classification-review-resolution.registration.ts`

Current owned additions:

- AO-3:
  - `ClassificationReviewResolutionController`
  - `ResolveClassificationReviewHandler`

Split rule:

- candidate-local to AO-3 review resolution

### `apps/api/src/modules/classification/gap-requirements.registration.ts`

Current owned additions:

- AO-5:
  - `GapRequirementsController`
  - `GetGapRequirementsHandler`

Split rule:

- candidate-local to AO-5 gap requirements

### `apps/api/src/modules/reconciliation/reconciliation.module.ts`

Current mixed additions:

- composition-root spreads for:
  - `COMPARE_WIZARD_CLAIM_CONTROLLERS`
  - `COMPARE_WIZARD_CLAIM_PROVIDERS`

Split rule:

- keep this file as thin composition only
- Candidate 4 should carry `compare-wizard-claim.registration.ts` plus the minimal module hunk

### `apps/api/src/modules/reconciliation/compare-wizard-claim.registration.ts`

Current owned additions:

- AO-4:
  - `CompareWizardClaimController`
  - `CompareWizardClaimHandler`

Split rule:

- candidate-local to AO-4 compare-wizard-claim

## Remaining Sprint 6-specific blockers vs non-blockers

### True Sprint 6 split blockers still remaining

These items still require deliberate patch-splitting or issue-owned movement before the current mixed worktree can become `1 branch = 1 issue = 1 PR` again:

1. `apps/api/src/modules/classification/classification.module.ts`
   - Remaining reason: still carries composition-root hunks for both Candidate 2 and Candidate 3.
   - Safe path: Candidate 3 first with `gap-requirements.registration.ts`, then Candidate 2 with `classification-review-resolution.registration.ts`.

2. `packages/contracts/src/evidence/agentic-tool.ts`
   - Remaining reason: shared composition file still needs minimal hunk selection depending on whether the branch is AO-3, AO-4, or AO-5.
   - Safe path: take only the packet-specific spread lines that correspond to the owning issue.

3. `packages/contracts/src/evidence/index.ts`
   - Remaining reason: same composition-root issue as above for AO-3/AO-4/AO-5 contract packets.
   - Safe path: move only the relevant packet export line with the owning issue branch.

4. `packages/contracts/src/rbac/actions.ts`
   - Remaining reason: shared composition file for AO-3 and AO-5 RBAC packets.
   - Safe path: take only the minimal spread hunk required by the owning branch.

5. `packages/contracts/src/rbac/manager-policy.ts`
   - Remaining reason: shared composition file for AO-3 and AO-5 manager-only packets.
   - Safe path: keep in lockstep with `packages/contracts/src/rbac/actions.ts`.

6. `packages/contracts/src/scan/callback.ts`
   - Remaining reason: shared composition file for AO-3 classification-review events and Candidate 1 targeted-reanalysis events.
   - Safe path: Candidate 1 takes `callback-targeted-reanalysis.ts` plus the minimal composition hunk only.

7. `apps/api/src/modules/reconciliation/presentation/http/reconciliation.controller.spec.ts`
   - Remaining reason: still mixes support cleanup for existing endpoints even after the dedicated controller split.
   - Safe path: leave out of Candidate 4 unless the branch intentionally absorbs broader controller-spec cleanup.

### Not Sprint 6-specific blockers

These items should not be treated as blockers for splitting Sprint 6 issue branches:

1. Repo-wide `check:contracts` failures outside the new packet files
   - Evidence: the contract-literal checker did not name the new AO-3/AO-4/AO-5 packet files.
   - Interpretation: this is broader repo debt, not a regression introduced by the new Sprint 6 packetization work.

2. AO-2 spec-only files under Candidate 5
   - Interpretation: these are ownership-routing tasks, not architectural blockers.
   - Safe path: redistribute each spec into its owning tool issue branch per the Candidate 5 table above.

3. Existing reconciliation handler specs touched only for typed-test support
   - Affected examples:
     - `approve-verified-profile.handler.spec.ts`
     - `reconcile-profile-to-verified-profile.handler.spec.ts`
     - `get-artifact-chain.handler.spec.ts`
     - `get-assessment-context.handler.spec.ts`
     - `get-reconciliation-context.handler.spec.ts`
     - `get-verified-profile.handler.spec.ts`
     - `propose-missing-targets.handler.spec.ts`
   - Interpretation: these are not required production deltas for the minimal AO-4 `compare-wizard-claim` slice.

4. Dedicated controller specs for pre-existing endpoints
   - Affected files:
     - `get-artifact-chain.controller.spec.ts`
     - `get-reconciliation-context.controller.spec.ts`
   - Interpretation: these reduce mixedness in Candidate 4, but they are support cleanup for existing endpoints, not new production scope of `compare_wizard_claim`.

5. `apps/api/src/modules/reconciliation/presentation/http/reconciliation.controller.ts`
   - Interpretation: after extracting `compare_wizard_claim` into its own controller, this file is no longer part of the minimal AO-4 production slice.

### Recommended immediate next sequence from the current mixed worktree

1. Extract Candidate 1 (`request_targeted_reanalysis`) with its already-verified direct file set.
2. Extract Candidate 3 (`get_gap_requirements` + gap chain) using:
   - `gap-requirements.registration.ts`
   - AO-5 packet files
   - minimal composition hunks
3. Extract Candidate 2 (`resolve_independent_classification_review`) using:
   - `classification-review-resolution.registration.ts`
   - AO-3 packet files
   - remaining minimal composition hunks
4. Extract Candidate 4 (`compare_wizard_claim`) using:
   - `compare-wizard-claim.controller.spec.ts`
   - AO-4 packet files
   - minimal `agentic-tool.ts` / `index.ts` hunks
5. Redistribute Candidate 5 AO-2 specs into their owning tool branches instead of creating a generic cleanup PR.

## Not proven by this artifact

- No claim is made here that all Sprint 6 issues are complete.
- No Jira state transition, branch split, or PR packaging has been completed yet.
- This artifact proves only the current code verification state of the mixed worktree as of 2026-08-12.
