---
task_id: MW-auth-001
module: auth-workspace
runtime: nestjs-api
priority: P0
status: DONE
epic_story: 1.1
depends_on:
  - platform/pbac/03-nestjs-guard.md
  - platform/audit-writer/02-audit-writer-service.md
---

# Sign-In Endpoint

## Outcome

Authenticate a user with email + password against an approved LCSP account, enforce membership gate, issue a scoped session token, and audit the result.

## Module Files

| File                                                                                           | Action | Notes                                                                 |
| ---------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------- |
| `apps/api/src/modules/auth-workspace/presentation/http/auth-workspace.controller.ts`           | Verify | `POST /auth/sign-in` handler exists                                   |
| `apps/api/src/modules/auth-workspace/application/commands/sign-in/sign-in.command.ts`          | Verify | Command shape: `{ email, password, organizationId?, correlationId? }` |
| `apps/api/src/modules/auth-workspace/application/commands/sign-in/sign-in.handler.ts`          | Verify | All business rules below                                              |
| `apps/api/src/modules/auth-workspace/application/contracts/auth-workspace/sign-in.contract.ts` | Verify | `CredentialPayload` DTO + response type                               |
| `apps/api/src/modules/auth-workspace/domain/entities/session.entity.ts`                        | Verify | Session creation logic                                                |
| `apps/api/src/modules/auth-workspace/infrastructure/security/security.utils.ts`                | Verify | Password hashing, token generation                                    |

## API Contract

**Endpoint:** `POST /auth/sign-in`
**Auth required:** No (public)

**Request body:**

| Field             | Type   | Required | Rules                                                      |
| ----------------- | ------ | -------- | ---------------------------------------------------------- |
| `email`           | string | Yes      | Normalize to lowercase before lookup                       |
| `password`        | string | Yes      | Never log, compare against bcrypt hash only                |
| `organization_id` | string | No       | Scope membership check; defaults to single org if only one |

**Success response (200):**

| Field             | Type              | Notes                                                      |
| ----------------- | ----------------- | ---------------------------------------------------------- |
| `session_token`   | string            | Opaque 32-byte random; securely transmitted only           |
| `expires_at`      | string (ISO 8601) | 8h if no MFA, 1h if MFA challenge pending                  |
| `mfa_required`    | boolean           | True if user has `AuthUserMfa` and `mfaVerifiedAt` is null |
| `organization_id` | string            | Active org scope                                           |
| `correlationId`   | string            | Echo of request header or server-generated                 |

**Error responses:**

| HTTP | `error_code`                  | Meaning                                                                 |
| ---- | ----------------------------- | ----------------------------------------------------------------------- |
| 401  | `INVALID_CREDENTIALS`         | Wrong password or non-existent email (same code to prevent enumeration) |
| 401  | `ACCOUNT_LOCKED`              | `lockUntil > now()` — do not check password                             |
| 403  | `MEMBERSHIP_MISSING`          | No `active` membership in requested org                                 |
| 403  | `EMAIL_VERIFICATION_REQUIRED` | `AuthUser.emailVerified = false`                                        |
| 400  | `INVALID_REQUEST`             | Missing or malformed fields                                             |

## Prisma Models Used

| Model              | Action        | Key fields                                                                                                                                 |
| ------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `AuthUser`         | Read          | `id`, `email`, `passwordHash`, `failedLoginCount`, `lockUntil`, `emailVerified`                                                            |
| `AuthMembership`   | Read          | `userId`, `organizationId`, `status` = `active` required                                                                                   |
| `AuthSession`      | Create        | `id` (uuid), `userId`, `organizationId`, `tokenHash` (bcrypt), `tokenFingerprint` (first 8 bytes hex), `expiresAt`, `mfaVerifiedAt` = null |
| `AuthAuditEvent`   | Create        | `eventType`, `actorId`, `organizationId`, `decision`, `reasonCode`, `correlationId`, `sessionId`, `payload` (no password)                  |
| `AuthMfaRateLimit` | Read + Update | `userId`, `failedCount`, `lockedUntil`                                                                                                     |
| `AuthUserMfa`      | Read          | `userId` — presence indicates MFA enrolled                                                                                                 |

