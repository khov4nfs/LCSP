---
task_id: MW-doc-003
module: document
runtime: nestjs-api
priority: P1
status: REVIEW
epic_story: 7.3
depends_on:
  - document/01-generate-gap-analysis-endpoint.md
  - platform/pbac/03-nestjs-guard.md
---

# Get Document Status and Download Endpoint

## Outcome

Return status of a document request and, when ready, a signed download URL for the generated document artifact. Manager and scoped Developer can view status. Developer cannot download Manager-only documents. URLs are pre-signed and time-limited.

## Module Files

| File                                                                                       | Action | Notes                                                             |
| ------------------------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------- |
| `apps/api/src/modules/document/presentation/http/document.controller.ts`                   | Modify | Add `GET /assessments/:assessmentId/documents/:documentRequestId` |
| `apps/api/src/modules/document/application/queries/get-document/get-document.query.ts`     | Create | Query shape                                                       |
| `apps/api/src/modules/document/application/queries/get-document/get-document.handler.ts`   | Create | Status projection + signed URL generation                         |
| `apps/api/src/modules/document/application/contracts/document/document-status.contract.ts` | Create | Response DTO                                                      |
| `apps/api/src/modules/document/infrastructure/storage/document-storage.service.ts`         | Create | Object storage pre-signed URL generator                           |

## API Contract

**Endpoint:** `GET /assessments/:assessmentId/documents/:documentRequestId`
**Auth required:** Yes — `@RequireAction('document:read')`

**Success response (200):**

| Field                     | Type           | Notes                                                        |
| ------------------------- | -------------- | ------------------------------------------------------------ |
| `document_request_id`     | string         |                                                              |
| `document_type`           | string         | `GapAnalysis` \| `FinalReport` \| `ReadinessExport`          |
| `status`                  | string         | `QUEUED` \| `GENERATING` \| `READY` \| `FAILED` \| `BLOCKED` |
| `blocked_reason`          | string \| null | Business-language reason when blocked                        |
| `guardrail_status`        | string \| null | `passed` \| `degraded` \| `blocked`                          |
| `download_url`            | string \| null | Pre-signed URL (only when `status = READY`)                  |
| `download_url_expires_at` | string \| null | ISO 8601 (5-min TTL)                                         |
| `requested_at`            | string         | ISO 8601                                                     |
| `completed_at`            | string \| null | ISO 8601                                                     |
| `correlationId`           | string         |                                                              |

**Error responses:**

| HTTP | `error_code`         | Meaning                                                           |
| ---- | -------------------- | ----------------------------------------------------------------- |
| 403  | `PBAC_DENIED`        | Actor lacks `document:read` or developer accessing restricted doc |
| 404  | `DOCUMENT_NOT_FOUND` | Not found or not in org                                           |

## Business Rules

1. PBAC guard: `action = document:read`.
2. Org-scope guard on assessment.
3. When `status = READY`: generate pre-signed URL with 5-minute TTL via `DocumentStorageService`. URL is per-request (not stored).
4. When `status = BLOCKED`: include `blocked_reason` in business language (no implementation details).
5. `guardrail_status` reflects the output guardrail result.
6. Developer with `document:read:redacted` scope cannot download `FinalReport` type (Manager-only document).

## Prisma Models Used

| Model             | Action | Key fields                                                             |
| ----------------- | ------ | ---------------------------------------------------------------------- |
| `DocumentRequest` | Read   | `id`, `assessmentId`, `status`, `documentUrl`, `guardrailStatus`, etc. |

## Test Cases

| ID  | Scenario                              | Expected                                     |
| --- | ------------------------------------- | -------------------------------------------- |
| T01 | READY document                        | 200 with `download_url`                      |
| T02 | QUEUED document                       | 200 `download_url = null`                    |
| T03 | BLOCKED document                      | 200 with `blocked_reason`, no `download_url` |
| T04 | Download URL expires after 5 min      | URL TTL verified                             |
| T05 | Actor lacks `document:read`           | 403 `PBAC_DENIED`                            |
| T06 | Document not in org                   | 404 `DOCUMENT_NOT_FOUND`                     |
| T07 | Developer accessing FinalReport       | 403 `PBAC_DENIED`                            |
| T08 | `blocked_reason` is business language | No technical terms                           |

## Definition of Done

- Pre-signed URL generated per-request (5-min TTL) when status is READY.
- `blocked_reason` is business-language only.
- Developer access limited by PBAC (`document:read:redacted` scope).
- FinalReport download restricted to Manager.

## Dev Agent Record

### Debug Log References

- Unit: `rtk pnpm --filter @lcsp/api test --runTestsByPath src/modules/document/presentation/http/document.controller.spec.ts --runInBand`
- E2E: `rtk pnpm --filter @lcsp/api test:e2e --runInBand --runTestsByPath test/document-status.e2e-spec.ts`
- Repo blocker outside scope: `rtk pnpm exec tsc -p apps/api/tsconfig.json --noEmit` still fails in pre-existing `classification` and legacy `document` contract/type issues unrelated to MW-doc-003.

### Completion Notes

- Added protected `GET /assessments/:assessmentId/documents/:documentRequestId` status endpoint with PBAC support for both `document:read` and `document:read:redacted`.
- Added signed download proxy route `GET /assessments/:assessmentId/documents/:documentRequestId/download?token=...` backed by `DocumentStorageService` with 5-minute HMAC-signed URLs.
- Enforced assessment scope for redacted Developer reads and denied Manager-only `FinalReport` access for `document:read:redacted`.
- Sanitized technical blocked reasons into business-language messaging and projected `guardrail_status`, timestamps, and correlation id.
- Added end-to-end coverage for READY, QUEUED, BLOCKED, 5-minute TTL, PBAC deny, org isolation, redacted Developer deny on `FinalReport`, and redacted Developer allow on `GapAnalysis`.

### File List

- apps/api/src/modules/document/application/contracts/document/document-status.contract.ts
- apps/api/src/modules/document/application/queries/get-document/get-document.handler.ts
- apps/api/src/modules/document/application/queries/get-document/get-document.query.ts
- apps/api/src/modules/document/document.module.ts
- apps/api/src/modules/document/infrastructure/storage/document-storage.service.ts
- apps/api/src/modules/document/presentation/http/document.controller.spec.ts
- apps/api/src/modules/document/presentation/http/document.controller.ts
- apps/api/test/document-status.e2e-spec.ts
- docs/implementation/tasks/modules/document/03-get-document-status-endpoint.md
- packages/contracts/src/document/actions.ts
- packages/contracts/src/document/codes.ts
- packages/contracts/src/document/types.ts
- packages/contracts/src/pbac/actions.ts

### Change Log

- 2026-07-28: Implemented MW-doc-003 document status + signed download flow and moved task to review.
