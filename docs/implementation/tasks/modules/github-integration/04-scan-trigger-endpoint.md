---
task_id: MW-gh-004
module: github-integration
runtime: nestjs-api
priority: P0
status: DONE
epic_story: 3.3
depends_on:
  - github-integration/03-pin-commit-snapshot-endpoint.md
  - platform/outbox/02-outbox-publisher.md
  - platform/rbac/03-nestjs-guard.md
---

# Scan Trigger Endpoint

## Outcome

Create or resume a `RepositoryScanJob` for a pinned snapshot. Idempotent: duplicate trigger returns existing job state. Assessment state gates prevent triggering from invalid states. Trusted trigger and manual trigger both handled.

## Module Files

| File                                                                                                | Action | Notes                                           |
| --------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------- |
| `apps/api/src/modules/github-integration/presentation/http/github-integration.controller.ts`        | Modify | Add `POST /assessments/:assessmentId/scan-jobs` |
| `apps/api/src/modules/github-integration/application/commands/trigger-scan/trigger-scan.command.ts` | Create | Command shape                                   |
| `apps/api/src/modules/github-integration/application/commands/trigger-scan/trigger-scan.handler.ts` | Create | Idempotency + job creation                      |
| `apps/api/src/modules/github-integration/domain/entities/repository-scan-job.entity.ts`             | Create | `RepositoryScanJob` domain entity               |
| `apps/api/prisma/schema.prisma`                                                                     | Modify | Add `RepositoryScanJob` model                   |

## Prisma Model

```prisma
model RepositoryScanJob {
  id              String   @id @default(uuid())
  assessmentId    String
  snapshotId      String
  organizationId  String
  idempotencyKey  String   @unique
  triggerSource   String                         // 'trusted' | 'manual'
  status          String   @default("QUEUED")   // QUEUED | RUNNING | COMPLETED | FAILED | BLOCKED
  attemptCount    Int      @default(0)
  correlationId   String
  blockedReason   String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([assessmentId])
  @@index([snapshotId])
}
```

## API Contract

**Endpoint:** `POST /assessments/:assessmentId/scan-jobs`
**Auth required:** Yes — `@RequireAction('scan:trigger')` for manual; trusted triggers use `X-Worker-Api-Key`

**Request body:**

| Field             | Type   | Required | Notes                                |
| ----------------- | ------ | -------- | ------------------------------------ |
| `snapshot_id`     | string | Yes      | `RepositorySnapshot.id`              |
| `trigger_source`  | string | No       | `manual` (default) or `trusted`      |
| `idempotency_key` | string | Yes      | Client-provided unique key for dedup |

**Success response (201 or 200):**

| Field           | Type    | Notes                                               |
| --------------- | ------- | --------------------------------------------------- |
| `scan_job_id`   | string  |                                                     |
| `status`        | string  | `QUEUED` or existing state if idempotent return     |
| `is_new`        | boolean | `true` if created, `false` if existing job returned |
| `correlationId` | string  |                                                     |

**Error responses:**

| HTTP | `error_code`               | Meaning                              |
| ---- | -------------------------- | ------------------------------------ |
| 403  | `RBAC_DENIED`              | Actor lacks `scan:trigger`           |
| 404  | `SNAPSHOT_NOT_FOUND`       | Snapshot not found or not in org     |
| 409  | `ASSESSMENT_STATE_INVALID` | Assessment state does not allow scan |
| 400  | `SCAN_BLOCKED_MAPPING`     | Assessment context incomplete        |

## Business Rules

1. RBAC guard: `action = scan:trigger` for manual triggers. Trusted triggers use `X-Worker-Api-Key`.
2. Validate `snapshot.assessmentId = pathParam.assessmentId` and org-scoped.
3. Validate `Assessment.status` permits scan trigger (e.g., `WIZARD_SUBMITTED` state).
4. Idempotency: look up `RepositoryScanJob` by `idempotencyKey`. If found → return existing job (200, `is_new = false`).
5. If not found: create `RepositoryScanJob` with `status = QUEUED`.
6. Create outbox message `scan.triggered` for Python scanner worker.
7. Audit event `SCAN_JOB_TRIGGERED`.
8. Re-run must NOT mutate prior accepted `TechnicalEvidenceReport` or `TechnicalProfile` versions — new job creates new artifact chain.

## Commands / Events

| Name                 | Type             | Safe payload                                                                  |
| -------------------- | ---------------- | ----------------------------------------------------------------------------- |
| `TriggerScanCommand` | App command      | `{ assessmentId, snapshotId, triggerSource, idempotencyKey, correlationId? }` |
| `scan.triggered`     | Outbox           | `{ scanJobId, assessmentId, snapshotId, triggerSource, correlationId }`       |
| `SCAN_JOB_TRIGGERED` | `AuthAuditEvent` | `{ scanJobId, assessmentId, snapshotId, triggerSource, correlationId }`       |

## Test Cases

| ID  | Scenario                                               | Expected                                    |
| --- | ------------------------------------------------------ | ------------------------------------------- |
| T01 | Valid snapshot + valid assessment state                | 201 scan job created                        |
| T02 | Same `idempotency_key` sent twice                      | 200 existing job returned, `is_new = false` |
| T03 | Assessment state invalid for scan                      | 409 `ASSESSMENT_STATE_INVALID`              |
| T04 | Snapshot not in org                                    | 404 `SNAPSHOT_NOT_FOUND`                    |
| T05 | Actor lacks `scan:trigger`                             | 403 `RBAC_DENIED`                           |
| T06 | Outbox message created                                 | `event.scan.triggered` in `OutboxMessage`   |
| T07 | Re-run does not mutate prior `TechnicalEvidenceReport` | Prior artifacts untouched                   |

## Definition of Done

- Idempotent: same `idempotency_key` returns existing job.
- Assessment state gate prevents invalid trigger.
- Outbox message `scan.triggered` created for Python scanner.
- Re-run does not mutate prior accepted evidence chain.

## Implementation Evidence

- Manual triggers require RBAC `scan:trigger` plus Manager ownership; trusted triggers require a constant-time verified worker API key.
- Snapshot tenant/scope, assessment state, and repository mapping are validated before durable enqueue.
- Scan job and `scan.triggered` outbox command persist atomically; duplicate delivery returns the existing job with HTTP 200 and emits no second command.
- Material idempotency conflicts are rejected, while retries can return an existing job after the assessment state advances.
- Unit and E2E coverage verifies manual/trusted authorization, state and mapping gates, duplicate/conflict behavior, audit signals, and immutable terminal job history.