## Business Rules

1. Normalize email to lowercase before DB lookup.
2. If `AuthUser.lockUntil > now()` → return `ACCOUNT_LOCKED` without touching `passwordHash`.
3. Compare password with `bcrypt.compare(password, user.passwordHash)`. On mismatch → increment `failedLoginCount`; if `failedLoginCount >= 5` set `lockUntil = now() + 15min`; return `INVALID_CREDENTIALS`.
4. On success → reset `failedLoginCount = 0`, `lockUntil = null`.
5. Check `AuthUser.emailVerified = true`. If false → return `EMAIL_VERIFICATION_REQUIRED`.
6. Check membership: `AuthMembership` where `userId + organizationId + status = active` must exist. If not → return `MEMBERSHIP_MISSING`.
7. Generate session token: `crypto.randomBytes(32)`. Store `tokenFingerprint = hex(token.slice(0, 8))`, `tokenHash = bcrypt(token, 10)`.
8. Set `expiresAt = now() + 8h`. If user has `AuthUserMfa` row → set `expiresAt = now() + 1h` (MFA challenge window).
9. `mfa_required = true` if `AuthUserMfa` exists AND `session.mfaVerifiedAt = null`.
10. Never store or return plaintext password, raw token, or MFA secret in any payload, log, or audit record.

## Commands / Events

| Name                           | Type             | Emitter         | Safe payload                                                             |
| ------------------------------ | ---------------- | --------------- | ------------------------------------------------------------------------ |
| `SignInCommand`                | App command      | Controller      | `{ email, password, organizationId?, correlationId? }`                   |
| `event.auth.sign-in-succeeded` | `AuthAuditEvent` | `SignInHandler` | `{ actorId, organizationId, sessionId, correlationId, decision: allow }` |
| `event.auth.sign-in-failed`    | `AuthAuditEvent` | `SignInHandler` | `{ reasonCode, correlationId, decision: deny }` — no email or password   |

## PBAC

This endpoint is public. No session guard applied. PBAC kicks in after session is issued when accessing workspace routes.

## Test Cases

| ID  | Scenario                                             | Expected                                             |
| --- | ---------------------------------------------------- | ---------------------------------------------------- |
| T01 | Valid credentials + active membership + no MFA       | 200, `mfa_required: false`, session token present    |
| T02 | Valid credentials + active membership + MFA enrolled | 200, `mfa_required: true`, `expires_at` ~1h          |
| T03 | Wrong password                                       | 401 `INVALID_CREDENTIALS`                            |
| T04 | Non-existent email                                   | 401 `INVALID_CREDENTIALS`                            |
| T05 | 5th consecutive failure                              | 401 `INVALID_CREDENTIALS`; lockUntil set             |
| T06 | 6th attempt while locked                             | 401 `ACCOUNT_LOCKED`; password not compared          |
| T07 | Email not verified                                   | 403 `EMAIL_VERIFICATION_REQUIRED`                    |
| T08 | No active membership                                 | 403 `MEMBERSHIP_MISSING`                             |
| T09 | Missing `email` field                                | 400 `INVALID_REQUEST`                                |
| T10 | Audit event on success has no password               | `AuthAuditEvent.payload` does not contain `password` |
| T11 | Audit event on failure has no password               | `AuthAuditEvent.payload` does not contain `password` |
| T12 | Valid credentials + invited (not active) membership  | 403 `MEMBERSHIP_MISSING`                             |
| T13 | Valid credentials + revoked membership               | 403 `MEMBERSHIP_MISSING`                             |

## Definition of Done

- Endpoint returns correct status/body for all T01–T13.
- Password is never in logs, responses, or `AuthAuditEvent.payload`.
- `failedLoginCount` increments atomically; lockUntil is set correctly after 5 failures.
- Token fingerprint is unique-indexed; hash uses bcrypt with cost 10.
- Audit events exist for both success and failure paths with correlation ID.
