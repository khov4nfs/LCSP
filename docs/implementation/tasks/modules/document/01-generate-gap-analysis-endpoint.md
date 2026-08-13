---
task_id: MW-doc-001
module: document
runtime: nestjs-api
priority: P1
status: READY_FOR_DEV
epic_story: 8.1
depends_on:
  - classification/02-classification-result-callback-endpoint.md
  - platform/pbac/03-nestjs-guard.md
  - platform/outbox/02-outbox-publisher.md
---

# Generate Gap Analysis Document

## Outcome

Allow a Manager to trigger GapAnalysis document generation from an accepted `ClassificationResult`. The GapAnalysis is generated asynchronously by the Python reporting worker. Request is queued via outbox. Never overclaims legal certainty or certification.

## Module Files

| File                                                                                                      | Action | Notes                                                    |
| --------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------- |
| `apps/api/src/modules/document/presentation/http/document.controller.ts`                                  | Create | `POST /assessments/:assessmentId/documents/gap-analysis` |
| `apps/api/src/modules/document/application/commands/request-gap-analysis/request-gap-analysis.command.ts` | Create | Command shape                                            |
| `apps/api/src/modules/document/application/commands/request-gap-analysis/request-gap-analysis.handler.ts` | Create | Gate check + outbox enqueue                              |
| `apps/api/prisma/schema.prisma`                                                                           | Modify | Add `DocumentRequest` model                              |
| `apps/api/src/modules/document/document.module.ts`                                                        | Create | NestJS module                                            |

## Prisma Model

```prisma
model DocumentRequest {
  id                   String   @id @default(uuid())
  assessmentId         String
  organizationId       String
  requestedById        String
  documentType         String                         // 'GapAnalysis' | 'FinalReport' | 'ReadinessExport'
  sourceArtifactId     String?                        // ClassificationResult.id or WizardProfile.id
  status               String   @default("QUEUED")   // QUEUED | GENERATING | READY | FAILED
  documentUrl          String?                        // Object storage URL when READY
  guardrailStatus      String?                        // 'passed' | 'blocked'
  blockedReason        String?
  requestedAt          DateTime @default(now())
  completedAt          DateTime?

  @@index([assessmentId, documentType])
}
```

## API Contract

**Endpoint:** `POST /assessments/:assessmentId/documents/gap-analysis`
**Auth required:** Yes — `@RequireAction('document:generate')`

**Request body:** Empty

**Success response (202):**

| Field                 | Type   | Notes         |
| --------------------- | ------ | ------------- |
| `document_request_id` | string |               |
| `status`              | string | `QUEUED`      |
| `document_type`       | string | `GapAnalysis` |
| `correlationId`       | string |               |

**Error responses:**

| HTTP | `error_code`              | Meaning                               |
| ---- | ------------------------- | ------------------------------------- |
| 403  | `PBAC_DENIED`             | Actor lacks `document:generate`       |
| 404  | `ASSESSMENT_NOT_FOUND`    |                                       |
| 409  | `CLASSIFICATION_REQUIRED` | No accepted `ClassificationResult`    |
| 409  | `DOCUMENT_ALREADY_QUEUED` | Existing QUEUED or GENERATING request |

## Business Rules

1. PBAC guard: `action = document:generate`.
2. Verify accepted `ClassificationResult` exists for assessment.
3. No existing `DocumentRequest` with `status IN (QUEUED, GENERATING)` for same assessment + type.
4. Create `DocumentRequest` with `status = QUEUED`, `documentType = GapAnalysis`.
5. Emit outbox `document.gap-analysis-requested` for reporting worker.
6. Reporting worker generates document asynchronously — response is 202 (not 201).
7. GapAnalysis must NOT contain `certified`, `compliant`, `validated`, `production ready` wording (enforced by reporting worker + output guardrail at callback).
8. Audit event `DOCUMENT_GAP_ANALYSIS_REQUESTED`.

## Commands / Events

| Name                                    | Type             | Safe payload                                                                              |
| --------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------- |
| `RequestGapAnalysisCommand`             | App command      | `{ assessmentId, organizationId, requestedById, classificationResultId, correlationId? }` |
| `event.document.gap-analysis-requested` | Outbox           | `{ documentRequestId, assessmentId, classificationResultId, correlationId }`              |
| `DOCUMENT_GAP_ANALYSIS_REQUESTED`       | `AuthAuditEvent` | `{ documentRequestId, assessmentId, correlationId }`                                      |

## Test Cases

| ID  | Scenario                                   | Expected                      |
| --- | ------------------------------------------ | ----------------------------- |
| T01 | Valid request with accepted classification | 202 QUEUED                    |
| T02 | No accepted classification                 | 409 `CLASSIFICATION_REQUIRED` |
| T03 | Existing QUEUED request                    | 409 `DOCUMENT_ALREADY_QUEUED` |
| T04 | Actor lacks `document:generate`            | 403 `PBAC_DENIED`             |
| T05 | Outbox event created                       | DB verified                   |
| T06 | Response is 202 (async)                    | HTTP status verified          |

## Definition of Done

- Gate: accepted `ClassificationResult` required.
- Idempotency: no duplicate QUEUED/GENERATING requests.
- 202 response (async generation).
- Outbox triggers reporting worker.
