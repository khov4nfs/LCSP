---
task_id: MW-scan-002
module: scan
runtime: nestjs-api
priority: P0
status: DONE
epic_story: 3.3
depends_on:
  - scan/01-scan-job-status-endpoint.md
  - platform/outbox/02-outbox-publisher.md
---

# Scan Job Callback Endpoint

## Outcome

Receive scan results from the Python scanner worker. Worker-authenticated (API key). Validate evidence schema and provenance metadata. Transition `RepositoryScanJob` status. Create `TechnicalEvidenceReport` artifact. Trigger downstream evidence evaluation. Secrets and raw source must not appear in evidence payload.

## Module Files

| File                                                                                                    | Action | Notes                                              |
| ------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------- |
| `apps/api/src/modules/scan/presentation/http/scan.controller.ts`                                        | Modify | Add `POST /internal/scan-jobs/:scanJobId/callback` |
| `apps/api/src/modules/scan/application/commands/process-scan-callback/process-scan-callback.command.ts` | Create | Command shape                                      |
| `apps/api/src/modules/scan/application/commands/process-scan-callback/process-scan-callback.handler.ts` | Create | Evidence acceptance + state transition             |
| `apps/api/src/modules/scan/application/services/scan/evidence-schema-validator.service.ts`              | Create | Schema validation + provenance check               |
| `apps/api/prisma/schema.prisma`                                                                         | Modify | Add `TechnicalEvidenceReport` model                |

## Prisma Model

```prisma
model TechnicalEvidenceReport {
  id               String   @id @default(uuid())
  scanJobId        String   @unique
  assessmentId     String
  organizationId   String
  snapshotId       String
  toolsVersion     Json                             // { syft: 'x.y.z', knip: ... }
  configHash       Json                             // { syft: 'sha256:...', semgrep: ... }
  evidencePayload  Json                             // Validated + redacted findings
  privacyFlags     Json                             // { containsSourceCode: false, ... }
  schemaVersion    String
  status           String   @default("accepted")   // 'accepted' | 'rejected'
  rejectionReason  String?
  createdAt        DateTime @default(now())

  @@index([assessmentId])
  @@index([scanJobId])
}
```

## API Contract

**Endpoint:** `POST /internal/scan-jobs/:scanJobId/callback`
**Auth:** `X-Worker-Api-Key` header (pre-shared worker API key)

**Request body:**

| Field              | Type   | Required | Notes                                         |
| ------------------ | ------ | -------- | --------------------------------------------- |
| `scan_job_id`      | string | Yes      | Must match path param                         |
| `tools_version`    | object | Yes      | Tool name → version mapping                   |
| `config_hash`      | object | Yes      | Tool name → config hash mapping               |
| `evidence_payload` | object | Yes      | Structured findings JSON                      |
| `privacy_flags`    | object | Yes      | `containsSourceCode`, `secretsRedacted`, etc. |
| `schema_version`   | string | Yes      | Evidence schema version                       |
| `status`           | string | Yes      | `success` \| `partial` \| `failed`            |
| `error_code`       | string | No       | Required when `status = failed`               |

**Success response (200):**

| Field                | Type    | Notes                        |
| -------------------- | ------- | ---------------------------- |
| `accepted`           | boolean | `true` if evidence accepted  |
| `evidence_report_id` | string  | `TechnicalEvidenceReport.id` |
| `correlationId`      | string  |                              |

**Error responses:**

| HTTP | `error_code`              | Meaning                                             |
| ---- | ------------------------- | --------------------------------------------------- |
| 401  | `UNAUTHORIZED`            | Invalid or missing `X-Worker-Api-Key`               |
| 404  | `SCAN_JOB_NOT_FOUND`      | Job not found                                       |
| 409  | `SCAN_JOB_WRONG_STATE`    | Job not in `RUNNING` state                          |
| 422  | `EVIDENCE_SCHEMA_INVALID` | Schema version unknown or fields missing            |
| 422  | `PRIVACY_FLAGS_INVALID`   | `containsSourceCode = true` or secrets not redacted |

