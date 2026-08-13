---
task_id: MW-wiz-004
module: wizard
runtime: nestjs-api
priority: P1
status: READY_FOR_DEV
epic_story: 2.4
depends_on:
  - wizard/02-submit-wizard-endpoint.md
  - wizard/03-wizard-readiness-state-endpoint.md
  - platform/pbac/03-nestjs-guard.md
  - platform/audit-writer/02-audit-writer-service.md
---

# Wizard Readiness Export Endpoint

## Outcome

Generate and return a "Wizard Readiness Export" artifact for assessments where classification is locked (no accepted technical evidence). The export contains only preparation guidance and missing evidence checklist — no risk labels, no legal conclusions, no classification results.

## Module Files

| File                                                                                                              | Action | Notes                                                         |
| ----------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------- |
| `apps/api/src/modules/wizard/presentation/http/wizard.controller.ts`                                              | Modify | Add `POST /assessments/:assessmentId/wizard/readiness-export` |
| `apps/api/src/modules/wizard/application/commands/generate-readiness-export/generate-readiness-export.command.ts` | Create | Command shape                                                 |
| `apps/api/src/modules/wizard/application/commands/generate-readiness-export/generate-readiness-export.handler.ts` | Create | Export generation + guardrail check                           |
| `apps/api/src/modules/wizard/application/services/wizard/readiness-export-guardrail.service.ts`                   | Create | Output guardrail — blocks overclaim content                   |
| `apps/api/src/modules/wizard/domain/entities/readiness-export.entity.ts`                                          | Create | Immutable export artifact                                     |
| `apps/api/prisma/schema.prisma`                                                                                   | Modify | Add `ReadinessExport` model                                   |

## Prisma Model

```prisma
model ReadinessExport {
  id             String   @id @default(uuid())
  assessmentId   String
  organizationId String
  ownerId        String
  version        Int      @default(1)
  status         String   // 'GENERATED' | 'BLOCKED'
  contentJson    Json?                              // Sanitized export content
  blockedReason  String?
  generatedAt    DateTime @default(now())

  @@index([assessmentId])
}
```

## API Contract

**Endpoint:** `POST /assessments/:assessmentId/wizard/readiness-export`
**Auth required:** Yes — `@RequireAction('wizard:export')`

**Request body:** Empty (no body required)

**Success response (201):**

| Field                   | Type                  | Notes                                             |
| ----------------------- | --------------------- | ------------------------------------------------- |
| `export_id`             | string                |                                                   |
| `status`                | string                | `GENERATED` or `BLOCKED`                          |
| `label`                 | string                | Always `"Wizard Readiness Export"`                |
| `classification_locked` | boolean               | Always `true` (export only available when locked) |
| `missing_evidence`      | MissingEvidenceItem[] |                                                   |
| `preparation_guidance`  | string[]              | Business-language guidance items                  |
| `generated_at`          | string                | ISO 8601                                          |
| `version`               | number                |                                                   |
| `correlationId`         | string                |                                                   |

**Error responses:**

| HTTP | `error_code`                            | Meaning                                       |
| ---- | --------------------------------------- | --------------------------------------------- |
| 403  | `PBAC_DENIED`                           | Actor lacks `wizard:export`                   |
| 404  | `ASSESSMENT_NOT_FOUND`                  | Not found or not in org                       |
| 409  | `EXPORT_REQUIRES_LOCKED_CLASSIFICATION` | Evidence already accepted — export not needed |
| 422  | `WIZARD_NOT_SUBMITTED`                  | WizardProfile not yet submitted               |

## Business Rules

1. PBAC guard: `action = wizard:export`.
2. Verify assessment exists, org-scoped, wizard submitted.
3. If `classification_locked = false` (evidence already accepted) → `EXPORT_REQUIRES_LOCKED_CLASSIFICATION`.
4. Generate export content from WizardProfile answers + readiness state.
5. Run `ReadinessExportGuardrailService.check(content)`:
   - Detect any HIGH/MEDIUM/LOW, risk, severity, violation, non-compliant, certified, approved, legal conclusion wording.
   - If detected: set `status = BLOCKED`, `blockedReason = guardrail violation summary`. Store blocked record.
   - If clean: set `status = GENERATED`.
6. Export artifact is immutable once written — `ReadinessExport` rows are append-only.
7. Audit event `READINESS_EXPORT_GENERATED` or `READINESS_EXPORT_BLOCKED`.
8. Export must be labeled `Wizard Readiness Export` in all fields — never "final", "classification", "risk", "non-compliant".

## Commands / Events

| Name                             | Type             | Safe payload                                                 |
| -------------------------------- | ---------------- | ------------------------------------------------------------ |
| `GenerateReadinessExportCommand` | App command      | `{ assessmentId, organizationId, ownerId, correlationId? }`  |
| `READINESS_EXPORT_GENERATED`     | `AuthAuditEvent` | `{ exportId, assessmentId, status, version, correlationId }` |
| `READINESS_EXPORT_BLOCKED`       | `AuthAuditEvent` | `{ exportId, assessmentId, blockedReason, correlationId }`   |

## Test Cases

| ID  | Scenario                                       | Expected                                    |
| --- | ---------------------------------------------- | ------------------------------------------- |
| T01 | WizardProfile submitted, classification locked | 201 `status = GENERATED`                    |
| T02 | Evidence accepted (not locked)                 | 409 `EXPORT_REQUIRES_LOCKED_CLASSIFICATION` |
| T03 | WizardProfile not submitted                    | 422 `WIZARD_NOT_SUBMITTED`                  |
| T04 | Content contains risk label → guardrail fires  | `status = BLOCKED`, audit logged            |
| T05 | Export labeled `Wizard Readiness Export`       | `label` field verified                      |
| T06 | No HIGH/MEDIUM/LOW in export                   | Field inspection                            |
| T07 | Actor lacks `wizard:export`                    | 403 `PBAC_DENIED`                           |
| T08 | Export is immutable (new row per generation)   | New `ReadinessExport` row created each call |
| T09 | Audit event has no content                     | Clean payload                               |

## Definition of Done

- Export only generated when classification is locked.
- Guardrail blocks overclaim content (risk labels, legal conclusions).
- Export artifact immutable (append-only rows).
- Label always `Wizard Readiness Export` — never final/certification/risk wording.
- Audit event for both generated and blocked outcomes.
