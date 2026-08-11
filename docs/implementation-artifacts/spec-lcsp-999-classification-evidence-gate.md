---
title: 'LCSP-999 Classification evidence gate projection'
type: 'bugfix'
created: '2026-08-10'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'a7cec0acaf02c24923a1612355af28e767c513c6'
context:
  - '{project-root}/docs/project-context.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** A completed scan now creates an accepted `TechnicalEvidenceReport` and an accepted `TechnicalProfile`, but the assessment projection always reports that classification is locked because technical evidence is missing. The UI consumes this stale projection and blocks the classification path even though the asynchronous evidence chain completed successfully.

**Approach:** Make the assessment detail query derive `readiness_state` from the same persisted accepted-evidence condition used by the readiness query. Preserve the lock when no accepted evidence exists; remove only the false technical-evidence lock once the report is accepted.

## Boundaries & Constraints

**Always:** Query only `TechnicalEvidenceReport` rows for the requested assessment with the canonical accepted status. Keep organization and owner authorization behavior unchanged. Use shared contract values and Prisma mapper helpers at the persistence boundary. Preserve the API result envelope and audit/state-machine constraints.

**Ask First:** Changes to the classification state machine, worker queue choreography, database schema, or customer-facing translation copy.

**Never:** Treat a scan callback, a technical profile alone, or an unaccepted/failed evidence report as sufficient evidence. Do not alter the real classification guard, fabricate evidence, mutate evidence history, or change PBAC policy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Accepted evidence | Assessment has one accepted `TechnicalEvidenceReport` | `GET /assessments/:id` reports `classification_locked: false`; no technical-evidence missing item | Normal 200 envelope |
| No accepted evidence | Assessment has no report or only non-accepted reports | Response remains locked with canonical technical-evidence missing reason | Normal 200 envelope |
| Unauthorized assessment | Org or manager ownership does not match | Existing not-found behavior remains | Existing problem envelope |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/assessment/application/queries/get-assessment/get-assessment.handler.ts` -- produces the stale, hard-coded assessment readiness projection.
- `apps/api/src/modules/wizard/application/queries/get-readiness/get-readiness.handler.ts` -- reference implementation for accepted evidence lookup and canonical status mapping.
- `apps/api/test/assessment-get.e2e-spec.ts` -- HTTP-level regression coverage for assessment detail projection.
- `packages/contracts/src/assessment/readiness.ts` -- canonical missing-evidence and lock-reason values.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/modules/assessment/application/queries/get-assessment/get-assessment.handler.ts` -- replace the legacy unconditional readiness object with an accepted-evidence lookup and canonical readiness mapping -- aligns the UI projection with persisted evidence.
- [x] `apps/api/test/assessment-get.e2e-spec.ts` -- seed an accepted evidence report and assert the assessment detail response is unlocked; retain/extend the missing-evidence regression -- prevents stale hard-coded state from returning.

**Acceptance Criteria:**
- Given an assessment with a scan callback that produced accepted technical evidence, when its detail endpoint is read, then its readiness state does not claim technical evidence is missing or lock classification for that reason.
- Given an assessment without accepted technical evidence, when its detail endpoint is read, then it remains locked with the canonical missing-evidence reason.
- Given an assessment outside the requester's authorized scope, when its detail endpoint is read, then the existing not-found problem behavior remains unchanged.

## Design Notes

The detail endpoint is a projection, not the authority for executing classification. It should therefore mirror the durable evidence condition rather than infer downstream workflow completion. This corrects the misleading UI state while leaving the verified-profile and legal-citation gates intact.

## Verification

**Commands:**
- `pnpm --filter @lcsp/api test -- assessment-get.e2e-spec.ts --runInBand` -- expected: accepted and missing evidence projection cases pass.
- `pnpm --filter @lcsp/api build` -- expected: API TypeScript build succeeds.

## Suggested Review Order

**Evidence projection**
- Verify the accepted evidence lookup and canonical locked fallback.
  [`get-assessment.handler.ts:63`](../../apps/api/src/modules/assessment/application/queries/get-assessment/get-assessment.handler.ts#L63)
- Verify absent, rejected, and accepted report scenarios at the HTTP boundary.
  [`assessment-get.e2e-spec.ts:145`](../../apps/api/test/assessment-get.e2e-spec.ts#L145)

**Legal source delivery**
- Verify the two document records and source-page risk chunk manifest.
  [`legal-documents.ts:14`](../../apps/web/src/features/legal-library/config/legal-documents.ts#L14)
- Verify protected delivery of the original PDF bytes.
  [`file/route.ts:9`](../../apps/web/src/app/(workspace)/laws/[lawId]/file/route.ts#L9)
- Verify the library actions and HIGH, MEDIUM, LOW risk table presentation.
  [`legal-library-page.tsx:69`](../../apps/web/src/features/legal-library/components/organisms/legal-library-page.tsx#L69)

**Deployment assets**
- Verify both legal PDFs are retained in the web image and PM2 runtime can locate them.
  [`.dockerignore:17`](../../.dockerignore#L17), [`Dockerfile:17`](../../apps/web/Dockerfile#L17), [`ecosystem.config.cjs:100`](../../ecosystem.config.cjs#L100)
