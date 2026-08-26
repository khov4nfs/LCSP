---
task_id: MW-auth-007
module: auth-workspace
runtime: nestjs-api
priority: P0
status: DONE
epic_story: 1.2
depends_on:
  - auth-workspace/01-sign-in-endpoint.md
  - platform/audit-writer/02-audit-writer-service.md
---

# Update Profile Endpoint

## Outcome

Allow an authenticated user to update their display name and/or recovery email. Audit the update. Never store or return plaintext security-sensitive values.

## Module Files

| File                                                                                                | Action | Notes                        |
| --------------------------------------------------------------------------------------------------- | ------ | ---------------------------- |
| `apps/api/src/modules/auth-workspace/presentation/http/auth-workspace.controller.ts`                | Verify | `PATCH /auth/profile` exists |
| `apps/api/src/modules/auth-workspace/application/commands/update-profile/update-profile.command.ts` | Verify | `UpdateProfilePayload` shape |
| `apps/api/src/modules/auth-workspace/application/commands/update-profile/update-profile.handler.ts` | Verify | Business rules               |

## API Contract

**Endpoint:** `PATCH /auth/profile`
**Auth required:** Yes — valid session token

**Request body:**

| Field            | Type   | Required | Notes                                |
| ---------------- | ------ | -------- | ------------------------------------ |
| `session_token`  | string | Yes      | Must be valid and non-revoked        |
| `display_name`   | string | No       | Optional; 1–100 chars                |
| `recovery_email` | string | No       | Optional; must be valid email format |

**Success response (200):**

| Field           | Type    | Notes         |
| --------------- | ------- | ------------- |
| `updated`       | boolean | Always `true` |
| `correlationId` | string  |               |

**Error responses:**

| HTTP | `error_code`      | Meaning                                   |
| ---- | ----------------- | ----------------------------------------- |
| 401  | `SESSION_INVALID` |                                           |
| 400  | `INVALID_REQUEST` | Nothing to update or invalid field values |
| 422  | `INVALID_EMAIL`   | `recovery_email` format invalid           |

## Prisma Models Used

| Model            | Action | Key fields                                                        |
| ---------------- | ------ | ----------------------------------------------------------------- |
| `AuthSession`    | Read   | Validate token                                                    |
| `AuthUser`       | Update | `displayName`, `recoveryEmail`                                    |
| `AuthAuditEvent` | Create | `eventType: AUTH_PROFILE_UPDATED`, no sensitive values in payload |

## Business Rules

1. Validate session (fingerprint + hash + expiry + revoked).
2. Validate at least one of `display_name` or `recovery_email` is provided and non-empty.
3. If `recovery_email` provided, validate email format.
4. Update `AuthUser` fields atomically. `passwordHash`, `emailVerified`, `failedLoginCount` are never touched by this endpoint.
5. Emit audit event: `AUTH_PROFILE_UPDATED` with actor, correlation ID. No `recovery_email` value in payload (only flag that it was changed).
6. Do not return the stored values — return only `updated: true`.

## Commands / Events

| Name                         | Type             | Safe payload                                                                   |
| ---------------------------- | ---------------- | ------------------------------------------------------------------------------ |
| `UpdateProfileCommand`       | App command      | `{ sessionToken, displayName?, recoveryEmail?, correlationId? }`               |
| `event.auth.profile-updated` | `AuthAuditEvent` | `{ actorId, fieldsUpdated: ['displayName'?,'recoveryEmail'?], correlationId }` |

## RBAC

Requires valid session. User updates their own profile only. No organization-scope check needed.

## Test Cases

| ID  | Scenario                                    | Expected                                    |
| --- | ------------------------------------------- | ------------------------------------------- |
| T01 | Valid session + display_name                | 200, `AuthUser.displayName` updated         |
| T02 | Valid session + recovery_email              | 200, `AuthUser.recoveryEmail` updated       |
| T03 | Both fields provided                        | 200, both updated                           |
| T04 | No fields provided                          | 400 `INVALID_REQUEST`                       |
| T05 | Invalid email format                        | 422 `INVALID_EMAIL`                         |
| T06 | Audit payload has no `recovery_email` value | Only flags updated fields, not values       |
| T07 | Expired session                             | 401 `SESSION_INVALID`                       |
| T08 | `passwordHash` unchanged                    | DB still has same passwordHash after update |

## Definition of Done

- Profile fields updated atomically.
- `passwordHash`, `emailVerified`, `failedLoginCount` untouched.
- Audit event has no sensitive values (no email address value).
- Valid session required; expired/revoked returns 401.
