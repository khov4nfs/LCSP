---
baseline_commit: 247f45fb5ab2487947398fb534aca6fc573cd76c
---

# Story 8.7 / LCSP-58: View and Export Assessment Provenance Audit Trail

Status: review

## Story

As an authorized customer or compliance auditor, I want to view and export the canonical assessment provenance audit trail, so that I can cryptographically verify and audit how the assessment result was produced without exposing private model reasoning, internal prompts, or sensitive tenant secrets.

## Acceptance Criteria

1. **Canonical Assessment-Scoped Source of Truth**:
   - The provenance trail is derived from canonical post-migration Assessment records (`Assessment`, `AssessmentCase`, `AssessmentRuntime`, `AssessmentEvent`, `AssessmentEvidence`, `AssessmentCaseFact`, `AssessmentRuleDecision`, `AssessmentHumanRequest`, `AssessmentArtifact`).
   - Generic admin-only audit events remain for internal platform accountability, but the customer assessment trail is authoritative and assessment-scoped.

2. **Strict Ownership and Multi-Tenant Isolation**:
   - Access to `/assessments/:assessmentId/provenance` and `/assessments/:assessmentId/provenance/download` requires customer ownership or admin role.
   - Cross-tenant or foreign assessment access fails closed with `404 Not Found` (`ASSESSMENT_NOT_FOUND`) to prevent identity enumeration.

3. **Cryptographic Integrity & Fail-Closed Validation**:
   - The provenance artifact complies with `ASSESSMENT_PROVENANCE_V1` schema and includes a deterministic SHA-256 checksum over the payload.
   - All references (facts, evidence, decisions, human resolutions, artifacts, runtime threads, and events) must resolve within the same assessment scope.
   - Mismatched or missing references fail closed with `409 Conflict` (`PROVENANCE_INTEGRITY_MISMATCH`).

4. **Privacy Protection & Verbatim Human Resolutions**:
   - Credentials, API keys, tokens, system/internal prompts, and private model reasoning/chain-of-thought are stripped or redacted.
   - Customer-provided human resolution answers and rationale are preserved verbatim.

5. **Customer Assessment UI & Export**:
   - Web application provides an assessment-scoped provenance view (`/assessments/:id/provenance`) displaying overview, cryptographic checksum badge, pinned foundations (repo commit and rule set version), runtime lineage, accepted facts/evidence, human resolutions, decisions, and event timeline.
   - Native export button downloads `assessment-{id}-provenance.json` with `ETag` and `Cache-Control: private, no-store`.
   - Action links added to assessment sidebar and report action molecules.

## Tasks / Subtasks

- [x] Define versioned `ASSESSMENT_PROVENANCE_V1` contract and Zod schema in `@lcsp/contracts` with deterministic SHA-256 checksum. (AC: 1, 3)
- [x] Add localized i18n keys for provenance views, actions, and verification badges in `@lcsp/i18n`. (AC: 5)
- [x] Implement `AssessmentProvenanceLoader` in `apps/api` with strict ownership checks, fail-closed reference validation, and sensitive payload redaction. (AC: 1, 2, 3, 4)
- [x] Implement `AssessmentProvenanceController` providing `GET /assessments/:id/provenance` and `GET /assessments/:id/provenance/download` with RBAC and audit logging. (AC: 2, 3, 5)
- [x] Implement Web BFF routes `/api/assessments/[id]/provenance` and `/api/assessments/[id]/provenance/download`. (AC: 2, 5)
- [x] Implement `useAssessmentProvenanceQuery` and customer-facing `AssessmentProvenanceView` organism in `apps/web`. (AC: 5)
- [x] Add provenance navigation links in `AssessmentReportActions` and `AssessmentContextPanel`. (AC: 5)
- [x] Create comprehensive backend unit/regression tests and frontend UI tests. (AC: 1, 2, 3, 4, 5)

## Dev Agent Record

### Agent Model Used

Claude 3.7 Sonnet / Antigravity Agent

### Verification Suites Passed

- `@lcsp/contracts`: build passed, schema validated.
- `@lcsp/i18n`: build passed, localization keys verified.
- `@lcsp/api`:
  - `src/modules/assessment/infrastructure/persistence/assessment-provenance.loader.spec.ts` (8 tests passed):
    - Valid canonical provenance artifact assembly and deterministic checksum.
    - Sensitive key, private reasoning, and prompt redaction.
    - Customer isolation / 404 on foreign assessment.
    - Admin access across owners.
    - Fail-closed reference checks (foreign fact, foreign evidence, missing evidence link, foreign decision, foreign human request, foreign event, mismatched thread ID).
  - `src/modules/assessment/presentation/http/assessment-provenance.controller.spec.ts` (3 tests passed):
    - GET JSON envelope and audit logging.
    - GET download file stream with ETag and export audit logging.
    - 422 validation on invalid UUID.
- `@lcsp/web`:
  - `tests/assessment-provenance-ui.test.tsx` (3 tests passed):
    - `AssessmentReportActions` renders View provenance link.
    - `AssessmentProvenanceView` loading state.
    - `AssessmentProvenanceView` populated view with cryptographic checksum, pins, lineage, facts, evidence, and human resolutions.

### File List

- `packages/contracts/src/assessment-domain/constants.ts`
- `packages/contracts/src/assessment-domain/schemas.ts`
- `packages/i18n/src/types.ts`
- `packages/i18n/src/locales/en/pages.ts`
- `packages/i18n/src/locales/vi/pages.ts`
- `apps/api/src/modules/assessment/infrastructure/persistence/assessment-provenance.loader.ts`
- `apps/api/src/modules/assessment/infrastructure/persistence/assessment-provenance.loader.spec.ts`
- `apps/api/src/modules/assessment/presentation/http/assessment-provenance.controller.ts`
- `apps/api/src/modules/assessment/presentation/http/assessment-provenance.controller.spec.ts`
- `apps/api/src/modules/assessment/assessment.module.ts`
- `apps/web/src/app/api/assessments/[id]/provenance/route.ts`
- `apps/web/src/app/api/assessments/[id]/provenance/download/route.ts`
- `apps/web/src/lib/api/assessment-domain-queries.ts`
- `apps/web/src/features/assessment-runtime/components/organisms/assessment-provenance-view.tsx`
- `apps/web/src/features/assessment-runtime/components/molecules/assessment-report-actions.tsx`
- `apps/web/src/features/assessment-runtime/components/organisms/assessment-context-panel.tsx`
- `apps/web/src/app/(workspace)/assessments/[id]/provenance/page.tsx`
- `apps/web/tests/assessment-provenance-ui.test.tsx`
- `docs/implementation-artifacts/8-7-view-and-export-redacted-audit-trail.md`

### Change Log

- 2026-10-17: Implemented the canonical post-migration LCSP-58 View and Export Assessment Provenance Audit Trail across contracts, backend loader/controller, web BFF proxy, TanStack query hooks, customer UI view, and test suites.
