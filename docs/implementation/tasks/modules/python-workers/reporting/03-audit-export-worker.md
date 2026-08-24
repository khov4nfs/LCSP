---
task_id: MW-rep-003
module: python-workers/reporting
runtime: deepagents
priority: P1
status: READY_FOR_DEV
epic_story: 8.7
depends_on:
  - python-workers/platform/01-worker-platform-bootstrap.md
---

# Audit Export Worker

## Outcome

Consume `audit.export-requested` events and generate a pre-redacted audit trail export for an organization within the requested date range. Upload to object storage. Callback to NestJS with export URL.

## Module Files

| File | Action | Notes |
|---|---|---|
| `deepagents/tools/reports/reporting/audit_export_consumer.py` | Create | `ConsumerBase` for `audit.export-requested` |
| `deepagents/tools/reports/reporting/audit_export_generator.py` | Create | Audit fetch + redaction + export |

## RabbitMQ

| Attribute | Value |
|---|---|
| Queue | `reporting.audit-export-requested` |
| Routing key | `audit.export-requested` |
| PBAC preflight | No (system event) |

## Business Rules

1. Fetch `AuditExportRequest` from NestJS API.
2. Fetch audit events via NestJS internal API with `organization_id`, `from_date`, `to_date`.
3. Apply `redact_dict()` to every event payload (same sanitizer as NestJS `AuditSanitizer`).
4. Generate export as JSON Lines (`.jsonl`) format — one event per line.
5. Upload to object storage. Callback to NestJS with `{ status: READY, export_url }`.
6. No LLM calls.

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | Valid date range | Export generated and uploaded |
| T02 | All event payloads redacted | Sensitive fields removed |
| T03 | JSON Lines format | One event per line, valid JSON |
| T04 | Upload fails | `status = FAILED`, logged |

## Definition of Done

- Export in JSON Lines format.
- All payloads pre-redacted before export.
- Uploaded to object storage.
- No LLM calls.