## Business Rules

1. Auth: validate `X-Worker-Api-Key` against `WORKER_API_KEY` env var.
2. Verify `RepositoryScanJob.status = RUNNING`. If wrong state → `SCAN_JOB_WRONG_STATE`.
3. Validate `schema_version` against accepted schema versions list.
4. Validate `privacy_flags.containsSourceCode = false`. If `true` → `PRIVACY_FLAGS_INVALID`, reject.
5. Validate `privacy_flags.secretsRedacted = true`. If `false` → `PRIVACY_FLAGS_INVALID`, reject.
6. If all checks pass: create `TechnicalEvidenceReport` with `status = accepted`.
7. Transition `RepositoryScanJob.status = COMPLETED`.
8. Emit outbox message `scan.evidence-accepted` for intelligence worker.
9. If scanner reports `status = failed`: create `TechnicalEvidenceReport` with `status = rejected`, transition job to `FAILED`.
10. Audit event `SCAN_EVIDENCE_ACCEPTED` or `SCAN_EVIDENCE_REJECTED`.

## Commands / Events

| Name                           | Type             | Safe payload                                                                                 |
| ------------------------------ | ---------------- | -------------------------------------------------------------------------------------------- |
| `ProcessScanCallbackCommand`   | App command      | `{ scanJobId, toolsVersion, configHash, schemaVersion, status, errorCode?, correlationId? }` |
| `event.scan.evidence-accepted` | Outbox           | `{ evidenceReportId, assessmentId, scanJobId, correlationId }`                               |
| `SCAN_EVIDENCE_ACCEPTED`       | `AuthAuditEvent` | `{ evidenceReportId, assessmentId, scanJobId, correlationId }`                               |

## Test Cases

| ID  | Scenario                             | Expected                                                                 |
| --- | ------------------------------------ | ------------------------------------------------------------------------ |
| T01 | Valid evidence + privacy flags clean | 200 `accepted = true`                                                    |
| T02 | `containsSourceCode = true`          | 422 `PRIVACY_FLAGS_INVALID`, rejected                                    |
| T03 | `secretsRedacted = false`            | 422 `PRIVACY_FLAGS_INVALID`, rejected                                    |
| T04 | Unknown `schema_version`             | 422 `EVIDENCE_SCHEMA_INVALID`                                            |
| T05 | Invalid API key                      | 401                                                                      |
| T06 | Job not in `RUNNING` state           | 409 `SCAN_JOB_WRONG_STATE`                                               |
| T07 | Scanner reports `status = failed`    | Job transitions to `FAILED`, `TechnicalEvidenceReport.status = rejected` |
| T08 | Outbox message created on accept     | `event.scan.evidence-accepted` in DB                                     |
| T09 | `evidencePayload` has no raw source  | Verified by schema validation                                            |

## Definition of Done

- Evidence accepted only when `containsSourceCode = false` AND `secretsRedacted = true`.
- `TechnicalEvidenceReport` created with schema version, tool versions, config hashes.
- Outbox message `scan.evidence-accepted` triggers downstream.
- Failed scanner reports create rejected evidence record and transition job to `FAILED`.

## Implementation Evidence

- Added worker-authenticated `POST /internal/scan-jobs/:scanJobId/callback` using constant-time API-key comparison and correlation propagation.
- Added schema/provenance validation for supported callback status, schema version, tool versions, config hashes, failed-job error code, and path/body job identity.
- Privacy validation rejects source/raw-content keys, known secret patterns, `containsSourceCode != false`, and `secretsRedacted != true` before evidence persistence.
- Added the `TechnicalEvidenceReport` Prisma model and migration. Report creation, guarded job transition, accepted-evidence outbox event, and audit event persist in one transaction.
- Successful and partial evidence complete the job; scanner failures create a rejected report and transition the job to `FAILED` without emitting the accepted-evidence event.
- Verification passes 19 scan unit tests, 8 callback E2E tests covering T01-T09, ESLint, TypeScript, contract/import policies, and `git diff --check`.
