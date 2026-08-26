---
task_id: MW-aud-002
module: audit
runtime: nestjs-api
priority: P1
status: READY_FOR_DEV
epic_story: 8.7
depends_on:
  - audit/01-list-audit-events-endpoint.md
  - document/03-get-document-status-endpoint.md
---

# Export Audit Trail Endpoint

## Outcome

Allow a Manager to request an export of the organization's audit trail as a downloadable artifact. Export is pre-redacted. Generated asynchronously (queued job). Download via pre-signed URL when ready. Export is immutable once generated.

## Module Files

| File                                                                                               | Action | Notes                                                |
| -------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------- |
| `apps/api/src/modules/audit/presentation/http/audit.controller.ts`                                 | Modify | Add `POST /organizations/:orgId/audit-events/export` |
| `apps/api/src/modules/audit/application/commands/export-audit-trail/export-audit-trail.command.ts` | Create | Command shape                                        |
| `apps/api/src/modules/audit/application/commands/export-audit-trail/export-audit-trail.handler.ts` | Create | Validation + outbox enqueue                          |
| `apps/api/prisma/schema.prisma`                                                                    | Modify | Add `AuditExportRequest` model                       |

## Prisma Model

```prisma
model AuditExportRequest {
  id             String   @id @default(uuid())
  organizationId String
  requestedById  String
  fromDate       DateTime
  toDate         DateTime
  status         String   @default("QUEUED")   // QUEUED | GENERATING | READY | FAILED
  exportUrl      String?
  createdAt      DateTime @default(now())
  completedAt    DateTime?

  @@index([organizationId])
}
```

## API Contract

**Endpoint:** `POST /organizations/:orgId/audit-events/export`
**Auth required:** Yes — `@RequireAction('audit:export')`

**Request body:**

| Field       | Type   | Required | Notes    |
| ----------- | ------ | -------- | -------- |
| `from_date` | string | Yes      | ISO 8601 |
| `to_date`   | string | Yes      | ISO 8601 |

**Success response (202):**

| Field               | Type   | Notes    |
| ------------------- | ------ | -------- |
| `export_request_id` | string |          |
| `status`            | string | `QUEUED` |
| `from_date`         | string |          |
| `to_date`           | string |          |
| `correlationId`     | string |          |

**`GET /organizations/:orgId/audit-events/export/:exportRequestId` (status poll):**

Returns same fields as `document:read` — `status`, `download_url` (pre-signed, 5-min TTL when READY).

**Error responses:**

| HTTP | `error_code`           | Meaning                    |
| ---- | ---------------------- | -------------------------- |
| 403  | `RBAC_DENIED`          | Actor lacks `audit:export` |
| 400  | `DATE_RANGE_TOO_LARGE` | Range > 365 days           |
| 400  | `ORG_SCOPE_MISMATCH`   |                            |

## Business Rules

1. RBAC guard: `action = audit:export`.
2. Org-scope guard: `orgId = session.organizationId`.
3. Max date range: 365 days.
4. Create `AuditExportRequest` + emit outbox `audit.export-requested`.
5. Python reporting worker generates export with pre-redacted events (same sanitizer rules).
6. Completed export stored in object storage. Download URL generated as pre-signed (5-min TTL) per status poll request.
7. Export artifact is immutable once generated.
8. Audit event `AUDIT_EXPORT_REQUESTED` + `AUDIT_EXPORT_READY`.

## Commands / Events

| Name                           | Type             | Safe payload                                                           |
| ------------------------------ | ---------------- | ---------------------------------------------------------------------- |
| `ExportAuditTrailCommand`      | App command      | `{ organizationId, requestedById, fromDate, toDate, correlationId? }`  |
| `event.audit.export-requested` | Outbox           | `{ exportRequestId, organizationId, fromDate, toDate, correlationId }` |
| `AUDIT_EXPORT_REQUESTED`       | `AuthAuditEvent` | `{ exportRequestId, organizationId, correlationId }`                   |

## Test Cases

| ID  | Scenario                             | Expected                   |
| --- | ------------------------------------ | -------------------------- |
| T01 | Valid date range                     | 202 QUEUED                 |
| T02 | Date range > 365 days                | 400 `DATE_RANGE_TOO_LARGE` |
| T03 | Actor lacks `audit:export`           | 403 `RBAC_DENIED`          |
| T04 | org scope mismatch                   | 400 `ORG_SCOPE_MISMATCH`   |
| T05 | Export download has redacted payload | Sensitive fields stripped  |
| T06 | Download URL is pre-signed 5-min TTL | URL verified               |
| T07 | Export immutable after generation    | No mutation path           |

## Definition of Done

- Export requested asynchronously (202).
- Max 365-day range enforced.
- Export payload pre-redacted (same sanitizer as audit writer).
- Download URL pre-signed with 5-min TTL.
- Immutable artifact.
