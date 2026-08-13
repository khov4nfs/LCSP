---
task_id: MW-doc-002
module: document
runtime: nestjs-api
priority: P1
status: READY_FOR_DEV
epic_story: 8.3
depends_on:
  - document/01-generate-gap-analysis-endpoint.md
  - platform/pbac/03-nestjs-guard.md
---

# Generate Final Report Document

## Outcome

Allow a Manager to trigger final report generation. Final report requires accepted `ClassificationResult` with passed guardrail. Report must not overclaim legal certainty, certification, or compliance status. Asynchronously generated via Python reporting worker.

## Module Files

| File                                                                                                      | Action | Notes                                                        |
| --------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------ |
| `apps/api/src/modules/document/presentation/http/document.controller.ts`                                  | Modify | Add `POST /assessments/:assessmentId/documents/final-report` |
| `apps/api/src/modules/document/application/commands/request-final-report/request-final-report.command.ts` | Create | Command shape                                                |
| `apps/api/src/modules/document/application/commands/request-final-report/request-final-report.handler.ts` | Create | Gate check + outbox enqueue                                  |

## API Contract

**Endpoint:** `POST /assessments/:assessmentId/documents/final-report`
**Auth required:** Yes — `@RequireAction('document:generate')`

**Request body:** Empty

**Success response (202):**

| Field                 | Type   | Notes         |
| --------------------- | ------ | ------------- |
| `document_request_id` | string |               |
| `status`              | string | `QUEUED`      |
| `document_type`       | string | `FinalReport` |
| `correlationId`       | string |               |

**Error responses:**

| HTTP | `error_code`                          | Meaning                                         |
| ---- | ------------------------------------- | ----------------------------------------------- |
| 403  | `PBAC_DENIED`                         |                                                 |
| 404  | `ASSESSMENT_NOT_FOUND`                |                                                 |
| 409  | `CLASSIFICATION_GUARDRAIL_NOT_PASSED` | `ClassificationResult.guardrailStatus ≠ passed` |
| 409  | `DOCUMENT_ALREADY_QUEUED`             |                                                 |

## Business Rules

1. PBAC guard: `action = document:generate`.
2. Verify accepted `ClassificationResult` exists AND `guardrailStatus = passed`. If degraded or blocked → `CLASSIFICATION_GUARDRAIL_NOT_PASSED`.
3. No existing QUEUED/GENERATING `FinalReport` request.
4. Create `DocumentRequest` with `documentType = FinalReport`, `status = QUEUED`.
5. Emit outbox `document.final-report-requested`.
6. Output guardrail applied by reporting worker at callback: blocks `certified`, `validated`, `compliant`, `approved`.
7. Developer cannot request final report — Manager-only action (`document:generate` not in Developer policy).
8. Audit event `DOCUMENT_FINAL_REPORT_REQUESTED`.

## Commands / Events

| Name                                    | Type             | Safe payload                                                                              |
| --------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------- |
| `RequestFinalReportCommand`             | App command      | `{ assessmentId, organizationId, requestedById, classificationResultId, correlationId? }` |
| `event.document.final-report-requested` | Outbox           | `{ documentRequestId, assessmentId, classificationResultId, correlationId }`              |
| `DOCUMENT_FINAL_REPORT_REQUESTED`       | `AuthAuditEvent` | `{ documentRequestId, assessmentId, correlationId }`                                      |

## Test Cases

| ID  | Scenario                        | Expected                                  |
| --- | ------------------------------- | ----------------------------------------- |
| T01 | Classification passed guardrail | 202 QUEUED                                |
| T02 | Classification degraded         | 409 `CLASSIFICATION_GUARDRAIL_NOT_PASSED` |
| T03 | Classification blocked          | 409 `CLASSIFICATION_GUARDRAIL_NOT_PASSED` |
| T04 | Developer attempts request      | 403 `PBAC_DENIED`                         |
| T05 | Existing QUEUED request         | 409 `DOCUMENT_ALREADY_QUEUED`             |
| T06 | 202 response (async)            | HTTP status verified                      |

## Definition of Done

- Requires `ClassificationResult.guardrailStatus = passed` — degraded/blocked rejected.
- Manager-only action.
- 202 async response.
- Outbox triggers reporting worker.
