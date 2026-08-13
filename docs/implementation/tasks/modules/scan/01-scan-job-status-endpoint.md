---
task_id: MW-scan-001
module: scan
runtime: nestjs-api
priority: P0
status: DONE
epic_story: 3.3
depends_on:
  - github-integration/04-scan-trigger-endpoint.md
  - platform/pbac/03-nestjs-guard.md
---

# Scan Job Status Endpoint

## Outcome

Return current status and progress of a `RepositoryScanJob`. Manager and scoped Developer can poll this endpoint. Shows blocked/failed states with business-language next-action. Never shows risk labels or source code content.

## Module Files

| File                                                                                 | Action | Notes                                                 |
| ------------------------------------------------------------------------------------ | ------ | ----------------------------------------------------- |
| `apps/api/src/modules/scan/presentation/http/scan.controller.ts`                     | Create | `GET /assessments/:assessmentId/scan-jobs/:scanJobId` |
| `apps/api/src/modules/scan/application/queries/get-scan-job/get-scan-job.query.ts`   | Create | Query shape                                           |
| `apps/api/src/modules/scan/application/queries/get-scan-job/get-scan-job.handler.ts` | Create | Status projection                                     |
| `apps/api/src/modules/scan/application/contracts/scan/scan-job-status.contract.ts`   | Create | Response DTO                                          |
| `apps/api/src/modules/scan/scan.module.ts`                                           | Create | NestJS module wiring                                  |

## API Contract

**Endpoint:** `GET /assessments/:assessmentId/scan-jobs/:scanJobId`
**Auth required:** Yes — `@RequireAction('scan:read')`

**Success response (200):**

| Field            | Type           | Notes                                                         |
| ---------------- | -------------- | ------------------------------------------------------------- |
| `scan_job_id`    | string         |                                                               |
| `assessment_id`  | string         |                                                               |
| `status`         | string         | `QUEUED` \| `RUNNING` \| `COMPLETED` \| `FAILED` \| `BLOCKED` |
| `trigger_source` | string         | `manual` \| `trusted`                                         |
| `attempt_count`  | number         |                                                               |
| `blocked_reason` | string \| null | Business-language reason when blocked                         |
| `next_action`    | string \| null | Business-language guidance                                    |
| `created_at`     | string         | ISO 8601                                                      |
| `updated_at`     | string         | ISO 8601                                                      |
| `correlationId`  | string         |                                                               |

**Error responses:**

| HTTP | `error_code`         | Meaning                 |
| ---- | -------------------- | ----------------------- |
| 403  | `PBAC_DENIED`        | Actor lacks `scan:read` |
| 404  | `SCAN_JOB_NOT_FOUND` | Not found or not in org |

## Business Rules

1. PBAC guard: `action = scan:read`.
2. Verify `scanJob.assessmentId = pathParam.assessmentId` and `organizationId = session.organizationId`.
3. `blocked_reason` must be business-language only — no technical stack traces or raw error messages.
4. `next_action` must be business-language — no risk labels.
5. Never include source code content, raw scanner output, or file paths in response.

## Prisma Models Used

| Model               | Action | Key fields                  |
| ------------------- | ------ | --------------------------- |
| `RepositoryScanJob` | Read   | All fields, org-scope guard |

## Test Cases

| ID  | Scenario                   | Expected                                                   |
| --- | -------------------------- | ---------------------------------------------------------- |
| T01 | QUEUED job                 | 200 `status = QUEUED`                                      |
| T02 | COMPLETED job              | 200 `status = COMPLETED`                                   |
| T03 | BLOCKED job                | 200 `status = BLOCKED`, `blocked_reason` business-language |
| T04 | Job not in org             | 404 `SCAN_JOB_NOT_FOUND`                                   |
| T05 | Actor lacks `scan:read`    | 403 `PBAC_DENIED`                                          |
| T06 | No source code in response | Field inspection                                           |

## Definition of Done

- Status accurately reflects current `RepositoryScanJob.status`.
- `blocked_reason` and `next_action` always business-language.
- No source code or raw scanner output in response.

## Implementation Evidence

- Added the PBAC-protected `GET /assessments/:assessmentId/scan-jobs/:scanJobId` endpoint for Manager and assessment-scoped Developer polling.
- The query is constrained by scan job, assessment, and organization; out-of-scope records use the same `SCAN_JOB_NOT_FOUND` response as missing records.
- The response uses an explicit safe-field projection. Raw blocked reasons, scanner output, source content, file paths, and stack traces are never selected or returned.
- `QUEUED`, `RUNNING`, `FAILED`, and `BLOCKED` statuses return approved business-language guidance; `COMPLETED` returns no next action.
- Unit coverage passes 9 tests, E2E coverage passes all 6 task scenarios, and contract/import policy checks plus the repository typecheck pass.
