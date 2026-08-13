---
task_id: MW-scan-003
module: scan
runtime: nestjs-api
priority: P1
status: READY_FOR_DEV
epic_story: 3.3
depends_on:
  - scan/02-scan-job-callback-endpoint.md
  - github-integration/04-scan-trigger-endpoint.md
---

# Re-Run Scan Endpoint

## Outcome

Allow a Manager to trigger a re-scan on the same or a new snapshot without mutating prior accepted `TechnicalEvidenceReport` or `TechnicalProfile` versions. Re-run creates a new `RepositoryScanJob` referencing a new or existing snapshot. Prior artifact chain is preserved immutably.

## Module Files

| File                                                                              | Action | Notes                                                 |
| --------------------------------------------------------------------------------- | ------ | ----------------------------------------------------- |
| `apps/api/src/modules/scan/presentation/http/scan.controller.ts`                  | Modify | Add `POST /assessments/:assessmentId/scan-jobs/rerun` |
| `apps/api/src/modules/scan/application/commands/rerun-scan/rerun-scan.command.ts` | Create | Command shape                                         |
| `apps/api/src/modules/scan/application/commands/rerun-scan/rerun-scan.handler.ts` | Create | New job creation without mutating history             |

## API Contract

**Endpoint:** `POST /assessments/:assessmentId/scan-jobs/rerun`
**Auth required:** Yes — `@RequireAction('scan:trigger')`

**Request body:**

| Field             | Type   | Required | Notes                                                      |
| ----------------- | ------ | -------- | ---------------------------------------------------------- |
| `snapshot_id`     | string | Yes      | New or same snapshot (re-snapshot required for new commit) |
| `idempotency_key` | string | Yes      | Client-generated unique key                                |
| `reason`          | string | No       | Business reason for re-run (audit record only)             |

**Success response (201):**

| Field                  | Type   | Notes                             |
| ---------------------- | ------ | --------------------------------- |
| `scan_job_id`          | string | New `RepositoryScanJob.id`        |
| `status`               | string | `QUEUED`                          |
| `replaces_scan_job_id` | string | Prior scan job ID (informational) |
| `correlationId`        | string |                                   |

**Error responses:**

| HTTP | `error_code`               | Meaning                                 |
| ---- | -------------------------- | --------------------------------------- |
| 403  | `PBAC_DENIED`              | Actor lacks `scan:trigger`              |
| 404  | `SNAPSHOT_NOT_FOUND`       | Snapshot not found or not in org        |
| 409  | `ASSESSMENT_STATE_INVALID` | Assessment state does not allow re-scan |

## Business Rules

1. PBAC guard: `action = scan:trigger`.
2. Validate snapshot exists and org-scoped.
3. Create new `RepositoryScanJob` with `triggerSource = manual`. Prior job not mutated.
4. Prior accepted `TechnicalEvidenceReport` and `TechnicalProfile` linked to prior scan job remain immutable — re-run creates new artifact chain version.
5. Audit event `SCAN_RERUN_TRIGGERED` with prior job ID and new job ID. `reason` field included if provided (no PII check needed — operator-controlled field).
6. Idempotency: same `idempotency_key` returns existing re-run job.

## Commands / Events

| Name                   | Type             | Safe payload                                                            |
| ---------------------- | ---------------- | ----------------------------------------------------------------------- |
| `RerunScanCommand`     | App command      | `{ assessmentId, snapshotId, idempotencyKey, reason?, correlationId? }` |
| `SCAN_RERUN_TRIGGERED` | `AuthAuditEvent` | `{ newScanJobId, priorScanJobId, assessmentId, correlationId }`         |

## Test Cases

| ID  | Scenario                                  | Expected                                    |
| --- | ----------------------------------------- | ------------------------------------------- |
| T01 | Valid re-run                              | 201 new scan job, prior job/evidence intact |
| T02 | Same `idempotency_key`                    | 200 existing re-run job returned            |
| T03 | Prior `TechnicalEvidenceReport` unchanged | DB inspection confirms immutability         |
| T04 | Actor lacks `scan:trigger`                | 403 `PBAC_DENIED`                           |
| T05 | Snapshot not in org                       | 404 `SNAPSHOT_NOT_FOUND`                    |

## Definition of Done

- Re-run creates new job without mutating any prior accepted artifact.
- Prior `TechnicalEvidenceReport` and `TechnicalProfile` immutable after re-run trigger.
- Idempotency on `idempotency_key`.
- Audit event records new and prior job IDs.
