---
task_id: MW-auth-002
module: auth-workspace
runtime: nestjs-api
priority: P0
status: DONE
epic_story: 1.1
depends_on:
  - platform/audit-writer/02-audit-writer-service.md
  - auth-workspace/01-sign-in-endpoint.md
---

# Register via Approved Path Endpoint

## Outcome

Allow a user to register an LCSP account via an approved invitation path; prevent unapproved self-registration; enforce one-time invite consumption; issue session after verified membership.

## Module Files

| File                                                                                                                | Action | Notes                                      |
| ------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------ |
| `apps/api/src/modules/auth-workspace/presentation/http/auth-workspace.controller.ts`                                | Verify | `POST /auth/register-approved-path` exists |
| `apps/api/src/modules/auth-workspace/application/commands/register-approved-path/register-approved-path.command.ts` | Verify | Command shape                              |
| `apps/api/src/modules/auth-workspace/application/commands/register-approved-path/register-approved-path.handler.ts` | Verify | All business rules below                   |
| `apps/api/src/modules/auth-workspace/application/contracts/auth-workspace/register-approved-path.contract.ts`       | Verify | `RegisterPayload` DTO                      |
| `apps/api/src/modules/auth-workspace/domain/entities/user.entity.ts`                                                | Verify | User creation logic                        |
| `apps/api/src/modules/auth-workspace/domain/entities/invitation.entity.ts`                                          | Verify | Invite state machine                       |

## API Contract

**Endpoint:** `POST /auth/register-approved-path`
**Auth required:** No (public)

**Request body:**

| Field          | Type   | Required | Rules                                                |
| -------------- | ------ | -------- | ---------------------------------------------------- |
| `invite_token` | string | Yes      | Opaque token identifying `AuthInvitation`            |
| `email`        | string | Yes      | Must match `AuthInvitation.email` (case-insensitive) |
| `password`     | string | Yes      | Min 12 chars; never logged                           |
| `display_name` | string | No       | Optional user display name                           |

**Success response (200):**

| Field             | Type              | Notes                                            |
| ----------------- | ----------------- | ------------------------------------------------ |
| `session_token`   | string            | Same contract as sign-in                         |
| `expires_at`      | string (ISO 8601) |                                                  |
| `mfa_required`    | boolean           | False for new accounts; MFA set up via Story 1.2 |
| `organization_id` | string            | From `AuthInvitation.organizationId`             |
| `correlationId`   | string            |                                                  |

**Error responses:**

| HTTP | `error_code`               | Meaning                                          |
| ---- | -------------------------- | ------------------------------------------------ |
| 400  | `INVALID_INVITE`           | Invite token not found or `state != approved`    |
| 400  | `INVITE_CONSUMED`          | `AuthInvitation.state = consumed` — cannot reuse |
| 400  | `INVITE_EMAIL_MISMATCH`    | Provided email doesn't match invite email        |
| 400  | `PASSWORD_WEAK`            | Password fails strength requirements             |
| 409  | `EMAIL_ALREADY_REGISTERED` | `AuthUser` with this email already exists        |
| 400  | `INVALID_REQUEST`          | Missing or malformed fields                      |

## Prisma Models Used

| Model            | Action        | Key fields                                                                                                                               |
| ---------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `AuthInvitation` | Read + Update | `id`, `email`, `organizationId`, `state` (`approved` → `consumed`), `policyId`, `policyVersion`, `subjectAttributes`, `membershipStatus` |
| `AuthUser`       | Create        | `id`, `email`, `passwordHash`, `emailVerified = false`, `failedLoginCount = 0`                                                           |
| `AuthMembership` | Create        | `id`, `userId`, `organizationId`, `status = active` (from `invite.membershipStatus`), `policyId`, `policyVersion`, `subjectAttributes`   |
| `AuthSession`    | Create        | Same as sign-in                                                                                                                          |
| `AuthAuditEvent` | Create        | `eventType: AUTH_REGISTER_SUCCESS` or `AUTH_REGISTER_FAILED`                                                                             |

## Business Rules

1. Load `AuthInvitation` by `invite_token`. If not found → `INVALID_INVITE`.
2. Check `invite.state = approved`. If `consumed` → `INVITE_CONSUMED`. If `pending` → `INVALID_INVITE`.
3. Compare email (lowercase) with `invite.email`. If mismatch → `INVITE_EMAIL_MISMATCH`.
4. Check `AuthUser` with `email` does not already exist → else `EMAIL_ALREADY_REGISTERED`.
5. Validate password strength (min 12 chars, at least one digit, one uppercase). If fails → `PASSWORD_WEAK`.
6. Hash password with `bcrypt(password, 10)`. Create `AuthUser`.
7. Create `AuthMembership` with `status`, `policyId`, `policyVersion`, `subjectAttributes` from invite.
8. Set `AuthInvitation.state = consumed` in the same transaction.
9. Create session (same as sign-in flow) after successful registration.
10. Invite token must be one-time only — once `consumed`, any second call with the same token → `INVITE_CONSUMED`.
11. No OAuth identity created here. OAuth is Story 1.3.
12. Emit audit event for success (no password/token in payload) and failure.

## Commands / Events

| Name                            | Type             | Emitter    | Safe payload                                                             |
| ------------------------------- | ---------------- | ---------- | ------------------------------------------------------------------------ |
| `RegisterApprovedPathCommand`   | App command      | Controller | `{ inviteToken, email, password, displayName?, correlationId? }`         |
| `event.auth.register-succeeded` | `AuthAuditEvent` | Handler    | `{ actorId: newUserId, organizationId, correlationId, decision: allow }` |
| `event.auth.register-failed`    | `AuthAuditEvent` | Handler    | `{ reasonCode, correlationId, decision: deny }` — no email/password      |

## PBAC

Public endpoint — no session guard. Post-registration workspace access still goes through PBAC.

## Test Cases

| ID  | Scenario                                                       | Expected                               |
| --- | -------------------------------------------------------------- | -------------------------------------- |
| T01 | Valid invite + matching email + strong password                | 200, session token, membership created |
| T02 | Invite not found                                               | 400 `INVALID_INVITE`                   |
| T03 | Invite state = consumed                                        | 400 `INVITE_CONSUMED`                  |
| T04 | Invite state = pending                                         | 400 `INVALID_INVITE`                   |
| T05 | Email mismatch                                                 | 400 `INVITE_EMAIL_MISMATCH`            |
| T06 | Email already registered                                       | 409 `EMAIL_ALREADY_REGISTERED`         |
| T07 | Weak password                                                  | 400 `PASSWORD_WEAK`                    |
| T08 | Replay same token after success                                | 400 `INVITE_CONSUMED`                  |
| T09 | `AuthInvitation.state` = consumed after success                | DB row updated                         |
| T10 | Membership created with correct `policyId/Version` from invite | DB row matches invite                  |
| T11 | Audit event has no password or invite token                    | `AuthAuditEvent.payload` clean         |
| T12 | `RepositoryConnection` not created                             | No repo side effects                   |

## Definition of Done

- Endpoint returns correct status/body for T01–T12.
- Invite is consumed atomically with user + membership creation (same Prisma transaction).
- Password not in any log, response, or audit payload.
- Replay of invite token after success → `INVITE_CONSUMED`.
- No `RepositoryConnection` or scan permission created.
