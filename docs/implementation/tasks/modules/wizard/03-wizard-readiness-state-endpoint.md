---
task_id: MW-wiz-003
module: wizard
runtime: nestjs-api
priority: P0
status: READY_FOR_DEV
epic_story: 2.3
depends_on:
  - wizard/02-submit-wizard-endpoint.md
  - assessment/02-get-assessment-endpoint.md
---

# Wizard Readiness State Endpoint

## Outcome

Return the readiness state of an assessment when technical evidence is not yet available, whether or not WizardProfile has been submitted (WizardProfile is optional corroborating input, not a precondition for this endpoint or for classification unlock). Response shows missing evidence checklist and next-action guidance. Must not show risk labels, risk levels, or classification values when evidence is missing.

## Module Files

| File                                                                                     | Action | Notes                                             |
| ---------------------------------------------------------------------------------------- | ------ | ------------------------------------------------- |
| `apps/api/src/modules/wizard/presentation/http/wizard.controller.ts`                     | Modify | Add `GET /assessments/:assessmentId/readiness`    |
| `apps/api/src/modules/wizard/application/queries/get-readiness/get-readiness.query.ts`   | Create | Query shape                                       |
| `apps/api/src/modules/wizard/application/queries/get-readiness/get-readiness.handler.ts` | Create | Readiness projection logic                        |
| `apps/api/src/modules/wizard/application/contracts/wizard/readiness.contract.ts`         | Create | Response DTO                                      |
| `apps/api/src/modules/wizard/application/services/wizard/readiness-evaluator.service.ts` | Create | Evaluates evidence gates + produces readiness DTO |

## API Contract

**Endpoint:** `GET /assessments/:assessmentId/readiness`
**Auth required:** Yes — `@RequireAction('assessment:read')`

**Success response (200):**

| Field                   | Type                  | Notes                                                            |
| ----------------------- | --------------------- | ---------------------------------------------------------------- |
| `assessment_id`         | string                |                                                                  |
| `wizard_status`         | string                | `SUBMITTED` \| `IN_PROGRESS`                                     |
| `classification_locked` | boolean               | `true` if no accepted evidence                                   |
| `lock_reason`           | string \| null        | `LOCKED_EVIDENCE_REQUIRED`                                       |
| `missing_evidence`      | MissingEvidenceItem[] | See below                                                        |
| `completed_steps`       | string[]              | Steps completed (e.g., `wizard_profile`, `repository_connected`) |
| `next_action`           | string                | Business-language next step                                      |
| `updated_at`            | string                | ISO 8601                                                         |
| `correlationId`         | string                |                                                                  |

**`MissingEvidenceItem` object:**

| Field         | Type   | Notes                                               |
| ------------- | ------ | --------------------------------------------------- |
| `type`        | string | e.g., `technical_evidence`, `repository_connection` |
| `label`       | string | Business-language label                             |
| `description` | string | Business-language description                       |

**Error responses:**

| HTTP | `error_code`           | Meaning                       |
| ---- | ---------------------- | ----------------------------- |
| 403  | `RBAC_DENIED`          | Actor lacks `assessment:read` |
| 404  | `ASSESSMENT_NOT_FOUND` | Not found or not in org       |

## Prisma Models Used

| Model                     | Action | Key fields                            |
| ------------------------- | ------ | ------------------------------------- |
| `Assessment`              | Read   | `status`, `organizationId`            |
| `WizardProfile`           | Read   | `status`, `submittedAt`               |
| `RepositoryConnection`    | Read   | Existence check for connected repo    |
| `TechnicalEvidenceReport` | Read   | Existence check for accepted evidence |

## Business Rules

1. RBAC guard: `action = assessment:read`.
2. Org-scope guard: `assessment.organizationId = session.organizationId`.
3. `classification_locked = true` when no `TechnicalEvidenceReport` with accepted status exists for assessment. This gate is driven by technical evidence only; a missing/unsubmitted WizardProfile never sets `classification_locked = true` by itself.
4. `missing_evidence` derived by checking:
   - No `RepositoryConnection` for assessment → add `{ type: 'repository_connection', label: '...', description: '...' }`.
   - No accepted `TechnicalEvidenceReport` → add `{ type: 'technical_evidence', label: '...', description: '...' }`.
5. `next_action` is a business-language string. Never include `HIGH/MEDIUM/LOW`, `risk`, `severity`, `violation`, `non-compliant`.
6. If `classification_locked = true`: response must have no classification fields, risk fields, or RBAC policy content.

## Test Cases

| ID  | Scenario                                   | Expected                                                   |
| --- | ------------------------------------------ | ---------------------------------------------------------- |
| T01 | WizardProfile submitted, no evidence       | `classification_locked = true`, `LOCKED_EVIDENCE_REQUIRED` |
| T02 | WizardProfile submitted, evidence accepted | `classification_locked = false`                            |
| T03 | No repository connected                    | `missing_evidence` includes `repository_connection`        |
| T04 | Repository connected, no evidence          | `missing_evidence` includes `technical_evidence`           |
| T05 | Response has no risk labels when locked    | Verified by field inspection                               |
| T06 | `next_action` is business language         | No technical/risk terms                                    |
| T07 | Assessment not in org                      | 404 `ASSESSMENT_NOT_FOUND`                                 |

## Definition of Done

- `classification_locked` accurate based on evidence existence.
- `missing_evidence` list accurate per gate checks.
- No risk/severity/classification labels in response when locked.
- `next_action` always business-language.
