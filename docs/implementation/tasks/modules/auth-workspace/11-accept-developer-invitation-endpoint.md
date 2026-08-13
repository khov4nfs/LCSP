---
task_id: MW-auth-011
module: auth-workspace
runtime: nestjs-api
priority: P0
status: REVIEW
epic_story: 1.5
depends_on:
  - auth-workspace/10-invite-developer-endpoint.md
  - platform/audit-writer/02-audit-writer-service.md
---

# Accept Developer Invitation Endpoint

## Outcome

Allow a Developer to consume a scoped invitation token, create their account and org membership, and receive an LCSP session. The invitation is consumed atomically — one-time use only. Manager golden path is not affected.

## Module Files

| File                                                                                                      | Action | Notes                                           |
| --------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------- |
| `apps/api/src/modules/auth-workspace/presentation/http/auth-workspace.controller.ts`                      | Modify | Add `POST /auth/accept-invitation`              |
| `apps/api/src/modules/auth-workspace/application/commands/accept-invitation/accept-invitation.command.ts` | Create | Command shape                                   |
| `apps/api/src/modules/auth-workspace/application/commands/accept-invitation/accept-invitation.handler.ts` | Create | Invitation consumption + account creation logic |
| `apps/api/src/modules/auth-workspace/application/contracts/auth-workspace/accept-invitation.contract.ts`  | Create | Request/response DTOs                           |
| `apps/api/src/modules/auth-workspace/auth-workspace.module.ts`                                            | Modify | Register new handler                            |

## API Contract

**Endpoint:** `POST /auth/accept-invitation`
**Auth required:** No (invitation token is the credential)

**Request body:**

| Field              | Type   | Required | Notes                                                              |
| ------------------ | ------ | -------- | ------------------------------------------------------------------ |
| `invitation_token` | string | Yes      | From invitation link (maps to `AuthInvitation.id` or signed token) |
| `display_name`     | string | Yes      | Developer display name; 1–100 chars                                |
| `password`         | string | Yes      | Min 12 chars; bcrypt stored                                        |

**Success response (201):**

| Field             | Type     | Notes                          |
| ----------------- | -------- | ------------------------------ |
| `user_id`         | string   | Newly created user ID          |
| `session_token`   | string   | Active LCSP session            |
| `expires_at`      | string   | ISO 8601                       |
| `organization_id` | string   |                                |
| `allowed_actions` | string[] | From accepted invitation scope |
| `correlationId`   | string   |                                |

**Error responses:**

| HTTP | `error_code`              | Meaning                                 |
| ---- | ------------------------- | --------------------------------------- |
| 400  | `INVITATION_INVALID`      | Not found, expired, or already consumed |
| 400  | `INVITATION_NOT_APPROVED` | Invitation not in `approved` state      |
| 409  | `EMAIL_ALREADY_EXISTS`    | Invitation email already has an account |
| 422  | `PASSWORD_TOO_SHORT`      | Password under 12 chars                 |

## Prisma Models Used

| Model            | Action        | Key fields                                                                                                             |
| ---------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `AuthInvitation` | Read + Update | Find by token, verify `state = approved`, `expiresAt > now()`. Atomic update `state = consumed`.                       |
| `AuthUser`       | Create        | `id`, `email` (from invitation), `passwordHash`, `displayName`, `emailVerified = true` (invite implies email verified) |
| `AuthMembership` | Create        | `userId`, `organizationId`, `status = active`, `subjectAttributes` (from invitation), `policyId`, `policyVersion`      |
| `AuthSession`    | Create        | `tokenFingerprint`, `tokenHash`, `userId`, `organizationId`, `expiresAt`                                               |
| `AuthAuditEvent` | Create        | `AUTH_DEVELOPER_INVITATION_ACCEPTED`                                                                                   |

## Business Rules

1. Look up `AuthInvitation` by `invitation_token`. If not found → `INVITATION_INVALID`.
2. Check `state = approved`. If `consumed` or any other state → `INVITATION_INVALID`.
3. Check `expiresAt > now()`. If expired → `INVITATION_INVALID`.
4. Check no existing `AuthUser` with `email = invitation.email`. If exists → `EMAIL_ALREADY_EXISTS`.
5. Hash password with bcrypt (cost 12). Validate min 12 chars before hashing.
6. In a single DB transaction:
   - Create `AuthUser` with `emailVerified = true` (invitation email pre-verified).
   - Create `AuthMembership` from invitation's `subjectAttributes`, `policyId`, `policyVersion`.
   - Update `AuthInvitation.state = consumed`.
   - Create `AuthSession`.
