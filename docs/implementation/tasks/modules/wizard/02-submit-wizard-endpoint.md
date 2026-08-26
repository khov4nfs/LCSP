---
task_id: MW-wiz-002
module: wizard
runtime: nestjs-api
priority: P0
status: READY_FOR_DEV
epic_story: 2.2
depends_on:
  - wizard/01-save-wizard-draft-endpoint.md
  - platform/outbox/02-outbox-publisher.md
---

# Submit Wizard Endpoint

## Outcome

Allow a Manager to submit a completed WizardProfile. All critical fields must be present and valid. On submission the WizardProfile becomes immutable, the assessment transitions to the next state, and a state-change event is emitted. Business-language validation messages only.

## Module Files

| File                                                                                      | Action | Notes                                                     |
| ----------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------- |
| `apps/api/src/modules/wizard/presentation/http/wizard.controller.ts`                      | Modify | Add `POST /assessments/:assessmentId/wizard/submit`       |
| `apps/api/src/modules/wizard/application/commands/submit-wizard/submit-wizard.command.ts` | Create | Command shape                                             |
| `apps/api/src/modules/wizard/application/commands/submit-wizard/submit-wizard.handler.ts` | Create | Validation + submission + assessment state transition     |
| `apps/api/src/modules/wizard/application/contracts/wizard/wizard-submit.contract.ts`      | Create | Request/response DTOs                                     |
| `apps/api/src/modules/wizard/application/services/wizard/wizard-validator.service.ts`     | Create | Critical-field validation with business-language messages |

## API Contract

**Endpoint:** `POST /assessments/:assessmentId/wizard/submit`
**Auth required:** Yes — `@RequireAction('wizard:submit')`

**Request body:**

| Field     | Type          | Required | Notes                        |
| --------- | ------------- | -------- | ---------------------------- |
| `answers` | WizardAnswers | Yes      | All critical fields required |

**Critical fields required for submission:**

`purpose`, `sector`, `data_type`, `user_group`, `user_impact`, `decision_role`, `human_oversight`, `external_llm_usage`

**Success response (200):**

| Field               | Type   | Notes                     |
| ------------------- | ------ | ------------------------- |
| `wizard_profile_id` | string |                           |
| `status`            | string | `SUBMITTED`               |
| `version`           | number | Final version             |
| `submitted_at`      | string | ISO 8601                  |
| `assessment_status` | string | Updated assessment status |
| `correlationId`     | string |                           |

**Error responses:**

| HTTP | `error_code`               | Meaning                                              |
| ---- | -------------------------- | ---------------------------------------------------- |
| 403  | `RBAC_DENIED`              | Actor lacks `wizard:submit`                          |
| 404  | `ASSESSMENT_NOT_FOUND`     | Assessment not found or not owned                    |
| 409  | `WIZARD_ALREADY_SUBMITTED` | Already submitted                                    |
| 422  | `WIZARD_VALIDATION_FAILED` | Missing critical fields — business-language messages |

## Prisma Models Used

| Model            | Action | Key fields                                                            |
| ---------------- | ------ | --------------------------------------------------------------------- |
| `WizardProfile`  | Update | `status = SUBMITTED`, `submittedAt = now()`                           |
| `Assessment`     | Update | `status` transition (e.g., `WIZARD_SUBMITTED` or `EVIDENCE_REQUIRED`) |
| `OutboxMessage`  | Create | `wizard.submitted` event for downstream                               |
| `AuthAuditEvent` | Create | `WIZARD_SUBMITTED`                                                    |

## Business Rules

1. RBAC guard: `action = wizard:submit`.
2. Verify assessment exists, org-scoped, owned by Manager.
3. If `WizardProfile.status = SUBMITTED` → `WIZARD_ALREADY_SUBMITTED`.
4. Validate all critical fields present and non-empty. Use business-language validation messages — no code-centric terms.
5. In a single DB transaction:
   - Update `WizardProfile.status = SUBMITTED`, `submittedAt = now()`.
   - Transition `Assessment.status` to `WIZARD_SUBMITTED` or next state per state machine.
   - Create outbox message `wizard.submitted`.
6. `WizardProfile.answers` is immutable after submission (no further edits allowed).
7. Audit event `WIZARD_SUBMITTED` — no answers content in payload.

**Business-language validation messages example:**

- Missing `purpose`: "Please describe the primary business purpose of your AI system."
- Missing `human_oversight`: "Please describe the human oversight mechanism in place."

## Commands / Events

| Name                     | Type             | Safe payload                                                                |
| ------------------------ | ---------------- | --------------------------------------------------------------------------- |
| `SubmitWizardCommand`    | App command      | `{ assessmentId, organizationId, ownerId, answers, correlationId? }`        |
| `event.wizard.submitted` | Outbox           | `{ assessmentId, wizardProfileId, version, organizationId, correlationId }` |
| `WIZARD_SUBMITTED`       | `AuthAuditEvent` | `{ assessmentId, wizardProfileId, version, correlationId }`                 |

## Test Cases

| ID  | Scenario                                         | Expected                                                  |
| --- | ------------------------------------------------ | --------------------------------------------------------- |
| T01 | All critical fields present                      | 200 `status = SUBMITTED`                                  |
| T02 | Missing `purpose`                                | 422 `WIZARD_VALIDATION_FAILED`, business-language message |
| T03 | Missing `human_oversight`                        | 422, business-language message                            |
| T04 | Already submitted                                | 409 `WIZARD_ALREADY_SUBMITTED`                            |
| T05 | Assessment not found                             | 404 `ASSESSMENT_NOT_FOUND`                                |
| T06 | Assessment state transitions on submit           | `Assessment.status` updated                               |
| T07 | Outbox message created                           | `event.wizard.submitted` in `OutboxMessage`               |
| T08 | Answers immutable after submit                   | Draft save rejected with `WIZARD_ALREADY_SUBMITTED`       |
| T09 | Validation messages have no risk/technical terms | Message content verified                                  |
| T10 | Audit payload has no answers content             | Clean payload                                             |

## Definition of Done

- All critical fields validated before commit.
- `WizardProfile.status = SUBMITTED` immutable after transaction.
- `Assessment.status` updated in same transaction.
- Outbox message `wizard.submitted` created.
- Validation messages are business-language only.
- Audit event has no answers content.
