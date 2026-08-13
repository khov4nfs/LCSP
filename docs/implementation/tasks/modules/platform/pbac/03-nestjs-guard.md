---
task_id: MW-pbac-003
module: platform/pbac
runtime: nestjs-api
priority: P0
status: READY_FOR_DEV
epic_story: 1.6
depends_on:
  - platform/pbac/02-evaluator-service.md
  - platform/audit-writer/02-audit-writer-service.md
---

# PBAC NestJS Guard

## Outcome

Implement the `PbacGuard` NestJS `CanActivate` guard that orchestrates session resolution, policy loading, PBAC evaluation, decision logging, and HTTP error mapping. Works with `@RequireAction()` and `@RequireSession()` decorators. Default deny on any failure.

## Module Files

| File                                                                 | Action | Notes                                               |
| -------------------------------------------------------------------- | ------ | --------------------------------------------------- |
| `apps/api/src/platform/pbac/pbac.guard.ts`                           | Create | NestJS `CanActivate` implementation                 |
| `apps/api/src/platform/pbac/decorators/require-action.decorator.ts`  | Create | `@RequireAction('action:name')`                     |
| `apps/api/src/platform/pbac/decorators/require-session.decorator.ts` | Create | `@RequireSession()` — session-only, no action check |
| `apps/api/src/platform/pbac/pbac-context.loader.ts`                  | Create | Loads session + membership + policy from DB         |
| `apps/api/src/platform/pbac/pbac.module.ts`                          | Modify | Register guard + decorators                         |

## Guard Flow

```
Request arrives
  → Extract session token from Authorization header (Bearer)
  → Load AuthSession (by fingerprint+hash, expiry, revokedAt)
  → If session invalid/expired/revoked → 401 SESSION_INVALID
  → Load AuthUserMfa (check MFA enrollment)
  → If enrolled AND mfaVerifiedAt = null → 401 MFA_REQUIRED
  → Load AuthMembership (userId, orgId, status = active)
  → If not found → 403 MEMBERSHIP_MISSING
  → Load AuthPolicy (policyId, policyVersion from membership)
  → If not found → 403 PBAC_DENIED (POLICY_NOT_FOUND)
  → Call PbacEvaluatorService.evaluate(ctx)
  → If deny → write AuthDecisionLog + return 403 PBAC_DENIED
  → If allow → write AuthDecisionLog (allow) + set request context + next()
```

## Decorator Usage

```typescript
// Session check only (no action required)
@UseGuards(PbacGuard)
@RequireSession()
async getWorkspace() { ... }

// Session + PBAC action check
@UseGuards(PbacGuard)
@RequireAction('invite:developer')
async inviteDeveloper() { ... }
```

## Request Context Injection

After allow, the guard sets the following on the request object for downstream handlers:

```typescript
request.pbacContext = {
  userId: string,
  sessionId: string,
  organizationId: string,
  subjectRole: SubjectRole,
  grantedActions: string[],
  policyId: string,
  policyVersion: number,
}
```

## Error Responses

| HTTP | `error_code`         | Condition                                                       |
| ---- | -------------------- | --------------------------------------------------------------- |
| 401  | `SESSION_INVALID`    | Token missing, invalid, expired, or revoked                     |
| 401  | `MFA_REQUIRED`       | MFA enrolled but not verified on session                        |
| 403  | `MEMBERSHIP_MISSING` | No active membership                                            |
| 403  | `PBAC_DENIED`        | Policy not found, action not granted, role mismatch, state gate |

## Business Rules

1. Session token extracted from `Authorization: Bearer <token>`. No query-param tokens.
2. All DB load failures → deny (never allow on error).
3. `AuthDecisionLog` written for every request — both allow and deny.
4. No policy internals in 403 response body (only `error_code` and `correlationId`).
5. `@RequireSession()` skips action check — validates session + membership only.
6. `@RequireAction()` requires valid session + active membership + evaluator allow.
7. Guard is registered globally via `APP_GUARD` provider or applied per-controller.

## Prisma Models Used

| Model             | Action | Key fields                                                                 |
| ----------------- | ------ | -------------------------------------------------------------------------- |
| `AuthSession`     | Read   | `tokenFingerprint`, `tokenHash`, `expiresAt`, `revokedAt`, `mfaVerifiedAt` |
| `AuthUserMfa`     | Read   | Existence check for MFA enrollment                                         |
| `AuthMembership`  | Read   | `(userId, orgId, status = active)`                                         |
| `AuthPolicy`      | Read   | `(policyId, policyVersion)`                                                |
| `AuthDecisionLog` | Create | Decision, reason, action, session, user, org, policy                       |

## Test Cases

| ID  | Scenario                                             | Expected                           |
| --- | ---------------------------------------------------- | ---------------------------------- |
| T01 | Valid session + active membership + action in policy | 200 from endpoint, allow logged    |
| T02 | Missing Authorization header                         | 401 `SESSION_INVALID`              |
| T03 | Expired session token                                | 401 `SESSION_INVALID`              |
| T04 | Revoked session                                      | 401 `SESSION_INVALID`              |
| T05 | MFA enrolled + unverified                            | 401 `MFA_REQUIRED`                 |
| T06 | No active membership                                 | 403 `MEMBERSHIP_MISSING`           |
| T07 | Action not in policy                                 | 403 `PBAC_DENIED`                  |
| T08 | Policy not found in DB                               | 403 `PBAC_DENIED`                  |
| T09 | DB error during load                                 | 403 `PBAC_DENIED` (deny on error)  |
| T10 | 403 response has no policyId or actions              | Response body clean                |
| T11 | `request.pbacContext` set after allow                | Downstream handler has context     |
| T12 | `@RequireSession()` passes with no action            | Valid session + membership → allow |
| T13 | `AuthDecisionLog` written for every request          | DB row exists for T01, T04, T07    |

## Definition of Done

- Guard never allows on exception — all error paths return 401 or 403.
- `request.pbacContext` populated for allowed requests.
- `AuthDecisionLog` written for every allow and deny decision.
- 403 response body contains only `error_code` and `correlationId`.
- `@RequireAction()` and `@RequireSession()` decorators functional.
