---
task_id: MW-auth-017
module: auth-workspace
runtime: nestjs-api
priority: P0
status: DONE
epic_story: 1.1
depends_on:
  - auth-workspace/01-sign-in-endpoint.md
  - auth-workspace/06-get-workspace-endpoint.md
  - auth-workspace/13-pbac-guard.md
---

# Self Sign-Up Account Endpoint

## Outcome

Allow a new Manager user to create an LCSP account without an invitation or
acceptance token. Successful self-signup creates a new organization workspace,
Manager PBAC policy, active Manager membership, scoped session, and safe audit
event in one transaction.

## Module Files

| File                                                                                           | Action | Notes                                               |
| ---------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------- |
| `apps/api/src/modules/auth-workspace/presentation/http/auth-workspace.controller.ts`           | Modify | Adds public `POST /auth/sign-up`                    |
| `apps/api/src/modules/auth-workspace/application/commands/sign-up/*`                           | Create | Self-signup command and transaction handler         |
| `apps/api/src/modules/auth-workspace/application/contracts/auth-workspace/sign-up.contract.ts` | Create | Public request/response DTO                         |
| `packages/contracts/src/auth/codes.ts`                                                         | Modify | Adds `SIGN_UP_ERROR_CODES`                          |
| `packages/contracts/src/auth/audit-event-types.ts`                                             | Modify | Adds `AUTH_SIGN_UP_SUCCESS` / `AUTH_SIGN_UP_FAILED` |

## API Contract

**Endpoint:** `POST /auth/sign-up`
**Auth required:** No (public)

**Request body:**

| Field               | Type   | Required | Rules                         |
| ------------------- | ------ | -------- | ----------------------------- |
| `display_name`      | string | Yes      | Non-empty, max 100 characters |
| `organization_name` | string | Yes      | Non-empty, max 120 characters |
| `email`             | string | Yes      | Valid email; stored lowercase |
| `password`          | string | Yes      | Minimum 12 characters         |

**Success response (201):**

| Field             | Type              | Notes                                      |
| ----------------- | ----------------- | ------------------------------------------ |
| `user_id`         | string            | New auth user ID                           |
| `session_token`   | string            | Opaque session token; BFF stores in cookie |
| `expires_at`      | string (ISO 8601) | Session expiry                             |
| `organization_id` | string            | New workspace organization                 |
| `allowed_actions` | string[]          | Manager policy actions granted             |
| `correlationId`   | string            | Echo of request header or server-generated |

**Error responses:**

| HTTP | `code`                 | Meaning                         |
| ---- | ---------------------- | ------------------------------- |
| 400  | `INVALID_REQUEST`      | Missing or malformed fields     |
| 409  | `EMAIL_ALREADY_EXISTS` | Email already belongs to a user |
| 422  | `PASSWORD_TOO_SHORT`   | Password is under 12 characters |

## Business Rules

1. Self-signup does not consume or require `AuthInvitation`.
2. The new user is immediately email-verified for this MVP flow.
3. The handler creates organization, policy, user, membership, session, and
   audit row inside one Prisma transaction.
4. The first membership is active and carries `{ role: SUBJECT_ROLES.manager }`.
5. The Manager policy must include `workspace:read` so the new session can enter
   `/workspace` immediately after signup.
6. Duplicate email is checked before create and also mapped from Prisma `P2002`
   to `EMAIL_ALREADY_EXISTS`.
7. Password and session token must not be stored in plaintext or emitted in
   audit payloads.

## Test Cases

| ID  | Scenario                | Expected                                                      |
| --- | ----------------------- | ------------------------------------------------------------- |
| T01 | Valid signup request    | 201; user/org/policy/membership/session created; workspace OK |
| T02 | Duplicate email         | 409 `EMAIL_ALREADY_EXISTS`                                    |
| T03 | Password under 12 chars | 422 `PASSWORD_TOO_SHORT`                                      |
| T04 | Missing required field  | 400 `INVALID_REQUEST`                                         |
| T05 | Malformed email         | 400 `INVALID_REQUEST`                                         |

## Verification

- `rtk pnpm --filter @lcsp/api test:e2e -- --runInBand --runTestsByPath test/sign-up.e2e-spec.ts`
- `rtk pnpm run typecheck`
- `rtk pnpm run test:web`
- `rtk pnpm --filter @lcsp/api build`
- `rtk pnpm --filter @lcsp/web build`
