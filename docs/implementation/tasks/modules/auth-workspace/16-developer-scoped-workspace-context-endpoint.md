---
task_id: MW-auth-016
module: auth-workspace
runtime: nestjs-api
priority: P0
status: DONE
epic_story: 1.5
depends_on:
  - auth-workspace/15-preview-developer-invitation-endpoint.md
  - auth-workspace/13-pbac-guard.md
  - assessment/02-get-assessment-endpoint.md
---

# Developer Scoped Workspace Context Endpoint

## Outcome

Return the current, display-safe organization and assessment context for an authenticated Developer's assigned task, including only currently granted Developer actions. This projection is the authoritative source for the scoped Web workspace and must immediately fail closed after session revocation or policy/scope narrowing.

## Module Files

| File                                                                                                                       | Action | Notes                                                                   |
| -------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------- |
| `apps/api/src/modules/auth-workspace/presentation/http/auth-workspace.controller.ts`                                       | Modify | Add `GET /workspace/developer-task`                                     |
| `apps/api/src/modules/auth-workspace/application/queries/get-developer-task-context/get-developer-task-context.query.ts`   | Create | Authenticated query shape                                               |
| `apps/api/src/modules/auth-workspace/application/queries/get-developer-task-context/get-developer-task-context.handler.ts` | Create | PBAC/scope validation and safe projection                               |
| `apps/api/src/modules/auth-workspace/application/contracts/auth-workspace/developer-task-context.contract.ts`              | Create | Success and stable error contract                                       |
| `apps/api/src/modules/auth-workspace/application/ports/persistence/assessment-scope.repository.ts`                         | Modify | Add organization-scoped assessment display lookup                       |
| `apps/api/src/modules/auth-workspace/infrastructure/persistence/prisma-assessment-scope.repository.ts`                     | Modify | Select only assessment ID, organization ID, and name                    |
| `apps/api/src/modules/auth-workspace/application/services/auth-workspace/auth-workspace.facade.ts`                         | Modify | Expose query dispatch                                                   |
| `apps/api/src/modules/auth-workspace/auth-workspace.module.ts`                                                             | Modify | Register the context handler                                            |
| `apps/api/src/platform/pbac/decorators/require-any-action-as-pbac.decorator.ts`                                            | Create | Keep inactive-membership failures non-enumerating for this scoped route |
| `apps/api/src/platform/pbac/decorators/pbac-metadata.ts`                                                                   | Modify | Carry endpoint-specific membership denial behavior                      |
| `apps/api/src/platform/pbac/pbac.guard.ts`                                                                                 | Modify | Map inactive membership to the endpoint's stable `PBAC_DENIED` contract |
| `packages/contracts/src/auth/audit-event-types.ts`                                                                         | Modify | Add allow/deny context projection audit events                          |
| `apps/api/test/developer-task-context.e2e-spec.ts`                                                                         | Create | Scope, revocation, narrowing, and non-leak coverage                     |

## API Contract

**Endpoint:** `GET /workspace/developer-task`  
**Auth required:** Yes — active LCSP session plus PBAC evaluation using the membership's persisted organization, subject attributes, policy version, scope, and current policy actions.

**Success response (200):**

| Field                | Type                                                                                                             | Notes                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `organization`       | `{ id: string, name: string }`                                                                                   | Session organization only                                                                     |
| `scope`              | `{ type: 'assessment', assessment: { id: string, name: string } } \| { type: 'organization', assessment: null }` | Derived from current membership subject attributes                                            |
| `granted_actions`    | string[]                                                                                                         | Current policy actions intersected with invitation attributes and `DEVELOPER_ALLOWED_ACTIONS` |
| `session_expires_at` | string                                                                                                           | ISO 8601                                                                                      |
| `correlationId`      | string                                                                                                           | Safe correlation identifier                                                                   |

**Error responses:**

