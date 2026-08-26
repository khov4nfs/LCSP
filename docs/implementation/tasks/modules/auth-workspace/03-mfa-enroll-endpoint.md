---
task_id: MW-auth-003
module: auth-workspace
runtime: nestjs-api
priority: P0
status: DONE
epic_story: 1.2
depends_on:
  - auth-workspace/01-sign-in-endpoint.md
---

# MFA Enroll Endpoint

## Outcome

Allow an authenticated user to enroll TOTP MFA: generate a secret, return provisioning URI for authenticator app, and persist the encrypted secret. Do not activate MFA until OTP is verified (Story 1.2 verify step).

## Module Files

| File                                                                                        | Action | Notes                                           |
| ------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------- |
| `apps/api/src/modules/auth-workspace/presentation/http/auth-workspace.controller.ts`        | Verify | `POST /auth/mfa/enroll` exists                  |
| `apps/api/src/modules/auth-workspace/application/commands/enroll-mfa/enroll-mfa.command.ts` | Verify | Command shape                                   |
| `apps/api/src/modules/auth-workspace/application/commands/enroll-mfa/enroll-mfa.handler.ts` | Verify | Secret generation, encryption, provisioning URI |
| `apps/api/src/modules/auth-workspace/domain/entities/mfa-enrollment.entity.ts`              | Verify | MFA enrollment state                            |
| `apps/api/src/modules/auth-workspace/infrastructure/security/security.utils.ts`             | Verify | TOTP secret generation, AES encryption          |

## API Contract

**Endpoint:** `POST /auth/mfa/enroll`
**Auth required:** Yes — valid session token (`session_token` in request body or Authorization header)

**Request body:**

| Field           | Type   | Required | Notes                                   |
| --------------- | ------ | -------- | --------------------------------------- |
| `session_token` | string | Yes      | Must be valid, non-expired, non-revoked |

**Success response (200):**

| Field           | Type   | Notes                                                     |
| --------------- | ------ | --------------------------------------------------------- |
| `totp_uri`      | string | `otpauth://totp/LCSP:<email>?secret=<base32>&issuer=LCSP` |
| `correlationId` | string |                                                           |

**Error responses:**

| HTTP | `error_code`           | Meaning                                |
| ---- | ---------------------- | -------------------------------------- |
| 401  | `SESSION_INVALID`      | Session expired, revoked, or not found |
| 409  | `MFA_ALREADY_ENROLLED` | `AuthUserMfa` row exists for this user |
| 400  | `INVALID_REQUEST`      | Missing session_token                  |

## Prisma Models Used

| Model            | Action | Key fields                                                 |
| ---------------- | ------ | ---------------------------------------------------------- |
| `AuthSession`    | Read   | Validate `tokenHash`, `expiresAt`, `revokedAt`             |
| `AuthUserMfa`    | Create | `userId`, `encryptedSecret`, `enrolledAt`                  |
| `AuthAuditEvent` | Create | `eventType: AUTH_MFA_ENROLL_STARTED`, no secret in payload |

## Business Rules

1. Validate session token: look up by `tokenFingerprint`, compare `bcrypt(token) == tokenHash`, check `expiresAt > now()`, `revokedAt = null`.
2. If `AuthUserMfa` row exists for `userId` → return `MFA_ALREADY_ENROLLED`.
3. Generate 20-byte TOTP secret with `crypto.randomBytes(20)`. Encode as base32 for TOTP URI.
4. Encrypt secret with AES-256-GCM using `ENCRYPTION_KEY` env var. Store ciphertext + IV + auth tag.
5. Create `AuthUserMfa` row: `userId`, `encryptedSecret = JSON({iv, tag, ciphertext})`, `enrolledAt = now()`.
6. Return `totp_uri` only. Secret is never returned in plaintext after this call.
7. MFA is NOT active yet — user must verify with valid OTP (MW-auth-004) before `session.mfaVerifiedAt` is set.
8. Audit event: type `AUTH_MFA_ENROLL_STARTED`, actor, correlation ID. No secret in payload.

## Commands / Events

| Name                            | Type             | Safe payload                                  |
| ------------------------------- | ---------------- | --------------------------------------------- |
| `EnrollMfaCommand`              | App command      | `{ sessionToken, correlationId? }`            |
| `event.auth.mfa-enroll-started` | `AuthAuditEvent` | `{ actorId, correlationId, decision: allow }` |

## RBAC

Requires valid session. No additional RBAC check beyond active session. Any authenticated user can enroll their own MFA.

## Test Cases

| ID  | Scenario                                                                 | Expected                                        |
| --- | ------------------------------------------------------------------------ | ----------------------------------------------- |
| T01 | Valid session, no existing MFA                                           | 200, `totp_uri` contains `otpauth://totp/`      |
| T02 | Expired session                                                          | 401 `SESSION_INVALID`                           |
| T03 | Revoked session                                                          | 401 `SESSION_INVALID`                           |
| T04 | MFA already enrolled                                                     | 409 `MFA_ALREADY_ENROLLED`                      |
| T05 | `AuthUserMfa` created with encrypted secret                              | DB row `encryptedSecret` is JSON, not plaintext |
| T06 | `totp_uri` does not contain base32 secret as plaintext after second call | Secret not retrievable from any API             |
| T07 | Audit event has no TOTP secret                                           | `AuthAuditEvent.payload` clean                  |

## Definition of Done

- Endpoint returns `totp_uri` for valid sessions.
- `encryptedSecret` in DB is AES-256-GCM encrypted; secret never returned in plain after enroll.
- MFA is NOT active until OTP is verified (no `mfaVerifiedAt` on session from this endpoint).
- `MFA_ALREADY_ENROLLED` prevents duplicate enrollment.
- Audit event has no secret material.
