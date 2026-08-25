---
task_id: MW-cls-002
module: classification
runtime: nestjs-api
priority: P0
status: DONE
epic_story: 7.5
depends_on:
  - classification/01-legal-rule-match-callback-endpoint.md
  - platform/outbox/02-outbox-publisher.md
---

# Classification Result Callback Endpoint

> Superseded in part: the legacy callback contract requiring `VerifiedProfile` plus `LegalRuleMatch` is no longer active. Direct EngineeringRule assessment persists classification results with legal-rule provenance, citation state and evidence refs.

## Dev Agent Record

- **Agent**: Amelia (Senior Software Engineer)
- **Status**: Completed
- **Date**: 2026-07-27
- **Key Implementation Details**:
  - Defined `ClassificationResult` Prisma model with `@unique` on `legalRuleMatchId`.
  - Added classification error codes, contract DTOs, `AcceptClassificationCommand`, and `AcceptClassificationHandler`.
  - Created `OverclaimGuardrailService` to check prohibited tokens (`certified`, `validated`, `approved`, `production ready`, `compliant`, `non-compliant`).
  - Added `POST /internal/classification/result-callback` endpoint guarded by `WorkerApiKeyGuard`.
  - Emitted `event.classification-result.ready.v1` outbox event and audit logs (`CLASSIFICATION_ACCEPTED` / `CLASSIFICATION_BLOCKED`).
  - Verified with 22 unit tests and 9 E2E tests passing 100%.

## Outcome

Receive the final classification result from the Python classification worker. Validate it references a `VerifiedProfile` plus a `LegalRuleMatch` (not the `verified-profile-ready` event directly). Apply citation guardrail: block or degrade output if citation basis is missing. Store immutable `ClassificationResult`. Emit event for document generation.

## Module Files

| File                                                                                                              | Action | Notes                                               |
| ----------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------- |
| `apps/api/src/modules/classification/presentation/http/classification.controller.ts`                              | Modify | Add `POST /internal/classification/result-callback` |
| `apps/api/src/modules/classification/application/commands/accept-classification/accept-classification.command.ts` | Create | Command shape                                       |
| `apps/api/src/modules/classification/application/commands/accept-classification/accept-classification.handler.ts` | Create | Validation + citation guardrail + persistence       |
| `apps/api/prisma/schema.prisma`                                                                                   | Modify | Add `ClassificationResult` model                    |

## Prisma Model

```prisma
model ClassificationResult {
  id                String   @id @default(uuid())
  legalRuleMatchId  String   @unique
  verifiedProfileId String
  assessmentId      String
  organizationId    String
  schemaVersion     String
  classificationData Json                             // Cited classification output
  guardrailStatus   String                            // 'passed' | 'degraded' | 'blocked'
  blockedReason     String?
  status            String   @default("accepted")    // 'accepted' | 'rejected'
  createdAt         DateTime @default(now())

  @@index([assessmentId])
}
```

## API Contract

**Endpoint:** `POST /internal/classification/result-callback`
**Auth:** `X-Worker-Api-Key`

**Request body:**

| Field                 | Type   | Required | Notes                                                 |
| --------------------- | ------ | -------- | ----------------------------------------------------- |
| `legal_rule_match_id` | string | Yes      | Must reference accepted `LegalRuleMatch`              |
| `verified_profile_id` | string | Yes      | Must reference accepted `VerifiedProfile`             |
| `assessment_id`       | string | Yes      |                                                       |
| `schema_version`      | string | Yes      |                                                       |
| `classification_data` | object | Yes      | Cited classification output                           |
| `guardrail_status`    | string | Yes      | `passed` \| `degraded` \| `blocked` (worker-assigned) |

**Success response (200):**

| Field                      | Type    | Notes |
| -------------------------- | ------- | ----- |
| `accepted`                 | boolean |       |
| `classification_result_id` | string  |       |
| `guardrail_status`         | string  |       |
| `correlationId`            | string  |       |

**Error responses:**

| HTTP | `error_code`                 | Meaning                                          |
| ---- | ---------------------------- | ------------------------------------------------ |
| 401  | `UNAUTHORIZED`               |                                                  |
| 404  | `LEGAL_RULE_MATCH_NOT_FOUND` |                                                  |
| 404  | `VERIFIED_PROFILE_NOT_FOUND` |                                                  |
| 409  | `RESULT_ALREADY_EXISTS`      | Already accepted for this match                  |
| 422  | `CLASSIFICATION_OVERCLAIM`   | `classification_data` contains overclaim wording |

## Business Rules

1. Auth: validate `X-Worker-Api-Key`.
2. Verify `legalRuleMatchId` references accepted `LegalRuleMatch` with `guardrailStatus = passed`.
3. Verify `verifiedProfileId` references accepted `VerifiedProfile`.
4. Classification must NOT have been triggered from `verified-profile-ready` event directly — must reference persisted `LegalRuleMatch` as a prerequisite.
5. Validate `classification_data` does not contain overclaim wording: `certified`, `validated`, `approved`, `production ready`, `compliant`, `non-compliant` (from output guardrail).
6. If overclaim detected → `CLASSIFICATION_OVERCLAIM` rejection.
7. Store `guardrail_status` as provided by worker (worker applies citation guardrail).
8. Create `ClassificationResult` (immutable).
9. Emit outbox `classification-result-ready` for document generation.
10. Audit event `CLASSIFICATION_ACCEPTED` or `CLASSIFICATION_BLOCKED`.

## Commands / Events

| Name                                | Type             | Safe payload                                                                                            |
| ----------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------- |
| `AcceptClassificationCommand`       | App command      | `{ legalRuleMatchId, verifiedProfileId, assessmentId, schemaVersion, guardrailStatus, correlationId? }` |
| `event.classification-result-ready` | Outbox           | `{ classificationResultId, assessmentId, guardrailStatus, correlationId }`                              |
| `CLASSIFICATION_ACCEPTED`           | `AuthAuditEvent` | `{ classificationResultId, assessmentId, guardrailStatus, correlationId }`                              |

## Test Cases

| ID  | Scenario                                                          | Expected                                        |
| --- | ----------------------------------------------------------------- | ----------------------------------------------- |
| T01 | Valid classification with citations                               | 200 `guardrail_status = passed`                 |
| T02 | `guardrail_status = degraded`                                     | 200 accepted with degraded status               |
| T03 | `guardrail_status = blocked`                                      | 200 accepted with blocked status                |
| T04 | `classification_data` contains `certified`                        | 422 `CLASSIFICATION_OVERCLAIM`                  |
| T05 | `LegalRuleMatch` has `guardrailStatus = blocked`                  | 422 or reject — classification must not proceed |
| T06 | Result already exists                                             | 409 `RESULT_ALREADY_EXISTS`                     |
| T07 | Outbox event emitted                                              | DB verified                                     |
| T08 | Classification triggered from `LegalRuleMatch` not from raw event | Verified by prerequisite check                  |

## Definition of Done

- Classification requires persisted `LegalRuleMatch` — no shortcut from `verified-profile-ready`.
- Overclaim wording detected and rejected.
- `guardrail_status` preserved exactly as provided by worker.
- Immutable once accepted.
- Outbox triggers document generation.
