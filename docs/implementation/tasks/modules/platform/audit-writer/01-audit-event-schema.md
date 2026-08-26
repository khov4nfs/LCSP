---
task_id: MW-audit-001
module: platform/audit-writer
runtime: nestjs-api
priority: P0
status: DONE
epic_story: 1.8
depends_on:
  - platform/config/01-config-loader.md
---

# Audit Event Schema — Prisma + Domain Types

## Outcome

Define the shared audit event schema (Prisma model + TypeScript types) used by all modules. No audit event write logic here — this task is the schema and type definitions only.

## Module Files

| File                                                | Action | Notes                                                                           |
| --------------------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| `apps/api/prisma/schema.prisma`                     | Modify | Add/verify `AuthAuditEvent` model (already partially exists — extend if needed) |
| `packages/contracts/src/audit/audit-event.types.ts` | Create | Shared `AuditEventType` union + payload interfaces                              |
| `apps/api/src/platform/audit/audit-event.entity.ts` | Create | Domain `AuditEvent` entity class                                                |

## Prisma Model

As migrated (source of truth: `apps/api/prisma/schema.prisma`):

```prisma
enum AuthDecision {
  allow
  deny
}

model AuthAuditEvent {
  id             String            @id
  eventType      String
  actorId        String?
  organizationId String?
  decision       AuthDecision?
  reasonCode     String?
  correlationId  String
  sessionId      String?
  policyId       String?
  policyVersion  String?
  payload        Json
  createdAt      DateTime          @default(now())
  organization   AuthOrganization? @relation(fields: [organizationId], references: [id])

  @@index([correlationId])
  @@index([organizationId, createdAt])
  @@index([actorId, createdAt])
  @@index([eventType, createdAt])
}
```

## TypeScript Types

As implemented (source of truth: `packages/contracts/src/audit/audit-event.types.ts`):

```typescript
// packages/contracts/src/audit/audit-event.types.ts

export type AuditDecision = "allow" | "deny";

export interface AuditEventInput {
  eventType: string;
  actorId: string | null;
  organizationId: string | null;
  correlationId: string;
  decision: AuditDecision | null;
  payload?: Record<string, unknown>;
}

export interface AuditEvent extends AuditEventInput {
  id: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
}
```

`AuditEvent.occurredAt` is the TS-facing name for the Prisma `createdAt` column — callers reading a persisted row map `createdAt` → `occurredAt`; the DB column itself is `createdAt`, not `occurredAt`.

## Business Rules

1. `payload` is `Json` (**required**, non-nullable) — writers must always pass an object (use `{}` when there is no payload).
2. `actorId` is nullable for unauthenticated system events.
3. `organizationId` is nullable for cross-org or system events; when present it backs a real relation to `AuthOrganization`.
4. `decision` is the `AuthDecision` enum (`allow` | `deny`), nullable — not a plain string column. Contracts' `AuditEventInput.decision` is typed `AuditDecision | null` to match.
5. Indexes: single-column `(correlationId)`, plus composite `(organizationId, createdAt)`, `(actorId, createdAt)`, `(eventType, createdAt)` to support audit log queries.
6. `id` is `String @id` with **no Prisma-level default** — it is application-generated (`crypto.randomUUID()` in the writer service), consistent with every other model's id convention in this schema (no model uses `@default(uuid())`).
7. `reasonCode`, `sessionId`, `policyId`, `policyVersion` are additional nullable columns not present in `AuditEventInput` — they exist for other write paths (e.g. RBAC decision logging) outside this task's scope; `AuditWriterService.write()` leaves them unset.

## Test Cases

| ID  | Scenario                                      | Expected                                              |
| --- | --------------------------------------------- | ----------------------------------------------------- |
| T01 | Create event with all fields                  | Row created, all fields persisted                     |
| T02 | Create event with `actorId = null`            | Row created with NULL actorId                         |
| T03 | Create event with `payload = {}`              | Row created; `payload` is required and cannot be NULL |
| T04 | Query by `organizationId + createdAt` range   | Uses index, returns correct events                    |
| T05 | `AuditEventInput` type accepted by TypeScript | No type errors in consuming modules                   |

## Definition of Done

- Prisma model `AuthAuditEvent` migrated and indexes in place.
- `AuditEventInput` and `AuditEvent` types exported from `packages/contracts`.
- All fields nullable where appropriate.
- Domain entity class available for use by audit writer service.
