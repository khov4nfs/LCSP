---
task_id: MW-asmt-001
module: assessment
runtime: nestjs-api
priority: P0
status: READY_FOR_DEV
epic_story: 2.1
depends_on:
  - platform/pbac/03-nestjs-guard.md
  - platform/audit-writer/02-audit-writer-service.md
  - platform/outbox/02-outbox-publisher.md
---

# Create Assessment Endpoint

## Outcome

Allow an authenticated Manager to create a Manager-owned assessment in their organization. Assessment starts in `WIZARD_IN_PROGRESS` state. Audited. No Developer required.

## Module Files

| File                                                                                                  | Action | Notes                      |
| ----------------------------------------------------------------------------------------------------- | ------ | -------------------------- |
| `apps/api/src/modules/assessment/presentation/http/assessment.controller.ts`                          | Create | `POST /assessments`        |
| `apps/api/src/modules/assessment/application/commands/create-assessment/create-assessment.command.ts` | Create | Command shape              |
| `apps/api/src/modules/assessment/application/commands/create-assessment/create-assessment.handler.ts` | Create | Assessment creation logic  |
| `apps/api/src/modules/assessment/application/contracts/assessment/create-assessment.contract.ts`      | Create | Request/response DTOs      |
| `apps/api/src/modules/assessment/domain/entities/assessment.entity.ts`                                | Create | `Assessment` domain entity |
| `apps/api/src/modules/assessment/application/ports/persistence/assessment.repository.ts`              | Create | Port interface             |
| `apps/api/src/modules/assessment/infrastructure/persistence/prisma-assessment.repository.ts`          | Create | Prisma implementation      |
| `apps/api/src/modules/assessment/assessment.module.ts`                                                | Create | NestJS module wiring       |

## Prisma Model (new table)

```prisma
model Assessment {
  id             String   @id @default(uuid())
  organizationId String
  ownerId        String                            // Manager userId
  name           String
  description    String?
  status         String   @default("WIZARD_IN_PROGRESS")
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([organizationId, status])
  @@index([ownerId])
}
```

## API Contract

**Endpoint:** `POST /assessments`
**Auth required:** Yes — `@RequireAction('assessment:create')`

**Request body:**

| Field         | Type   | Required | Notes          |
| ------------- | ------ | -------- | -------------- |
| `name`        | string | Yes      | 1–200 chars    |
| `description` | string | No       | Max 1000 chars |

**Success response (201):**

| Field             | Type   | Notes                |
| ----------------- | ------ | -------------------- |
| `assessment_id`   | string |                      |
| `name`            | string |                      |
| `status`          | string | `WIZARD_IN_PROGRESS` |
| `owner_id`        | string | Manager userId       |
| `organization_id` | string |                      |
| `created_at`      | string | ISO 8601             |
| `correlationId`   | string |                      |

**Error responses:**

| HTTP | `error_code`      | Meaning                                |
| ---- | ----------------- | -------------------------------------- |
| 403  | `PBAC_DENIED`     | Manager lacks `assessment:create`      |
| 422  | `INVALID_REQUEST` | Missing `name` or over character limit |

## Business Rules

1. PBAC guard: `action = assessment:create`. Source of truth for authorization.
2. `ownerId = request.pbacContext.userId`.
3. `organizationId = request.pbacContext.organizationId`.
4. `status = WIZARD_IN_PROGRESS` on creation. No other state allowed at creation.
5. No Developer assignment required or allowed at creation.
6. Emit `ASSESSMENT_CREATED` audit event with assessment ID, org ID, owner ID. No name content in payload (may be PII).
7. Write outbox message `assessment.created` for downstream notification (optional in Phase 1 — log only if no consumer).

## Commands / Events

| Name                       | Type             | Safe payload                                                       |
| -------------------------- | ---------------- | ------------------------------------------------------------------ |
| `CreateAssessmentCommand`  | App command      | `{ organizationId, ownerId, name, description?, correlationId? }`  |
| `event.assessment.created` | Outbox           | `{ assessmentId, organizationId, ownerId, status, correlationId }` |
| `ASSESSMENT_CREATED`       | `AuthAuditEvent` | `{ assessmentId, organizationId, ownerId, correlationId }`         |

## PBAC

Manager must have `assessment:create` in their `AuthPolicy.actions`. Applied via `@RequireAction('assessment:create')`.

## Test Cases

| ID  | Scenario                                      | Expected                |
| --- | --------------------------------------------- | ----------------------- |
| T01 | Manager with `assessment:create` + valid name | 201, assessment created |
| T02 | Manager lacks `assessment:create`             | 403 `PBAC_DENIED`       |
| T03 | Missing `name`                                | 422 `INVALID_REQUEST`   |
| T04 | `status = WIZARD_IN_PROGRESS` in DB           | DB row verified         |
| T05 | `ownerId` = Manager's userId                  | DB row verified         |
| T06 | `organizationId` from session context         | DB row verified         |
| T07 | Audit event has no `name` content             | Clean payload           |
| T08 | No Developer assignment in response           | No developer fields     |

## Definition of Done

- Assessment created with `WIZARD_IN_PROGRESS` status, correct owner, org.
- PBAC guard enforced via `@RequireAction('assessment:create')`.
- `ASSESSMENT_CREATED` audit event written with no name/description in payload.
- No Developer required.
