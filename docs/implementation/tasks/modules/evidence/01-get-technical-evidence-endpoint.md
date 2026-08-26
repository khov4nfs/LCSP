---
task_id: MW-evid-001
module: evidence
runtime: nestjs-api
priority: P0
status: DONE
epic_story: 3.5
depends_on:
  - scan/02-scan-job-callback-endpoint.md
  - platform/rbac/03-nestjs-guard.md
---

# Get Technical Evidence Report Endpoint

## Outcome

Return the accepted `TechnicalEvidenceReport` for an assessment. Manager sees redacted findings for owned assessments. Any non-Manager evidence projection requires explicit RBAC policy and remains redacted. Never returns source code, secrets, or raw tool output. Provenance metadata included.

## Module Files

| File                                                                                       | Action | Notes                                     |
| ------------------------------------------------------------------------------------------ | ------ | ----------------------------------------- |
| `apps/api/src/modules/evidence/presentation/http/evidence.controller.ts`                   | Create | `GET /assessments/:assessmentId/evidence` |
| `apps/api/src/modules/evidence/application/queries/get-evidence/get-evidence.query.ts`     | Create | Query shape                               |
| `apps/api/src/modules/evidence/application/queries/get-evidence/get-evidence.handler.ts`   | Create | Evidence projection + redaction           |
| `apps/api/src/modules/evidence/application/services/evidence/evidence-redactor.service.ts` | Create | Redact findings and sensitive fields      |
| `apps/api/src/modules/evidence/application/contracts/evidence/evidence-detail.contract.ts` | Create | Response DTO                              |
| `apps/api/src/modules/evidence/evidence.module.ts`                                         | Create | NestJS module wiring                      |

## API Contract

**Endpoint:** `GET /assessments/:assessmentId/evidence`
**Auth required:** Yes — `@RequireAction('evidence:read')`

**Success response (200):**

| Field                | Type      | Notes                                   |
| -------------------- | --------- | --------------------------------------- |
| `evidence_report_id` | string    |                                         |
| `assessment_id`      | string    |                                         |
| `schema_version`     | string    |                                         |
| `tools_version`      | object    | Tool → version map                      |
| `config_hash`        | object    | Tool → config hash                      |
| `findings`           | Finding[] | Redacted findings (see below)           |
| `privacy_flags`      | object    | `containsSourceCode`, `secretsRedacted` |
| `status`             | string    | `accepted`                              |
| `created_at`         | string    | ISO 8601                                |
| `correlationId`      | string    |                                         |

**`Finding` object:**

| Field          | Type           | Notes                                                                 |
| -------------- | -------------- | --------------------------------------------------------------------- |
| `finding_id`   | string         |                                                                       |
| `tool`         | string         | Tool name                                                             |
| `finding_type` | string         | e.g., `dependency`, `ai_usage_signal`                                 |
| `severity`     | string         | `LOW` \| `MEDIUM` \| `HIGH` (internal tool severity — not legal risk) |
| `description`  | string         | Redacted description                                                  |
| `file_path`    | string \| null | Redacted when policy requires path hiding                             |
| `line_number`  | number \| null | Redacted when policy requires line hiding                             |

**Error responses:**

| HTTP | `error_code`         | Meaning                             |
| ---- | -------------------- | ----------------------------------- |
| 403  | `RBAC_DENIED`        | Actor lacks required action         |
| 404  | `EVIDENCE_NOT_FOUND` | No accepted evidence for assessment |

## Business Rules

1. RBAC guard: `action = evidence:read`.
2. Org-scope guard: `evidence.organizationId = session.organizationId`.
3. Redaction removes or nulls source-location fields when policy requires narrowed evidence access.
4. Raw source code must never appear in findings — validated at evidence acceptance (scan callback). But double-check: redactor removes any field matching known source-code patterns.
5. Response must not include secrets — `privacy_flags.secretsRedacted = true` already enforced at acceptance.
6. Only `status = accepted` evidence is returned. Rejected evidence is not accessible.

## Prisma Models Used

| Model                     | Action | Key fields                                            |
| ------------------------- | ------ | ----------------------------------------------------- |
| `TechnicalEvidenceReport` | Read   | `assessmentId`, `organizationId`, `status = accepted` |

## Test Cases

| ID  | Scenario                       | Expected                         |
| --- | ------------------------------ | -------------------------------- |
| T01 | Manager reads evidence         | All findings including file_path |
| T02 | Narrowed redacted projection   | `file_path`, `line_number` null  |
| T03 | No accepted evidence           | 404 `EVIDENCE_NOT_FOUND`         |
| T04 | Actor lacks required action    | 403 `RBAC_DENIED`                |
| T05 | Evidence from different org    | 404 `EVIDENCE_NOT_FOUND`         |
| T06 | Rejected evidence not returned | Only `status = accepted` visible |
| T07 | No source code in findings     | Field inspection                 |

## Definition of Done

- Manager sees redacted findings for owned assessments; narrowed projections keep file_path/line_number redacted.
- Only `status = accepted` evidence returned.
- No source code or secrets in response.
- Provenance metadata (`tools_version`, `config_hash`, `schema_version`) included.
