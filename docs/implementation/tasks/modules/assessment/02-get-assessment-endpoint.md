---
task_id: MW-asmt-002
module: assessment
runtime: nestjs-api
priority: P0
status: READY_FOR_DEV
epic_story: 2.3
depends_on:
  - assessment/01-create-assessment-endpoint.md
  - platform/pbac/03-nestjs-guard.md
---

# Get Assessment Endpoint

## Outcome

Return the full assessment state for a Manager or scoped Developer. Includes current status, WizardProfile completion state, readiness indicators, and next-action guidance. Never shows risk labels when classification is locked.

## Module Files

| File                                                                                             | Action | Notes                                   |
| ------------------------------------------------------------------------------------------------ | ------ | --------------------------------------- |
| `apps/api/src/modules/assessment/presentation/http/assessment.controller.ts`                     | Modify | Add `GET /assessments/:assessmentId`    |
| `apps/api/src/modules/assessment/application/queries/get-assessment/get-assessment.query.ts`     | Create | Query shape                             |
| `apps/api/src/modules/assessment/application/queries/get-assessment/get-assessment.handler.ts`   | Create | Projection logic + readiness evaluation |
| `apps/api/src/modules/assessment/application/contracts/assessment/assessment-detail.contract.ts` | Create | Response DTO                            |

## API Contract

**Endpoint:** `GET /assessments/:assessmentId`
**Auth required:** Yes — `@RequireAction('assessment:read')`

**Path parameters:**

| Param          | Type   | Required | Notes                      |
| -------------- | ------ | -------- | -------------------------- |
| `assessmentId` | string | Yes      | Must belong to session org |

**Success response (200):**

| Field             | Type   | Notes                                         |
| ----------------- | ------ | --------------------------------------------- |
| `assessment_id`   | string |                                               |
| `name`            | string |                                               |
| `status`          | string | Current assessment state                      |
| `owner_id`        | string |                                               |
| `organization_id` | string |                                               |
| `wizard_status`   | string | `NOT_STARTED` \| `IN_PROGRESS` \| `SUBMITTED` |
| `readiness_state` | object | See below                                     |
| `next_action`     | string | Business-language hint for Manager            |
| `created_at`      | string | ISO 8601                                      |
| `updated_at`      | string | ISO 8601                                      |
| `correlationId`   | string |                                               |

**`readiness_state` object:**

| Field                   | Type           | Notes                                       |
| ----------------------- | -------------- | ------------------------------------------- |
| `classification_locked` | boolean        | `true` when no accepted technical evidence  |
| `lock_reason`           | string \| null | `LOCKED_EVIDENCE_REQUIRED` or null          |
| `missing_evidence`      | string[]       | List of required-but-missing evidence types |

**Error responses:**

| HTTP | `error_code`           | Meaning                            |
| ---- | ---------------------- | ---------------------------------- |
| 403  | `PBAC_DENIED`          | Actor lacks `assessment:read`      |
| 404  | `ASSESSMENT_NOT_FOUND` | ID not found or not in session org |

## Prisma Models Used

| Model                     | Action | Key fields                                                   |
| ------------------------- | ------ | ------------------------------------------------------------ |
| `Assessment`              | Read   | All fields, verify `organizationId = session.organizationId` |
| `WizardProfile`           | Read   | `status`, `submittedAt` (for wizard_status)                  |
| `TechnicalEvidenceReport` | Read   | Existence check for accepted evidence                        |

## Business Rules

1. PBAC guard: `action = assessment:read`. Scoped Developer may have this action.
2. Verify `assessment.organizationId = session.organizationId`. If mismatch → `ASSESSMENT_NOT_FOUND`.
3. If Manager's `ownerId ≠ session.userId` and actor is Manager → `ASSESSMENT_NOT_FOUND` (Managers see own assessments only). Developer sees only if scope allows.
4. `classification_locked = true` when no accepted `TechnicalEvidenceReport` linked to assessment.
5. `lock_reason = LOCKED_EVIDENCE_REQUIRED` when classification locked.
6. `next_action` is a business-language string (never `HIGH/MEDIUM/LOW`, `risk`, `severity`, `violation`, `non-compliant`).
7. If `classification_locked = true`, response must NOT include any risk or classification label.

## Test Cases

| ID  | Scenario                                                   | Expected                                 |
| --- | ---------------------------------------------------------- | ---------------------------------------- |
| T01 | Manager reads own assessment                               | 200 with full state                      |
| T02 | No technical evidence → `classification_locked = true`     | `lock_reason = LOCKED_EVIDENCE_REQUIRED` |
| T03 | Accepted evidence exists → `classification_locked = false` | Lock reason null                         |
| T04 | Assessment not in session org                              | 404 `ASSESSMENT_NOT_FOUND`               |
| T05 | Manager lacks `assessment:read`                            | 403 `PBAC_DENIED`                        |
| T06 | Response has no risk/severity/non-compliant wording        | Verified by field inspection             |
| T07 | Developer with `assessment:read` scope                     | 200 with scoped projection               |
| T08 | `next_action` is business language                         | Verified by content                      |

## Definition of Done

- Assessment returned with correct org-scope guard.
- `classification_locked` accurate based on technical evidence existence.
- No risk labels in response when classification locked.
- `next_action` always business-language (no technical implementation terms).
