---
task_id: MW-auth-004
module: auth-workspace
runtime: nestjs-api
priority: P0
status: DONE
epic_story: 1.2
depends_on:
  - auth-workspace/03-mfa-enroll-endpoint.md
---

# MFA Verify OTP Endpoint

## Outcome

Verify a TOTP code against the enrolled secret, mark the session as MFA-verified (`mfaVerifiedAt`), enforce replay prevention, and rate-limit failed OTP attempts.

## Module Files

| File                                                                                                | Action | Notes                              |
| --------------------------------------------------------------------------------------------------- | ------ | ---------------------------------- |
| `apps/api/src/modules/auth-workspace/presentation/http/auth-workspace.controller.ts`                | Verify | `POST /auth/mfa/verify-otp` exists |
| `apps/api/src/modules/auth-workspace/application/commands/verify-mfa-otp/verify-mfa-otp.command.ts` | Verify | Command shape                      |
| `apps/api/src/modules/auth-workspace/application/commands/verify-mfa-otp/verify-mfa-otp.handler.ts` | Verify | All business rules                 |
| `apps/api/src/modules/auth-workspace/domain/entities/mfa-rate-limit.entity.ts`                      | Verify | MFA rate limit logic               |

## API Contract

**Endpoint:** `POST /auth/mfa/verify-otp`
**Auth required:** Yes — session token (short-lived; issued before MFA challenge complete)

**Request body:**

| Field           | Type   | Required | Notes                                |
| --------------- | ------ | -------- | ------------------------------------ |
| `session_token` | string | Yes      | Session where `mfaVerifiedAt = null` |
| `otp`           | string | Yes      | 6-digit TOTP code                    |

**Success response (200):**

| Field           | Type    | Notes                    |
| --------------- | ------- | ------------------------ |
| `verified`      | boolean | Always `true` on success |
| `correlationId` | string  |                          |

**Error responses:**

| HTTP | `error_code`       | Meaning                                      |
| ---- | ------------------ | -------------------------------------------- |
| 401  | `SESSION_INVALID`  | Session expired, revoked, or not found       |
| 400  | `MFA_NOT_ENROLLED` | No `AuthUserMfa` row for this user           |
| 400  | `OTP_INVALID`      | Wrong code or outside time window            |
| 400  | `OTP_REPLAYED`     | OTP already used (found in `AuthMfaOtpUsed`) |
| 429  | `MFA_RATE_LIMITED` | Too many failed OTP attempts                 |

## Prisma Models Used

| Model              | Action        | Key fields                                          |
| ------------------ | ------------- | --------------------------------------------------- |
| `AuthSession`      | Read + Update | Validate, then set `mfaVerifiedAt = now()`          |
| `AuthUserMfa`      | Read          | `userId`, `encryptedSecret` (decrypt to verify)     |
| `AuthMfaOtpUsed`   | Read + Create | `userId`, `otpCode`, `usedAt` — replay prevention   |
| `AuthMfaRateLimit` | Read + Update | `userId`, `failedCount`, `lockedUntil`              |
| `AuthAuditEvent`   | Create        | `eventType: AUTH_MFA_VERIFIED` or `AUTH_MFA_FAILED` |

## Business Rules

1. Validate session token (same as sign-in). If `mfaVerifiedAt` is already set → return 200 idempotently (already verified).
2. Check `AuthUserMfa` exists for `userId`. If not → `MFA_NOT_ENROLLED`.
3. Check `AuthMfaRateLimit`: if `failedCount >= 5` and `lockedUntil > now()` → `MFA_RATE_LIMITED`.
4. Check `AuthMfaOtpUsed` for `(userId, otpCode)`. If exists → `OTP_REPLAYED`.
5. Decrypt `encryptedSecret` from `AuthUserMfa` using AES-256-GCM.
6. Verify OTP with TOTP algorithm: `totp(secret, window: ±1 step, digits: 6, period: 30s)`. If invalid → `OTP_INVALID`, increment `failedCount`.
7. On success: insert `AuthMfaOtpUsed(userId, otpCode, usedAt)`, set `session.mfaVerifiedAt = now()`, reset `failedCount = 0`.
8. After 5 OTP failures: set `lockedUntil = now() + 15min`.
9. OTP code never logged or stored in plaintext outside `AuthMfaOtpUsed` (where it's needed for replay prevention only).
10. Decrypt operation must not expose secret to logs.

## Commands / Events

| Name                      | Type             | Safe payload                                                  |
| ------------------------- | ---------------- | ------------------------------------------------------------- |
| `VerifyMfaOtpCommand`     | App command      | `{ sessionToken, otp, correlationId? }`                       |
| `event.auth.mfa-verified` | `AuthAuditEvent` | `{ actorId, correlationId, decision: allow }`                 |
| `event.auth.mfa-failed`   | `AuthAuditEvent` | `{ reasonCode, correlationId, decision: deny }` — no OTP code |

## PBAC

Requires a valid (but potentially MFA-pending) session. No further PBAC check at this layer. After verification, workspace routes require PBAC evaluation.

## Test Cases

| ID  | Scenario                                      | Expected                                                               |
| --- | --------------------------------------------- | ---------------------------------------------------------------------- |
| T01 | Valid session + correct OTP, first use        | 200, `verified: true`, `mfaVerifiedAt` set                             |
| T02 | Valid session + correct OTP, replay same code | 400 `OTP_REPLAYED`                                                     |
| T03 | Valid session + wrong OTP                     | 400 `OTP_INVALID`, failedCount +1                                      |
| T04 | 5 consecutive wrong OTPs                      | 429 `MFA_RATE_LIMITED` after 5th attempt                               |
| T05 | Attempt while rate-limited                    | 429 `MFA_RATE_LIMITED` without checking OTP                            |
| T06 | Session already MFA-verified                  | 200 idempotent                                                         |
| T07 | MFA not enrolled                              | 400 `MFA_NOT_ENROLLED`                                                 |
| T08 | Expired session                               | 401 `SESSION_INVALID`                                                  |
| T09 | OTP not in audit payload                      | `AuthAuditEvent.payload` has no `otp` field                            |
| T10 | Decryption error (corrupted secret)           | Internal error → return safe 500-class response, audit records failure |

## Definition of Done

- OTP verification uses TOTP with ±1 step tolerance.
- Replay prevention enforced via `AuthMfaOtpUsed` unique constraint.
- `mfaVerifiedAt` set atomically with `AuthMfaOtpUsed` insert.
- Rate limiting tracked separately from sign-in rate limit.
- No OTP code in logs or audit payload.
