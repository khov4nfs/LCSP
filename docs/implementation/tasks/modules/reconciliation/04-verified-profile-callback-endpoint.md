---
task_id: MW-rec-004
module: reconciliation
runtime: nestjs-api
priority: P0
status: SUPERSEDED_FOR_ACTIVE_MVP
epic_story: 5.4
depends_on:
  - reconciliation/03-resolve-conflict-endpoint.md
  - platform/outbox/02-outbox-publisher.md
---

# VerifiedProfile Callback Endpoint

> Superseded: the active flow no longer exposes a customer-facing VerifiedProfile approval gate or `POST /internal/reconciliation/verified-profile-callback` runtime contract. Direct EngineeringRule classification consumes accepted evidence context instead.

## Outcome

Receive the `VerifiedProfile` artifact from the Python worker after all conflicts are resolved and evidence gates are passed. Validate schema and gates. Store immutable `VerifiedProfile`. Emit `verified-profile-ready` event for legal matching. Manager approval may be required depending on configuration.

## Module Files

| File                                                                                                                  | Action | Notes                                                         |
| --------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------- |
| `apps/api/src/modules/reconciliation/presentation/http/reconciliation.controller.ts`                                  | Modify | Add `POST /internal/reconciliation/verified-profile-callback` |
| `apps/api/src/modules/reconciliation/application/commands/accept-verified-profile/accept-verified-profile.command.ts` | Create | Command shape                                                 |
| `apps/api/src/modules/reconciliation/application/commands/accept-verified-profile/accept-verified-profile.handler.ts` | Create | Gate check + persistence                                      |
| `apps/api/prisma/schema.prisma`                                                                                       | Modify | Add `VerifiedProfile` model                                   |

## Prisma Model

```prisma
model VerifiedProfile {
  id              String   @id @default(uuid())
  aiUsageFlowId   String   @unique
  assessmentId    String
  organizationId  String
  schemaVersion   String
  providerVersion String
  profileData     Json                             // Verified usage claims + evidence chain
  gatesPassedAt   Json                             // { conflictsResolved: DateTime, ... }
  status          String   @default("pending_approval") // 'pending_approval' | 'approved' | 'auto_approved'
  approvedAt      DateTime?
  approvedById    String?
  createdAt       DateTime @default(now())

  @@index([assessmentId])
}
```

## API Contract

**Endpoint:** `POST /internal/reconciliation/verified-profile-callback`
**Auth:** `X-Worker-Api-Key`

**Request body:**

| Field              | Type   | Required | Notes                                     |
| ------------------ | ------ | -------- | ----------------------------------------- |
| `ai_usage_flow_id` | string | Yes      |                                           |
| `assessment_id`    | string | Yes      |                                           |
| `schema_version`   | string | Yes      |                                           |
| `provider_version` | string | Yes      |                                           |
| `profile_data`     | object | Yes      | Verified usage claims with evidence chain |
| `gates_passed_at`  | object | Yes      | Gate timestamps                           |

**Success response (200):**

| Field                 | Type    | Notes                                 |
| --------------------- | ------- | ------------------------------------- |
| `accepted`            | boolean |                                       |
| `verified_profile_id` | string  |                                       |
| `status`              | string  | `pending_approval` or `auto_approved` |
| `correlationId`       | string  |                                       |

**Error responses:**

| HTTP | `error_code`              | Meaning                          |
| ---- | ------------------------- | -------------------------------- |
| 401  | `UNAUTHORIZED`            |                                  |
| 404  | `AI_USAGE_FLOW_NOT_FOUND` |                                  |
| 409  | `PENDING_CONFLICTS_EXIST` | Unresolved conflicts still exist |
| 409  | `PROFILE_ALREADY_EXISTS`  | Already accepted for this flow   |

## Business Rules

1. Auth: validate `X-Worker-Api-Key`.
2. Verify `aiUsageFlowId` references an accepted `AIUsageFlow`.
3. Gate: check no `ConflictRecord` with `status = PENDING` for assessment → `PENDING_CONFLICTS_EXIST`.
4. Check no existing `VerifiedProfile` for `aiUsageFlowId` → `PROFILE_ALREADY_EXISTS`.
5. Create `VerifiedProfile` with `status = pending_approval` (default) or `auto_approved` if org config allows.
6. Emit outbox `verified-profile-ready` for legal matching worker.
7. If `status = pending_approval`: no downstream events until Manager approves.
8. Audit event `VERIFIED_PROFILE_ACCEPTED`.

## Commands / Events

| Name                           | Type             | Safe payload                                                                                     |
| ------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------ |
| `AcceptVerifiedProfileCommand` | App command      | `{ aiUsageFlowId, assessmentId, schemaVersion, providerVersion, gatesPassedAt, correlationId? }` |
| `event.verified-profile-ready` | Outbox           | `{ verifiedProfileId, assessmentId, status, correlationId }`                                     |
| `VERIFIED_PROFILE_ACCEPTED`    | `AuthAuditEvent` | `{ verifiedProfileId, assessmentId, status, correlationId }`                                     |

## Test Cases

| ID  | Scenario                                    | Expected                        |
| --- | ------------------------------------------- | ------------------------------- |
| T01 | All conflicts resolved, no existing profile | 200 `status = pending_approval` |
| T02 | Unresolved conflicts exist                  | 409 `PENDING_CONFLICTS_EXIST`   |
| T03 | Profile already exists                      | 409 `PROFILE_ALREADY_EXISTS`    |
| T04 | Outbox event emitted                        | DB verified                     |
| T05 | Invalid API key                             | 401                             |
| T06 | `profile_data` immutable after acceptance   | No update path                  |

## Definition of Done

- Gate check: no PENDING conflicts before acceptance.
- Immutable once accepted.
- Outbox `verified-profile-ready` triggers legal matching.
- Manager approval gate (`pending_approval`) honored before classification.

## Implementation Notes

- Added immutable `VerifiedProfile` persistence with a unique `aiUsageFlowId` guard.
- Added `AcceptVerifiedProfileCommand` and handler to validate the worker payload, confirm the referenced `AIUsageFlow` is accepted, block unresolved conflicts, persist the profile, emit the ready outbox event, and write an audit record.
- Added `POST /internal/reconciliation/verified-profile-callback` behind `WorkerApiKeyGuard`.
- Added contract constants for verified profile statuses, schema versions, outbox event type, audit event type, and error codes.
- Audit payload intentionally stores only identifiers/status metadata; `profile_data` is excluded because it can contain detailed evidence context.

## Validation

- `NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --config ./jest.config.ts --runInBand --no-watchman --runTestsByPath src/modules/reconciliation/application/commands/accept-verified-profile/accept-verified-profile.handler.spec.ts` — passed.
- `pnpm run typecheck` — passed.
- `pnpm run build` from `apps/api` — passed.
- `git diff --check` — passed.
- `pnpm run lint` from repo root — blocked by pre-existing contract literal issues in `apps/web/src/features/document/components/organisms/document-request-panel.tsx`.
- E2E callback test was added, but local execution is blocked during `prisma db push` because the local test database/schema engine setup is unavailable.
