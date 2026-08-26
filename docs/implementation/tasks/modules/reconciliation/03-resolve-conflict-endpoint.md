---
task_id: MW-rec-003
module: reconciliation
runtime: nestjs-api
priority: P0
status: READY_FOR_DEV
epic_story: 5.3
depends_on:
  - reconciliation/02-list-conflicts-endpoint.md
  - platform/rbac/03-nestjs-guard.md
  - platform/outbox/02-outbox-publisher.md
---

# Resolve Conflict Endpoint

## Outcome

Allow a Manager to resolve or dismiss a conflict. Resolution is audited and immutable — resolved conflicts cannot be re-opened. Resolution authority stays with Manager. After all conflicts resolved, emit event to allow VerifiedProfile creation to proceed.

## Module Files

| File                                                                                                    | Action | Notes                                                                |
| ------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------- |
| `apps/api/src/modules/reconciliation/presentation/http/reconciliation.controller.ts`                    | Modify | Add `PATCH /assessments/:assessmentId/conflicts/:conflictId/resolve` |
| `apps/api/src/modules/reconciliation/application/commands/resolve-conflict/resolve-conflict.command.ts` | Create | Command shape                                                        |
| `apps/api/src/modules/reconciliation/application/commands/resolve-conflict/resolve-conflict.handler.ts` | Create | Resolution + gate check                                              |

## API Contract

**Endpoint:** `PATCH /assessments/:assessmentId/conflicts/:conflictId/resolve`
**Auth required:** Yes — `@RequireAction('conflict:resolve')` (Manager-only action)

**Request body:**

| Field             | Type   | Required                                                                      | Notes                                          |
| ----------------- | ------ | ----------------------------------------------------------------------------- | ---------------------------------------------- |
| `resolution`      | string | Yes                                                                           | `RESOLVED` \| `DISMISSED`                      |
| `resolution_note` | string | Required when `resolution = DISMISSED`; optional when `resolution = RESOLVED` | Max 2000 chars — business-language explanation |

**Success response (200):**

| Field                    | Type    | Notes                             |
| ------------------------ | ------- | --------------------------------- |
| `conflict_id`            | string  |                                   |
| `status`                 | string  | `RESOLVED` or `DISMISSED`         |
| `resolved_at`            | string  | ISO 8601                          |
| `all_conflicts_resolved` | boolean | True if no more PENDING conflicts |
| `correlationId`          | string  |                                   |

**Error responses:**

| HTTP | `error_code`                | Meaning                        |
| ---- | --------------------------- | ------------------------------ |
| 403  | `RBAC_DENIED`               | Actor lacks `conflict:resolve` |
| 404  | `CONFLICT_NOT_FOUND`        | Not found or not in org        |
| 409  | `CONFLICT_ALREADY_RESOLVED` | Already resolved or dismissed  |

## Business Rules

1. RBAC guard: `action = conflict:resolve`. Non-Manager subjects do not have this action in active MVP.
2. Verify conflict exists and `assessmentId` and `organizationId` match session.
3. If `status ≠ PENDING` → `CONFLICT_ALREADY_RESOLVED`.
4. Update `ConflictRecord.status`, `resolvedAt`, `resolvedById`, `resolutionNote` atomically.
5. After resolution, check if all `ConflictRecord` for the assessment have `status ≠ PENDING`.
6. If all resolved → emit outbox message `reconciliation.all-conflicts-resolved` for VerifiedProfile gate.
7. `resolution_note` stored as-is (Manager-authored content). No LLM processing of this field.
8. Audit event `CONFLICT_RESOLVED` or `CONFLICT_DISMISSED`.
9. `DISMISSED` is a final Manager decision for the current conflict/reconciliation version, not a defer/snooze action.
10. If `resolution = DISMISSED`, `resolution_note` must be a non-empty business-language reason after trim. Empty/missing note → `SCHEMA_INVALID`.
11. If "handle later" behavior is needed later, add a separate `DEFERRED` state instead of overloading `DISMISSED`.

## Commands / Events

| Name                                          | Type             | Safe payload                                                            |
| --------------------------------------------- | ---------------- | ----------------------------------------------------------------------- |
| `ResolveConflictCommand`                      | App command      | `{ conflictId, resolution, resolutionNote?, correlationId? }`           |
| `event.reconciliation.all-conflicts-resolved` | Outbox           | `{ assessmentId, correlationId }` (emitted when all PENDING cleared)    |
| `CONFLICT_RESOLVED`                           | `AuthAuditEvent` | `{ conflictId, resolution, resolvedById, assessmentId, correlationId }` |

## Test Cases

| ID  | Scenario                                    | Expected                                              |
| --- | ------------------------------------------- | ----------------------------------------------------- |
| T01 | Manager resolves PENDING conflict           | 200 `status = RESOLVED`                               |
| T02 | Manager dismisses conflict                  | 200 `status = DISMISSED`                              |
| T03 | Last conflict resolved                      | `all_conflicts_resolved = true`, outbox event emitted |
| T04 | Conflict already resolved                   | 409 `CONFLICT_ALREADY_RESOLVED`                       |
| T05 | Non-Manager attempts resolution             | 403 `RBAC_DENIED`                                     |
| T06 | Conflict not in org                         | 404 `CONFLICT_NOT_FOUND`                              |
| T07 | Outbox event only emitted when all resolved | DB verified — no early emission                       |
| T08 | Dismiss without reason                      | 422 `SCHEMA_INVALID`                                  |

## Definition of Done

- Manager-only action.
- Conflict immutable once resolved/dismissed.
- `all-conflicts-resolved` outbox event emitted only when all PENDING cleared.
- Audit event written with resolution, resolver ID.
- Dismissal requires a non-empty Manager reason.
