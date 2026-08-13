---
task_id: MW-rec-001
module: reconciliation
runtime: nestjs-api
priority: P0
status: DONE
epic_story: 5.1
depends_on:
  - ai-usage-flow/01-ai-usage-flow-callback-endpoint.md
  - platform/outbox/02-outbox-publisher.md
---

# Conflict Detection Callback Endpoint

## Outcome

Receive reconciliation conflict detection results from the Python worker. Store `ConflictRecord` with conflict score, evidence refs, and conflict type. Route conflicts to Manager for resolution. Emit outbox event. Conflicts must have calculated explanatory Conflict Score.

## Module Files

| File                                                                                                  | Action | Notes                                             |
| ----------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------- |
| `apps/api/src/modules/reconciliation/presentation/http/reconciliation.controller.ts`                  | Create | `POST /internal/reconciliation/conflict-callback` |
| `apps/api/src/modules/reconciliation/application/commands/accept-conflict/accept-conflict.command.ts` | Create | Command shape                                     |
| `apps/api/src/modules/reconciliation/application/commands/accept-conflict/accept-conflict.handler.ts` | Create | Validation + persistence                          |
| `apps/api/src/modules/reconciliation/domain/entities/conflict-record.entity.ts`                       | Create | `ConflictRecord` domain entity                    |
| `apps/api/prisma/schema.prisma`                                                                       | Modify | Add `ConflictRecord` model                        |
| `apps/api/src/modules/reconciliation/reconciliation.module.ts`                                        | Create | NestJS module                                     |

## Prisma Model

```prisma
model ConflictRecord {
  id              String   @id @default(uuid())
  aiUsageFlowId   String
  assessmentId    String
  organizationId  String
  conflictType    String                           // 'evidence_contradiction | 'scope_mismatch' | 'unverifiable'
  conflictScore   Float                            // 0.0 - 1.0 explanatory score
  scoreExplanation String
  evidenceRefs    Json                             // Conflicting evidence reference IDs
  status          String   @default("PENDING")    // PENDING | RESOLVED | DISMISSED
  resolvedAt      DateTime?
  resolvedById    String?
  resolutionNote  String?
  createdAt       DateTime @default(now())

  @@index([assessmentId, status])
}
```

## API Contract

**Endpoint:** `POST /internal/reconciliation/conflict-callback`
**Auth:** `X-Worker-Api-Key`

**Request body:**

| Field              | Type            | Required | Notes                              |
| ------------------ | --------------- | -------- | ---------------------------------- |
| `ai_usage_flow_id` | string          | Yes      | Source flow                        |
| `assessment_id`    | string          | Yes      |                                    |
| `conflicts`        | ConflictInput[] | Yes      | Array, may be empty (no conflicts) |

**`ConflictInput` object:**

| Field               | Type     | Required | Notes                                                          |
| ------------------- | -------- | -------- | -------------------------------------------------------------- |
| `conflict_type`     | string   | Yes      | `evidence_contradiction` \| `scope_mismatch` \| `unverifiable` |
| `conflict_score`    | number   | Yes      | 0.0 – 1.0                                                      |
| `score_explanation` | string   | Yes      | Human-readable explanation of score                            |
| `evidence_refs`     | string[] | Yes      | Conflicting evidence IDs                                       |

**Success response (200):**

| Field            | Type    | Notes                       |
| ---------------- | ------- | --------------------------- |
| `accepted`       | boolean |                             |
| `conflict_count` | number  | Number of conflicts created |
| `correlationId`  | string  |                             |

**Error responses:**

| HTTP | `error_code`              | Meaning                          |
| ---- | ------------------------- | -------------------------------- |
| 401  | `UNAUTHORIZED`            | Invalid API key                  |
| 404  | `AI_USAGE_FLOW_NOT_FOUND` | Source flow not found            |
| 422  | `CONFLICT_SCORE_INVALID`  | `conflict_score` outside 0.0–1.0 |
| 422  | `EVIDENCE_REFS_EMPTY`     | Conflict has no `evidence_refs`  |

## Business Rules

1. Auth: validate `X-Worker-Api-Key`.
2. Verify `aiUsageFlowId` references an accepted `AIUsageFlow`.
3. If `conflicts` is empty → no `ConflictRecord` created. Emit `reconciliation.no-conflicts` outbox event.
4. Validate each conflict: `0.0 ≤ conflict_score ≤ 1.0` and `evidence_refs` non-empty.
5. Create one `ConflictRecord` per conflict with `status = PENDING`.
6. Emit outbox message `reconciliation.conflicts-detected` (with count > 0) or `reconciliation.no-conflicts`.
7. Conflicts route to Manager for resolution (Manager reads via `GET /assessments/:id/conflicts`).
8. `score_explanation` must be human-readable business language (validated: no internal code paths).
9. Audit event `CONFLICT_DETECTED` per conflict or `NO_CONFLICTS_DETECTED`.

