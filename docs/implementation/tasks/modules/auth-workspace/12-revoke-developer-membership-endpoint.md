---
task_id: MW-auth-012
module: auth-workspace
runtime: nestjs-api
priority: P0
status: REVIEW
epic_story: 1.5
depends_on:
  - auth-workspace/10-invite-developer-endpoint.md
  - auth-workspace/11-accept-developer-invitation-endpoint.md
  - platform/pbac/03-nestjs-guard.md
  - platform/audit-writer/02-audit-writer-service.md
---

# Revoke Developer Membership Endpoint

## Outcome

Allow a Manager to revoke a Developer's membership in their organization. Revocation is immediate: all active sessions for the Developer in that org are invalidated. Assessment access is removed. Manager's own workflow is unaffected.

## Module Files

| File                                                                                                      | Action | Notes                                                  |
| --------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------ |
| `apps/api/src/modules/auth-workspace/presentation/http/auth-workspace.controller.ts`                      | Modify | Add `DELETE /organizations/:orgId/memberships/:userId` |
| `apps/api/src/modules/auth-workspace/application/commands/revoke-membership/revoke-membership.command.ts` | Create | Command shape                                          |
| `apps/api/src/modules/auth-workspace/application/commands/revoke-membership/revoke-membership.handler.ts` | Create | Revocation logic                                       |
| `apps/api/src/modules/auth-workspace/application/contracts/auth-workspace/revoke-membership.contract.ts`  | Create | Request/response DTOs                                  |
| `apps/api/src/modules/auth-workspace/auth-workspace.module.ts`                                            | Modify | Register new handler                                   |

## API Contract

**Endpoint:** `DELETE /organizations/:orgId/memberships/:userId`
**Auth required:** Yes — Manager session + PBAC allow `membership:revoke`

**Path parameters:**

| Param    | Type   | Required | Notes                                    |
| -------- | ------ | -------- | ---------------------------------------- |
| `orgId`  | string | Yes      | Organization ID — must match session org |
| `userId` | string | Yes      | Target Developer user ID to revoke       |

**Success response (200):**

| Field               | Type    | Notes                         |
| ------------------- | ------- | ----------------------------- |
| `revoked`           | boolean | Always `true`                 |
| `affected_sessions` | number  | Count of sessions invalidated |
| `correlationId`     | string  |                               |

**Error responses:**

| HTTP | `error_code`           | Meaning                                      |
| ---- | ---------------------- | -------------------------------------------- |
| 403  | `PBAC_DENIED`          | Manager lacks `membership:revoke` permission |
| 404  | `MEMBERSHIP_NOT_FOUND` | No active membership for `userId` in `orgId` |
| 400  | `CANNOT_SELF_REVOKE`   | Manager cannot revoke their own membership   |
| 400  | `ORG_SCOPE_MISMATCH`   | `orgId` path param ≠ session org             |

## Prisma Models Used

| Model             | Action      | Key fields                                                                             |
| ----------------- | ----------- | -------------------------------------------------------------------------------------- |
| `AuthMembership`  | Update      | Find `(userId, orgId, status = active)`. Set `status = revoked`, `revokedAt = now()`.  |
| `AuthSession`     | Update bulk | Find all non-revoked sessions for `(userId, orgId)`. Set `revokedAt = now()` for each. |
| `AuthDecisionLog` | Create      | PBAC allow/deny for `membership:revoke` action                                         |
| `AuthAuditEvent`  | Create      | `AUTH_DEVELOPER_REVOKED`                                                               |

## Business Rules

1. PBAC guard: `action = membership:revoke`, `subject = Manager`, `org = session.organizationId`. Deny if not allowed.
2. Validate `orgId == session.organizationId`. If mismatch → `ORG_SCOPE_MISMATCH`.
3. Prevent self-revoke: if `userId == session.userId` → `CANNOT_SELF_REVOKE`.
4. Look up `AuthMembership` for `(userId, orgId, status = active)`. If not found → `MEMBERSHIP_NOT_FOUND`.
5. In a single DB transaction:
   - Set `AuthMembership.status = revoked`, `revokedAt = now()`.
   - Bulk set `revokedAt = now()` on all active `AuthSession` rows for `(userId, orgId)`.
6. Session invalidation is immediate — next request from Developer returns `SESSION_INVALID`.
7. Emit audit event `AUTH_DEVELOPER_REVOKED` with actor, org, target userId, session count. No session tokens in payload.

## Commands / Events

