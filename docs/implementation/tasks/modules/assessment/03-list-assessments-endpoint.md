---
task_id: MW-asmt-003
module: assessment
runtime: nestjs-api
priority: P0
status: READY_FOR_DEV
epic_story: 2.1
depends_on:
  - assessment/01-create-assessment-endpoint.md
  - platform/pbac/03-nestjs-guard.md
---

# List Assessments Endpoint

## Outcome

Return a paginated list of assessments in the Manager's organization. Managers see their own assessments. Developers see only assessments within their PBAC scope. No risk labels shown.

## Module Files

| File                                                                                               | Action | Notes                           |
| -------------------------------------------------------------------------------------------------- | ------ | ------------------------------- |
| `apps/api/src/modules/assessment/presentation/http/assessment.controller.ts`                       | Modify | Add `GET /assessments`          |
| `apps/api/src/modules/assessment/application/queries/list-assessments/list-assessments.query.ts`   | Create | Query shape + pagination params |
| `apps/api/src/modules/assessment/application/queries/list-assessments/list-assessments.handler.ts` | Create | Paginated DB query              |
| `apps/api/src/modules/assessment/application/contracts/assessment/assessment-list.contract.ts`     | Create | Response DTO                    |

## API Contract

**Endpoint:** `GET /assessments`
**Auth required:** Yes — `@RequireAction('assessment:list')`

**Query parameters:**

| Param       | Type   | Required | Default | Notes                  |
| ----------- | ------ | -------- | ------- | ---------------------- |
| `page`      | number | No       | 1       | Min 1                  |
| `page_size` | number | No       | 20      | Max 100                |
| `status`    | string | No       | —       | Filter by status value |

**Success response (200):**

| Field           | Type                | Notes                           |
| --------------- | ------------------- | ------------------------------- |
| `assessments`   | AssessmentSummary[] | See below                       |
| `total`         | number              | Total count (for pagination UI) |
| `page`          | number              | Current page                    |
| `page_size`     | number              |                                 |
| `correlationId` | string              |                                 |

**`AssessmentSummary` object:**

| Field           | Type   | Notes                                         |
| --------------- | ------ | --------------------------------------------- |
| `assessment_id` | string |                                               |
| `name`          | string |                                               |
| `status`        | string |                                               |
| `wizard_status` | string | `NOT_STARTED` \| `IN_PROGRESS` \| `SUBMITTED` |
| `created_at`    | string | ISO 8601                                      |
| `updated_at`    | string | ISO 8601                                      |

**Error responses:**

| HTTP | `error_code`  | Meaning                       |
| ---- | ------------- | ----------------------------- |
| 403  | `PBAC_DENIED` | Actor lacks `assessment:list` |

## Prisma Models Used

| Model           | Action           | Key fields                                                                          |
| --------------- | ---------------- | ----------------------------------------------------------------------------------- |
| `Assessment`    | Read (paginated) | `organizationId = session.organizationId`, `ownerId = session.userId` (for Manager) |
| `WizardProfile` | Read (join)      | `status` per assessment                                                             |

## Business Rules

1. PBAC guard: `action = assessment:list`.
2. Managers: `WHERE organizationId = session.organizationId AND ownerId = session.userId`.
3. Developers: `WHERE organizationId = session.organizationId AND assessment.id = pbacContext.scope` (scope from membership).
4. `status` filter: if provided, add `AND status = filter.status`. Validate against known status values.
5. Pagination: `OFFSET (page - 1) * page_size, LIMIT page_size`. Max `page_size = 100`.
6. `AssessmentSummary` must not include risk labels, classification values, or technical findings.

## Test Cases

| ID  | Scenario                              | Expected                       |
| --- | ------------------------------------- | ------------------------------ |
| T01 | Manager with assessments              | 200, paginated list            |
| T02 | Manager with no assessments           | 200, empty `assessments` array |
| T03 | `page_size = 5`                       | Only 5 returned                |
| T04 | `status` filter                       | Only matching status returned  |
| T05 | Manager lacks `assessment:list`       | 403 `PBAC_DENIED`              |
| T06 | Developer sees only scoped assessment | Only assessment matching scope |
| T07 | `page_size > 100`                     | Clamped to 100 or rejected     |
| T08 | No risk labels in response            | Verified by field inspection   |

## Definition of Done

- Paginated list returned with correct org-scope filter.
- Managers see only their own assessments.
- Developers see only their scoped assessments.
- No risk/classification content in list response.
