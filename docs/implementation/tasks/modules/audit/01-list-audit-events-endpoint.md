---
task_id: MW-aud-001
module: audit
runtime: nestjs-api
priority: P1
status: READY_FOR_DEV
epic_story: 8.6
depends_on:
  - platform/audit-writer/02-audit-writer-service.md
  - platform/rbac/03-nestjs-guard.md
---

# List Audit Events Endpoint

## Outcome

Return paginated audit trail for an organization. Responses are pre-redacted: no session tokens, MFA secrets, or raw credentials appear. Manager can filter by event type, actor, date range. Supports audit trail review before export.

## Module Files

| File                                                                                            | Action | Notes                                    |
| ----------------------------------------------------------------------------------------------- | ------ | ---------------------------------------- |
| `apps/api/src/modules/audit/presentation/http/audit.controller.ts`                              | Create | `GET /organizations/:orgId/audit-events` |
| `apps/api/src/modules/audit/application/queries/list-audit-events/list-audit-events.query.ts`   | Create | Query shape + pagination + filters       |
| `apps/api/src/modules/audit/application/queries/list-audit-events/list-audit-events.handler.ts` | Create | Paginated query + redaction              |
| `apps/api/src/modules/audit/application/services/audit/audit-redactor.service.ts`               | Create | Per-event payload redaction              |
| `apps/api/src/modules/audit/application/contracts/audit/audit-event-list.contract.ts`           | Create | Response DTO                             |
| `apps/api/src/modules/audit/audit.module.ts`                                                    | Create | NestJS module                            |

## API Contract

**Endpoint:** `GET /organizations/:orgId/audit-events`
**Auth required:** Yes — `@RequireAction('audit:read')`

**Query parameters:**

| Param        | Type   | Required | Default | Notes                |
| ------------ | ------ | -------- | ------- | -------------------- |
| `event_type` | string | No       | —       | Filter by event type |
| `actor_id`   | string | No       | —       | Filter by actor      |
| `from_date`  | string | No       | —       | ISO 8601 — inclusive |
| `to_date`    | string | No       | —       | ISO 8601 — inclusive |
| `page`       | number | No       | 1       |                      |
| `page_size`  | number | No       | 20      | Max 100              |

**Success response (200):**

| Field           | Type                | Notes     |
| --------------- | ------------------- | --------- |
| `events`        | AuditEventSummary[] | See below |
| `total`         | number              |           |
| `page`          | number              |           |
| `page_size`     | number              |           |
| `correlationId` | string              |           |

**`AuditEventSummary` object:**

| Field             | Type           | Notes                                  |
| ----------------- | -------------- | -------------------------------------- |
| `event_id`        | string         |                                        |
| `event_type`      | string         |                                        |
| `actor_id`        | string \| null |                                        |
| `organization_id` | string         |                                        |
| `decision`        | string         | `allow` \| `deny`                      |
| `payload`         | object \| null | Pre-redacted by `AuditRedactorService` |
| `occurred_at`     | string         | ISO 8601                               |

**Error responses:**

| HTTP | `error_code`         | Meaning                  |
| ---- | -------------------- | ------------------------ |
| 403  | `RBAC_DENIED`        | Actor lacks `audit:read` |
| 400  | `ORG_SCOPE_MISMATCH` | `orgId` ≠ session org    |

## Business Rules

1. RBAC guard: `action = audit:read`.
2. `orgId` must match `session.organizationId`.
3. Apply `AuditRedactorService.redact(event.payload)` before returning. Same sanitizer as audit writer — strips fields matching `password|token|secret|key|nonce|code|hash`.
4. `from_date`/`to_date` used as `occurredAt >= from AND occurredAt <= to` filter.
5. Max date range: 90 days per query (to prevent full-history dumps).
6. Results ordered by `occurredAt DESC`.

## Prisma Models Used

| Model            | Action           | Key fields                            |
| ---------------- | ---------------- | ------------------------------------- |
| `AuthAuditEvent` | Read (paginated) | `organizationId`, filters, date range |

## Test Cases

| ID  | Scenario                          | Expected                   |
| --- | --------------------------------- | -------------------------- |
| T01 | Manager lists audit events        | 200 paginated list         |
| T02 | Filter by `event_type`            | Only matching events       |
| T03 | Filter by `actor_id`              | Only events for that actor |
| T04 | Date range filter                 | Events within range        |
| T05 | Date range > 90 days              | 400 or clamped             |
| T06 | Actor lacks `audit:read`          | 403 `RBAC_DENIED`          |
| T07 | `orgId` mismatch                  | 400 `ORG_SCOPE_MISMATCH`   |
| T08 | `payload` has no sensitive fields | Redaction verified         |

## Definition of Done

- Audit events returned pre-redacted (no tokens/secrets in payload).
- 90-day max date range enforced.
- Ordered by `occurredAt DESC`.
- `ORG_SCOPE_MISMATCH` prevents cross-org access.