| Name                           | Type             | Safe payload                                                         |
| ------------------------------ | ---------------- | -------------------------------------------------------------------- |
| `RevokeMembershipCommand`      | App command      | `{ orgId, targetUserId, correlationId? }`                            |
| `event.auth.developer-revoked` | `AuthAuditEvent` | `{ actorId, orgId, revokedUserId, affectedSessions, correlationId }` |

## PBAC

Manager must have `membership:revoke` in their `AuthPolicy.actions`. PBAC decision logged via `AuthDecisionLog`.

## Test Cases

| ID  | Scenario                                                  | Expected                                       |
| --- | --------------------------------------------------------- | ---------------------------------------------- |
| T01 | Manager with `membership:revoke` + valid Developer userId | 200 — membership revoked, sessions invalidated |
| T02 | Manager lacks `membership:revoke`                         | 403 `PBAC_DENIED`                              |
| T03 | Developer has no active membership                        | 404 `MEMBERSHIP_NOT_FOUND`                     |
| T04 | Manager tries to revoke own membership                    | 400 `CANNOT_SELF_REVOKE`                       |
| T05 | orgId path param ≠ session org                            | 400 `ORG_SCOPE_MISMATCH`                       |
| T06 | Developer's active session returns 401 after revoke       | Session invalidation verified                  |
| T07 | `affected_sessions` count matches bulk update             | Correct count in response                      |
| T08 | Audit payload has no session token values                 | Clean payload                                  |
| T09 | Manager workspace and sessions unaffected                 | Manager flow continues                         |
| T10 | Already-revoked membership returns 404                    | Idempotent lookup                              |

## Definition of Done

- Membership set to `revoked` in single transaction with session bulk-invalidation.
- `CANNOT_SELF_REVOKE` enforced.
- PBAC deny logged for unauthorized calls.
- No session token material in audit payload.
- Developer's next request returns `SESSION_INVALID` immediately.

## Dev Agent Record

### Debug Log References

- RED: `rtk pnpm --filter @lcsp/api test:e2e --runTestsByPath test/revoke-membership.e2e-spec.ts` failed with 404 before `DELETE /organizations/:orgId/memberships/:userId` existed.
- GREEN: `rtk pnpm --filter @lcsp/api test:e2e --runTestsByPath test/revoke-membership.e2e-spec.ts` passed.
- Regression: `rtk pnpm --filter @lcsp/api test:e2e --runTestsByPath test/accept-invitation.e2e-spec.ts test/invite-developer.e2e-spec.ts test/revoke-membership.e2e-spec.ts` passed.
- DoD: `npm run lint`, `pnpm --filter @lcsp/api run build`, `rtk pnpm --filter @lcsp/api test`, and `rtk pnpm --filter @lcsp/api test:e2e` passed.

### Completion Notes

- Added protected `DELETE /organizations/:orgId/memberships/:userId` endpoint with `PbacGuard` and `RequireAction("membership:revoke")`.
- Implemented Developer-only membership revocation with self-revoke prevention, org scope mismatch handling, active-membership lookup, single-transaction membership status update, active session invalidation, and clean audit event.
- Added `AuthMembership.revokedAt` persistence field and migration to support revocation lifecycle timestamp.
- Added e2e coverage for success, PBAC deny, missing/already revoked membership, self revoke, org mismatch, immediate Developer session invalidation, audit redaction, affected session count, and Manager workflow continuity.

### File List

- apps/api/prisma/migrations/20260713080000_auth_membership_revoked_at/migration.sql
- apps/api/prisma/schema.prisma
- apps/api/src/modules/auth-workspace/application/commands/revoke-membership/revoke-membership.command.ts
- apps/api/src/modules/auth-workspace/application/commands/revoke-membership/revoke-membership.handler.ts
- apps/api/src/modules/auth-workspace/application/contracts/auth-workspace/revoke-membership.contract.ts
- apps/api/src/modules/auth-workspace/application/services/auth-workspace/auth-workspace.facade.ts
- apps/api/src/modules/auth-workspace/auth-workspace.module.ts
- apps/api/src/modules/auth-workspace/presentation/http/auth-workspace.controller.ts
- apps/api/test/revoke-membership.e2e-spec.ts
- docs/developer/task-index.md
- docs/implementation/tasks/modules/auth-workspace/12-revoke-developer-membership-endpoint.md

### Change Log

- 2026-07-13: Implemented MW-auth-012 Revoke Developer Membership Endpoint and moved task to review.
