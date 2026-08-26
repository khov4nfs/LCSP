---
task_id: MW-outbox-003
module: platform/outbox
runtime: nestjs-api
priority: P1
status: READY_FOR_DEV
epic_story: 2.1
depends_on:
  - platform/outbox/02-outbox-publisher.md
---

# DLQ Handler — Dead Letter Queue Management

## Outcome

Expose an internal admin endpoint and a scheduled job to inspect and replay DLQ outbox messages. DLQ messages are not retried automatically — replay requires explicit operator action.

## Module Files

| File | Action | Notes |
|---|---|---|
| `apps/api/src/platform/outbox/outbox-dlq.controller.ts` | Create | Admin endpoints for DLQ inspection/replay |
| `apps/api/src/platform/outbox/outbox-dlq.service.ts` | Create | DLQ replay logic |
| `apps/api/src/platform/outbox/outbox.module.ts` | Modify | Register DLQ controller and service |

## API Contract

**Endpoints (internal admin — guarded by `INTERNAL_ADMIN` RBAC action):**

**`GET /internal/outbox/dlq`**

| Field | Type | Notes |
|---|---|---|
| `messages` | OutboxMessage[] | All messages with `status = dlq` |
| `count` | number | Total count |

**`POST /internal/outbox/dlq/:id/replay`**

Resets `status = pending`, `attempts = 0`, `errorMessage = null` for the specified message. Poller will pick it up on next cycle.

**`DELETE /internal/outbox/dlq/:id`**

Permanently deletes DLQ message. Irreversible.

**Error responses:**

| HTTP | `error_code` | Meaning |
|---|---|---|
| 403 | `RBAC_DENIED` | Not INTERNAL_ADMIN |
| 404 | `MESSAGE_NOT_FOUND` | Message ID not in DLQ |

## Prisma Models Used

| Model | Action | Key fields |
|---|---|---|
| `OutboxMessage` | Read | `WHERE status = dlq` |
| `OutboxMessage` | Update | `status = pending`, `attempts = 0` for replay |
| `OutboxMessage` | Delete | Hard delete for discard |

## Business Rules

1. Only messages with `status = 'dlq'` are visible via DLQ endpoint.
2. Replay resets `status = 'pending'` and `attempts = 0`. Poller picks up on next cycle.
3. Delete is a hard delete — no soft delete for DLQ messages.
4. All DLQ actions require `INTERNAL_ADMIN` RBAC action (operator role only).
5. Replay emits an audit event `OUTBOX_DLQ_REPLAYED` with operator, message ID, event type.
6. Delete emits `OUTBOX_DLQ_DISCARDED` audit event.

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | List DLQ messages | Returns all `status = dlq` messages |
| T02 | Replay DLQ message | `status = pending`, `attempts = 0` |
| T03 | Replay non-DLQ message ID | 404 `MESSAGE_NOT_FOUND` |
| T04 | Delete DLQ message | Message removed from DB |
| T05 | Unauthorized access | 403 `RBAC_DENIED` |
| T06 | Replay emits audit event | `OUTBOX_DLQ_REPLAYED` in `AuthAuditEvent` |

## Definition of Done

- DLQ list, replay, and discard operations available to INTERNAL_ADMIN only.
- Replay correctly resets message to pending for poller pickup.
- Audit events emitted for replay and discard.
- Hard delete is irreversible (no soft delete).
