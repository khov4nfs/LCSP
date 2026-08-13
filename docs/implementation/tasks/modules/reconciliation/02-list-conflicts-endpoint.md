---
task_id: MW-rec-002
module: reconciliation
runtime: nestjs-api
priority: P0
status: DONE
epic_story: 5.2
depends_on:
  - reconciliation/01-conflict-detection-callback-endpoint.md
  - platform/pbac/03-nestjs-guard.md
---

# List Conflicts Endpoint

## Outcome

Return all pending conflicts for an assessment for Manager review. Includes conflict score, explanation, type, and evidence refs. No raw source code in response. Manager can filter by status.

## Module Files

| File                                                                                                 | Action | Notes                                          |
| ---------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------- |
| `apps/api/src/modules/reconciliation/presentation/http/reconciliation.controller.ts`                 | Modify | Add `GET /assessments/:assessmentId/conflicts` |
| `apps/api/src/modules/reconciliation/application/queries/list-conflicts/list-conflicts.query.ts`     | Create | Query shape                                    |
| `apps/api/src/modules/reconciliation/application/queries/list-conflicts/list-conflicts.handler.ts`   | Create | Paginated list                                 |
| `apps/api/src/modules/reconciliation/application/contracts/reconciliation/conflict-list.contract.ts` | Create | Response DTO                                   |

## API Contract

**Endpoint:** `GET /assessments/:assessmentId/conflicts`
**Auth required:** Yes — `@RequireAction('conflict:read')`

**Query parameters:**

| Param       | Type   | Required | Default   | Notes            |
| ----------- | ------ | -------- | --------- | ---------------- |
| `status`    | string | No       | `PENDING` | Filter by status |
| `page`      | number | No       | 1         |                  |
| `page_size` | number | No       | 20        | Max 100          |

**Success response (200):**

| Field           | Type              | Notes     |
| --------------- | ----------------- | --------- |
| `conflicts`     | ConflictSummary[] | See below |
| `total`         | number            |           |
| `page`          | number            |           |
| `page_size`     | number            |           |
| `correlationId` | string            |           |

**`ConflictSummary` object:**

| Field               | Type     | Notes                              |
| ------------------- | -------- | ---------------------------------- |
| `conflict_id`       | string   |                                    |
| `conflict_type`     | string   |                                    |
| `conflict_score`    | number   | 0.0 – 1.0                          |
| `score_explanation` | string   |                                    |
| `status`            | string   |                                    |
| `evidence_refs`     | string[] | Evidence finding IDs (not content) |
| `created_at`        | string   | ISO 8601                           |

**Error responses:**

| HTTP | `error_code`           | Meaning                     |
| ---- | ---------------------- | --------------------------- |
| 403  | `PBAC_DENIED`          | Actor lacks `conflict:read` |
| 404  | `ASSESSMENT_NOT_FOUND` | Not found or not in org     |

## Business Rules

1. PBAC guard: `action = conflict:read`.
2. Org-scope guard on assessment.
3. Default filter: `status = PENDING`.
4. `evidence_refs` contains reference IDs only — not the actual finding content.
5. No raw source code in response.

## Prisma Models Used

| Model            | Action           | Key fields                      |
| ---------------- | ---------------- | ------------------------------- |
| `ConflictRecord` | Read (paginated) | `assessmentId`, `status` filter |

## Test Cases

| ID  | Scenario                            | Expected                   |
| --- | ----------------------------------- | -------------------------- |
| T01 | PENDING conflicts exist             | 200 list returned          |
| T02 | No conflicts                        | 200 empty list             |
| T03 | Filter by `status = RESOLVED`       | Only resolved returned     |
| T04 | Actor lacks `conflict:read`         | 403 `PBAC_DENIED`          |
| T05 | Assessment not in org               | 404 `ASSESSMENT_NOT_FOUND` |
| T06 | `evidence_refs` are IDs not content | Field inspection           |

## Definition of Done

- Conflicts returned with score, explanation, type, and refs.
- Default filter is `PENDING`.
- No raw source code or finding content in `evidence_refs`.

## Implementation Evidence

- Added `GET /assessments/:assessmentId/conflicts` in the reconciliation HTTP surface, guarded by `PbacGuard` and `PBAC_ACTIONS.conflictRead`.
- Added `conflict:read` to PBAC action contracts and Manager-only action coverage.
- Added `ListConflictsQuery`, `ListConflictsHandler`, and `ConflictListDto` contract.
- Handler verifies the assessment belongs to the caller's organization before reading conflicts.
- Handler defaults `status` to `PENDING`, clamps pagination to `page >= 1` and `page_size <= 100`, and validates known conflict statuses.
- Handler returns conflict ID, type, score, explanation, status, evidence reference IDs, creation timestamp, total/page metadata, and correlation ID.
- Handler filters `evidence_refs` to string IDs only, preventing raw finding/source content from leaking in the response.
- Added e2e coverage for T01-T06.
- Cleaned existing document test contract-literal and Jest mock typing issues so repo-wide validation passes.

## File List

- `apps/api/src/modules/reconciliation/presentation/http/reconciliation.controller.ts`
- `apps/api/src/modules/reconciliation/reconciliation.module.ts`
- `apps/api/src/modules/reconciliation/application/contracts/reconciliation/conflict-list.contract.ts`
- `apps/api/src/modules/reconciliation/application/queries/list-conflicts/list-conflicts.query.ts`
- `apps/api/src/modules/reconciliation/application/queries/list-conflicts/list-conflicts.handler.ts`
- `apps/api/test/list-conflicts.e2e-spec.ts`
- `packages/contracts/src/pbac/actions.ts`
- `packages/contracts/src/pbac/manager-policy.ts`
- `tests/story-1-6.web.test.ts`
- `apps/api/src/modules/document/application/commands/request-final-report/request-final-report.handler.spec.ts`
- `apps/api/test/document-final-report.e2e-spec.ts`

## Validation

- `pnpm --filter @lcsp/api test:e2e -- --runInBand --runTestsByPath test/list-conflicts.e2e-spec.ts`
  - Result: passed, 6 tests.
- `pnpm run lint`
  - Result: passed.
- `pnpm run test:web`
  - Result: passed, 31 tests.
- `NODE_OPTIONS=--experimental-vm-modules pnpm --dir apps/api exec jest --config ./jest.config.ts --runInBand --watchman=false`
  - Result: passed, 46 suites / 286 tests.
- `pnpm --filter @lcsp/api build`
  - Result: passed.
- `pnpm --filter @lcsp/api test:e2e`
  - Result: passed, 30 suites / 249 tests.
