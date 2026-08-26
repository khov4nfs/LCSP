---
task_id: MW-auth-005
module: auth-workspace
runtime: nestjs-api
priority: P0
status: DONE
epic_story: 1.2
depends_on:
  - auth-workspace/01-sign-in-endpoint.md
---

# Session Revoke Endpoint

## Outcome

Allow a user to explicitly revoke their current session, preventing further access on protected routes, and audit the revocation.

## Module Files

| File                                                                                                | Action | Notes                              |
| --------------------------------------------------------------------------------------------------- | ------ | ---------------------------------- |
| `apps/api/src/modules/auth-workspace/presentation/http/auth-workspace.controller.ts`                | Verify | `POST /auth/revoke-session` exists |
| `apps/api/src/modules/auth-workspace/application/commands/revoke-session/revoke-session.command.ts` | Verify | Command shape                      |
| `apps/api/src/modules/auth-workspace/application/commands/revoke-session/revoke-session.handler.ts` | Verify | Business rules                     |

## API Contract

**Endpoint:** `POST /auth/revoke-session`
**Auth required:** Partial — requires a valid `session_token` in body (the one being revoked)

**Request body:**

| Field           | Type   | Required | Notes           |
| --------------- | ------ | -------- | --------------- |
| `session_token` | string | Yes      | Token to revoke |

**Success response (200):**

| Field           | Type    | Notes         |
| --------------- | ------- | ------------- |
| `revoked`       | boolean | Always `true` |
| `correlationId` | string  |               |

**Error responses:**

| HTTP | `error_code`              | Meaning                     |
| ---- | ------------------------- | --------------------------- |
| 400  | `INVALID_REQUEST`         | Missing token               |
| 404  | `SESSION_NOT_FOUND`       | Token fingerprint not found |
| 410  | `SESSION_ALREADY_REVOKED` | `revokedAt` already set     |

## Prisma Models Used

| Model            | Action        | Key fields                                                                 |
| ---------------- | ------------- | -------------------------------------------------------------------------- |
| `AuthSession`    | Read + Update | Lookup by `tokenFingerprint`, verify `tokenHash`, set `revokedAt = now()`  |
| `AuthAuditEvent` | Create        | `eventType: AUTH_SESSION_REVOKED`, `sessionId`, `actorId`, `correlationId` |

## Business Rules

1. Extract `tokenFingerprint = hex(token.slice(0, 8))`.
2. Load `AuthSession` by `tokenFingerprint`. If not found → `SESSION_NOT_FOUND`.
3. Verify `bcrypt.compare(token, session.tokenHash)`. If mismatch → `SESSION_NOT_FOUND` (same code to prevent enumeration).
4. If `session.revokedAt` is not null → `SESSION_ALREADY_REVOKED`.
5. Set `revokedAt = now()` and save.
6. Emit audit event with `actorId = session.userId`, `sessionId`, `organizationId`, `correlationId`.
7. Session token must not appear in audit payload or logs.

## Commands / Events

| Name                         | Type             | Safe payload                                                             |
| ---------------------------- | ---------------- | ------------------------------------------------------------------------ |
| `RevokeSessionCommand`       | App command      | `{ sessionToken, correlationId? }`                                       |
| `event.auth.session-revoked` | `AuthAuditEvent` | `{ actorId, sessionId, organizationId, correlationId, decision: allow }` |

## RBAC

No RBAC check beyond proving ownership of the session token. A user can only revoke their own session.

## Test Cases

| ID  | Scenario                                       | Expected                                        |
| --- | ---------------------------------------------- | ----------------------------------------------- |
| T01 | Valid token, active session                    | 200 `revoked: true`, `revokedAt` set            |
| T02 | Already revoked                                | 410 `SESSION_ALREADY_REVOKED`                   |
| T03 | Token not found                                | 404 `SESSION_NOT_FOUND`                         |
| T04 | Revoked session cannot access workspace routes | 401 on subsequent workspace calls               |
| T05 | Audit event emitted with no token in payload   | `AuthAuditEvent.payload` has no `session_token` |
| T06 | Token fingerprint mismatch (wrong token)       | 404 `SESSION_NOT_FOUND`                         |

## Definition of Done

- Revocation sets `revokedAt` atomically.
- All subsequent protected route calls with the same token return 401.
- Token not in any log or audit payload.
- Audit event emitted with correlation ID.
