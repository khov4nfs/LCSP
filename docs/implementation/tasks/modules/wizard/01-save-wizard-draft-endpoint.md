---
task_id: MW-wiz-001
module: wizard
runtime: nestjs-api
priority: P0
status: READY_FOR_DEV
epic_story: 2.2
depends_on:
  - assessment/01-create-assessment-endpoint.md
  - platform/pbac/03-nestjs-guard.md
  - platform/audit-writer/02-audit-writer-service.md
---

# Save Wizard Draft Endpoint

## Outcome

Allow a Manager to save in-progress WizardProfile answers as a draft without submitting. Draft is versioned and preserves partial answers. No validation blocking on draft save. Business-language questions only.

## Module Files

| File                                                                                              | Action | Notes                                         |
| ------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------- |
| `apps/api/src/modules/wizard/presentation/http/wizard.controller.ts`                              | Create | `PUT /assessments/:assessmentId/wizard/draft` |
| `apps/api/src/modules/wizard/application/commands/save-wizard-draft/save-wizard-draft.command.ts` | Create | Command shape                                 |
| `apps/api/src/modules/wizard/application/commands/save-wizard-draft/save-wizard-draft.handler.ts` | Create | Draft upsert logic                            |
| `apps/api/src/modules/wizard/application/contracts/wizard/wizard-draft.contract.ts`               | Create | Request/response DTOs                         |
| `apps/api/src/modules/wizard/domain/entities/wizard-profile.entity.ts`                            | Create | `WizardProfile` domain entity                 |
| `apps/api/src/modules/wizard/application/ports/persistence/wizard-profile.repository.ts`          | Create | Port interface                                |
| `apps/api/src/modules/wizard/infrastructure/persistence/prisma-wizard.repository.ts`              | Create | Prisma implementation                         |
| `apps/api/src/modules/wizard/wizard.module.ts`                                                    | Create | NestJS module wiring                          |

## Prisma Model (new table)

```prisma
model WizardProfile {
  id             String   @id @default(uuid())
  assessmentId   String   @unique
  organizationId String
  ownerId        String
  version        Int      @default(1)
  status         String   @default("IN_PROGRESS")  // IN_PROGRESS | SUBMITTED
  answers        Json                               // Partial or complete WizardAnswers
  submittedAt    DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([assessmentId])
  @@index([organizationId])
}
```

## WizardAnswers Fields (in `answers` JSON)

| Field                   | Type     | Critical | Notes                                                |
| ----------------------- | -------- | -------- | ---------------------------------------------------- |
| `purpose`               | string   | Yes      | Business purpose of the AI system                    |
| `sector`                | string   | Yes      | Regulated sector (e.g., healthcare, finance, public) |
| `data_type`             | string[] | Yes      | Types of data processed                              |
| `user_group`            | string   | Yes      | Affected user group description                      |
| `user_impact`           | string   | Yes      | Impact nature on users                               |
| `decision_role`         | string   | Yes      | Whether system makes autonomous decisions            |
| `human_oversight`       | string   | Yes      | Human oversight mechanism description                |
| `external_llm_usage`    | boolean  | Yes      | Uses external LLM provider                           |
| `biometric_indicator`   | boolean  | No       | Uses biometric data                                  |
| `high_impact_indicator` | boolean  | No       | Critical infrastructure or safety context            |

## API Contract

**Endpoint:** `PUT /assessments/:assessmentId/wizard/draft`
**Auth required:** Yes — `@RequireAction('wizard:write')`

**Request body:**

| Field     | Type                  | Required | Notes                                        |
| --------- | --------------------- | -------- | -------------------------------------------- |
| `answers` | Partial WizardAnswers | Yes      | May be partial — no field required for draft |

**Success response (200):**

| Field               | Type   | Notes                     |
| ------------------- | ------ | ------------------------- |
| `wizard_profile_id` | string |                           |
| `status`            | string | `IN_PROGRESS`             |
| `version`           | number | Monotonically incremented |
| `updated_at`        | string | ISO 8601                  |
| `correlationId`     | string |                           |

**Error responses:**

| HTTP | `error_code`               | Meaning                             |
| ---- | -------------------------- | ----------------------------------- |
| 403  | `PBAC_DENIED`              | Actor lacks `wizard:write`          |
| 404  | `ASSESSMENT_NOT_FOUND`     | Assessment not found or not owned   |
| 409  | `WIZARD_ALREADY_SUBMITTED` | Cannot edit submitted WizardProfile |

## Business Rules

1. PBAC guard: `action = wizard:write`.
2. Verify assessment exists, `organizationId = session.organizationId`, `ownerId = session.userId`.
3. If `WizardProfile.status = SUBMITTED` → `WIZARD_ALREADY_SUBMITTED` (immutable after submit).
4. Upsert: create `WizardProfile` if not exists, or update `answers` and increment `version`.
5. No validation blocking on draft save — partial answers accepted.
6. Do NOT emit a state-change event on draft save (not a state transition). Log `WIZARD_DRAFT_SAVED` audit event only.

## Commands / Events

| Name                     | Type             | Safe payload                                                         |
| ------------------------ | ---------------- | -------------------------------------------------------------------- |
| `SaveWizardDraftCommand` | App command      | `{ assessmentId, organizationId, ownerId, answers, correlationId? }` |
| `WIZARD_DRAFT_SAVED`     | `AuthAuditEvent` | `{ assessmentId, wizardProfileId, version, correlationId }`          |

## Test Cases

| ID  | Scenario                                | Expected                       |
| --- | --------------------------------------- | ------------------------------ |
| T01 | Valid partial answers                   | 200, `status = IN_PROGRESS`    |
| T02 | All fields provided                     | 200, all saved                 |
| T03 | Re-save → version incremented           | `version` increases            |
| T04 | Already submitted                       | 409 `WIZARD_ALREADY_SUBMITTED` |
| T05 | Assessment not found                    | 404 `ASSESSMENT_NOT_FOUND`     |
| T06 | Actor lacks `wizard:write`              | 403 `PBAC_DENIED`              |
| T07 | Partial save preserves existing answers | Unset fields not nullified     |
| T08 | Answers not in audit payload            | Clean audit event              |

## Definition of Done

- Draft saved with partial answers accepted (no required-field validation).
- Version incremented on each save.
- Submitted WizardProfile rejected with `WIZARD_ALREADY_SUBMITTED`.
- Audit event written with no answer content.