7. `allowed_actions` in response comes from invited membership's policy (projection hint only — not authoritative).
8. Emit audit event `AUTH_DEVELOPER_INVITATION_ACCEPTED` — no password or token in payload.

## Commands / Events

| Name                             | Type             | Safe payload                                                   |
| -------------------------------- | ---------------- | -------------------------------------------------------------- |
| `AcceptInvitationCommand`        | App command      | `{ invitationToken, displayName, password, correlationId? }`   |
| `event.auth.invitation-accepted` | `AuthAuditEvent` | `{ userId, orgId, invitationId, correlationId }` — no password |

## PBAC

Public endpoint. Developer's PBAC policy is seeded from the invitation's `subjectAttributes` and `policyId`. No guard at this endpoint.

## Test Cases

| ID  | Scenario                                               | Expected                                |
| --- | ------------------------------------------------------ | --------------------------------------- |
| T01 | Valid invitation + valid password                      | 201 — user, membership, session created |
| T02 | Token not found                                        | 400 `INVITATION_INVALID`                |
| T03 | Invitation already consumed                            | 400 `INVITATION_INVALID`                |
| T04 | Invitation expired                                     | 400 `INVITATION_INVALID`                |
| T05 | Email already has an account                           | 409 `EMAIL_ALREADY_EXISTS`              |
| T06 | Password under 12 chars                                | 422 `PASSWORD_TOO_SHORT`                |
| T07 | Transaction rolled back if any step fails              | No partial state in DB                  |
| T08 | `AuthInvitation.state = consumed` after acceptance     | DB verified                             |
| T09 | Audit event has no password or token material          | Clean payload                           |
| T10 | `allowed_actions` in response matches invitation scope | Projection correct                      |
| T11 | Manager workspace not affected                         | Manager flow uninterrupted              |

## Definition of Done

- Invitation consumed atomically in one transaction (user + membership + session + consumed state).
- Invalid/expired/consumed invitations return `INVITATION_INVALID`.
- No password in audit payload or logs.
- Developer membership `subjectAttributes` matches original invitation scope exactly.

## Dev Agent Record

### Debug Log References

- RED: `rtk pnpm --filter @lcsp/api test:e2e --runTestsByPath test/accept-invitation.e2e-spec.ts` failed with 404 before `POST /auth/accept-invitation` existed.
- GREEN: `rtk pnpm --filter @lcsp/api test:e2e --runTestsByPath test/accept-invitation.e2e-spec.ts` passed.
- Regression: `rtk pnpm --filter @lcsp/api test:e2e --runTestsByPath test/invite-developer.e2e-spec.ts` passed.
- DoD: `npm run lint`, `pnpm --filter @lcsp/api run build`, `rtk pnpm --filter @lcsp/api test`, and `rtk pnpm --filter @lcsp/api test:e2e` passed.

### Completion Notes

- Added public `POST /auth/accept-invitation` endpoint with invitation token, display name, and password contract.
- Implemented atomic Developer invitation acceptance: validate approved/unexpired token, reject duplicate email and short password, consume invitation, create user, membership, session, and acceptance audit in one transaction.
- Returned scoped Developer projection with organization, session expiry, correlation ID, and allowed action hint without treating it as PBAC authority.
- Added e2e coverage for valid accept, missing/consumed/expired token, duplicate email, short password, audit redaction, and Manager golden path continuity.

### File List

- apps/api/src/modules/auth-workspace/application/commands/accept-invitation/accept-invitation.command.ts
- apps/api/src/modules/auth-workspace/application/commands/accept-invitation/accept-invitation.handler.ts
- apps/api/src/modules/auth-workspace/application/contracts/auth-workspace/accept-invitation.contract.ts
- apps/api/src/modules/auth-workspace/application/services/auth-workspace/auth-workspace.facade.ts
- apps/api/src/modules/auth-workspace/auth-workspace.module.ts
- apps/api/src/modules/auth-workspace/presentation/http/auth-workspace.controller.ts
- apps/api/src/platform/pbac/pbac-context.loader.spec.ts
- apps/api/test/accept-invitation.e2e-spec.ts
- docs/developer/task-index.md
- docs/implementation/tasks/modules/auth-workspace/11-accept-developer-invitation-endpoint.md

### Change Log

- 2026-07-13: Implemented MW-auth-011 Accept Developer Invitation Endpoint and moved task to review.