| HTTP | `error_code`           | Meaning                                                                                                  |
| ---- | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| 401  | `SESSION_INVALID`      | Session missing, expired, or revoked                                                                     |
| 401  | `MFA_REQUIRED`         | Organization policy requires unfinished MFA                                                              |
| 403  | `PBAC_DENIED`          | Membership inactive, policy unavailable/denied, non-Developer subject, or required scoped access removed |
| 404  | `TASK_SCOPE_NOT_FOUND` | Persisted assessment scope cannot be resolved inside the session organization                            |

The 403 and 404 bodies expose no policy internals, membership details, foreign organization data, or alternate assessment identifiers.

## Prisma Models Used

| Model              | Action | Key fields                                            |
| ------------------ | ------ | ----------------------------------------------------- |
| `AuthSession`      | Read   | Active session, user, organization, expiry, MFA state |
| `AuthMembership`   | Read   | Status, subject attributes, pinned policy/version     |
| `AuthPolicy`       | Read   | Current allowed action projection                     |
| `AuthOrganization` | Read   | `id`, `name`                                          |
| `Assessment`       | Read   | `id`, `organizationId`, `name`                        |

## Business Rules

1. Evaluate PBAC from the authenticated session and persisted membership; never authorize from a `Developer` label alone.
2. Require an active membership in the exact session organization. Missing attributes, policy/evaluator/cache failure, malformed scope, or organization mismatch fail closed.
3. Determine scope only from persisted membership subject attributes created from the accepted invitation. Ignore client-supplied organization, role, scope, or actions.
4. For assessment scope, resolve the label only when the assessment belongs to the session organization and its ID exactly equals the persisted scope.
5. Compute `granted_actions` as the intersection of persisted subject allowed actions, current policy actions, and `DEVELOPER_ALLOWED_ACTIONS`. Never return arbitrary or Manager-only actions.
6. Revoked session returns `401 SESSION_INVALID`; a still-valid session whose policy/action scope was narrowed returns `403 PBAC_DENIED`.
7. Do not return findings, source code, file paths, line numbers, repository metadata, policy internals, or Manager-only capabilities. Findings remain owned by `GET /assessments/:assessmentId/evidence`.
8. Record allow/deny audit decisions with actor, organization, resource/scope, action, outcome, policy ID/version, and correlation ID; never include raw token or inaccessible labels.
9. This endpoint does not make Developer participation mandatory and cannot alter Manager workflow or assessment state.

## PBAC

Protected by session validation and PBAC. Assessment-scoped context requires the current membership scope to match the assessment and at least one currently allowed Developer task action. All dependency failures deny by default.

## Test Cases

| ID  | Scenario                                      | Expected                                                                                 |
| --- | --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| T01 | Active Developer with assessment scope        | 200 with exact org/assessment labels and whitelisted current actions                     |
| T02 | Active organization-scoped Developer          | 200 with organization scope and null assessment                                          |
| T03 | Revoked or expired session                    | 401 `SESSION_INVALID`                                                                    |
| T04 | Policy narrowed while session remains valid   | 403 `PBAC_DENIED`                                                                        |
| T05 | Membership revoked but session record remains | Fail closed; no context returned                                                         |
| T06 | Scope points to foreign/missing assessment    | 404 `TASK_SCOPE_NOT_FOUND`; no foreign label leaked                                      |
| T07 | Policy contains Manager-only action           | Action absent from response                                                              |
| T08 | Missing policy/evaluator failure              | 403 `PBAC_DENIED` and deny audit                                                         |
| T09 | Response inspection                           | No findings, location data, repository data, policy internals, or raw subject attributes |
| T10 | Manager calls Developer endpoint              | 403 `PBAC_DENIED`; Manager workspace remains unaffected                                  |

## Definition of Done

- The Web can load exact post-acceptance organization/assessment labels and current scoped actions without using Manager-only assessment reads.
- Session revocation and action narrowing produce distinct 401/403 outcomes and never leave protected context accessible.
- Cross-tenant and malformed-scope states fail closed with safe errors and audited decisions.
- E2E tests cover positive, negative, revocation, narrowing, tenant-isolation, and response-redaction behavior.