## Commands / Events

| Name                                      | Type             | Safe payload                                                   |
| ----------------------------------------- | ---------------- | -------------------------------------------------------------- |
| `AcceptConflictCommand`                   | App command      | `{ aiUsageFlowId, assessmentId, conflicts[], correlationId? }` |
| `event.reconciliation.conflicts-detected` | Outbox           | `{ assessmentId, conflictCount, correlationId }`               |
| `event.reconciliation.no-conflicts`       | Outbox           | `{ assessmentId, correlationId }`                              |
| `CONFLICT_DETECTED`                       | `AuthAuditEvent` | `{ conflictId, conflictType, assessmentId, correlationId }`    |

## Test Cases

| ID  | Scenario                             | Expected                                      |
| --- | ------------------------------------ | --------------------------------------------- |
| T01 | Valid conflicts with scores and refs | 200, `ConflictRecord` rows created            |
| T02 | Empty conflicts array                | 200, `conflict_count = 0`, no-conflicts event |
| T03 | `conflict_score = 1.1`               | 422 `CONFLICT_SCORE_INVALID`                  |
| T04 | `evidence_refs` empty                | 422 `EVIDENCE_REFS_EMPTY`                     |
| T05 | Invalid API key                      | 401                                           |
| T06 | AI usage flow not found              | 404 `AI_USAGE_FLOW_NOT_FOUND`                 |
| T07 | All conflicts `status = PENDING`     | DB verified                                   |

## Definition of Done

- `ConflictRecord` created per conflict with score, explanation, refs.
- Empty conflicts emit `no-conflicts` event (not missing event).
- Score validated to 0.0–1.0 range.
- All conflicts routed to Manager via PENDING status.

## Implementation Evidence

- Added `ConflictRecord` Prisma model with `assessmentId,status` index and pending/resolution fields.
- Added `POST /internal/reconciliation/conflict-callback` guarded by `X-Worker-Api-Key`.
- Added `AcceptConflictCommand`, callback contract, handler, domain entity, and NestJS module.
- Handler verifies accepted `AIUsageFlow`, accepts explicit empty conflict arrays, validates conflict type, score range, evidence refs, schema, provider version, and privacy flags.
- Handler persists one `ConflictRecord` per conflict with `PENDING` status, emits `event.reconciliation.conflicts-detected.v1` or `event.reconciliation.no-conflicts.v1`, and writes `CONFLICT_DETECTED` per conflict or `NO_CONFLICTS_DETECTED`.
- Added scan contract constants for conflict statuses, callback schema version, outbox/audit event names, and callback error codes.
- Added e2e coverage for T01–T07 plus invalid worker key and missing AIUsageFlow.

## File List

- `apps/api/prisma/schema.prisma`
- `apps/api/src/app.module.ts`
- `apps/api/src/modules/reconciliation/reconciliation.module.ts`
- `apps/api/src/modules/reconciliation/application/commands/accept-conflict/accept-conflict.command.ts`
- `apps/api/src/modules/reconciliation/application/commands/accept-conflict/accept-conflict.handler.ts`
- `apps/api/src/modules/reconciliation/application/contracts/reconciliation/conflict-detection-callback.contract.ts`
- `apps/api/src/modules/reconciliation/domain/entities/conflict-record.entity.ts`
- `apps/api/src/modules/reconciliation/presentation/http/reconciliation.controller.ts`
- `apps/api/test/conflict-detection-callback.e2e-spec.ts`
- `packages/contracts/src/scan/callback.ts`
- `packages/contracts/src/scan/codes.ts`

## Validation

- `pnpm --filter @lcsp/api prisma:generate`
  - Result: passed.
- `pnpm --filter @lcsp/api test:e2e -- --runInBand --runTestsByPath test/conflict-detection-callback.e2e-spec.ts`
  - Result: passed, 6 tests.
- `pnpm --filter @lcsp/api test:e2e -- --runInBand --runTestsByPath test/conflict-detection-callback.e2e-spec.ts test/ai-usage-flow-callback.e2e-spec.ts`
  - Result: passed, 12 tests.
- `pnpm --filter @lcsp/api test:e2e`
  - Result: passed, 29 suites / 243 tests.
- `pnpm --filter @lcsp/api lint`
  - Result: passed.
- `npm run lint`
  - Result: blocked by pre-existing contract literal failures in `apps/api/src/modules/document/application/commands/request-final-report/request-final-report.handler.spec.ts:97` and `apps/api/test/document-final-report.e2e-spec.ts:271`.
- `npm run typecheck`
  - Result: blocked by pre-existing type errors in `apps/api/src/modules/document/application/commands/request-final-report/request-final-report.handler.spec.ts:36` and `:39`.
