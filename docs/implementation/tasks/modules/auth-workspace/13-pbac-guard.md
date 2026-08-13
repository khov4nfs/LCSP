---
task_id: MW-auth-013
module: auth-workspace
runtime: nestjs-api
priority: P0
status: READY_FOR_DEV
epic_story: 1.6
depends_on:
  - auth-workspace/01-sign-in-endpoint.md
  - auth-workspace/06-get-workspace-endpoint.md
  - platform/pbac/02-evaluator-service.md
  - platform/pbac/03-nestjs-guard.md
---

# PBAC Guard — NestJS Integration

## Outcome

Enforce Policy-Based Access Control on all protected endpoints via a reusable NestJS guard. Default deny: any missing attribute, missing policy, evaluator failure, or non-active membership results in 403. Never expose policy internals in error responses.

## Module Files

| File                                                                                               | Action | Notes                                                            |
| -------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------- |
| `apps/api/src/modules/auth-workspace/presentation/guards/pbac.guard.ts`                            | Create | NestJS `CanActivate` guard                                       |
| `apps/api/src/modules/auth-workspace/presentation/decorators/require-action.decorator.ts`          | Create | `@RequireAction('action:name')` endpoint decorator               |
| `apps/api/src/modules/auth-workspace/presentation/decorators/require-session.decorator.ts`         | Create | `@RequireSession()` endpoint decorator                           |
| `apps/api/src/modules/auth-workspace/application/services/auth-workspace/pbac-session.resolver.ts` | Create | Resolves `AuthSession` → `AuthMembership` → `AuthPolicy` context |
| `apps/api/src/modules/auth-workspace/auth-workspace.module.ts`                                     | Modify | Register guard and decorators globally or per-module             |

## Guard Behaviour

**Invocation:** `@UseGuards(PbacGuard)` + `@RequireAction('action:name')` on controller method.

**Evaluation steps (in order):**

1. Extract and validate session token (fingerprint + hash + expiry + `revokedAt = null`).
2. If MFA enrolled and `session.mfaVerifiedAt = null` → deny with `MFA_REQUIRED`.
3. Load `AuthMembership` for `(userId, session.organizationId, status = active)`. Missing → deny `MEMBERSHIP_MISSING`.
4. Load `AuthPolicy` for `(policyId, policyVersion)` from membership. Missing or version mismatch → deny `POLICY_NOT_FOUND`.
5. Check `policy.stateGate`. If `stateGate = membership_active` and membership not active → deny.
6. Evaluate `action ∈ policy.actions`. PBAC is an allowlist — only explicitly granted actions are allowed.
7. Evaluate subject attributes: `policy.subjectRole == membership.subjectAttributes.role`.
8. If all checks pass → allow. Log `AuthDecisionLog` with decision `allow`.
9. On any deny → log `AuthDecisionLog` with decision `deny` + reason code. Return 403 `PBAC_DENIED` (no policy internals in response).

**Default deny conditions:**

- Session invalid/expired/revoked
- MFA enrolled but unverified
- Membership not found or not active
- Policy not found
- Evaluator throws (treated as deny)
- `action` not in `policy.actions`
- Subject role mismatch

## Module Files (Infrastructure)

| File                                                                                                   | Action | Notes                                                   |
| ------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------- |
| `apps/api/src/modules/auth-workspace/infrastructure/persistence/prisma-auth-workspace.repositories.ts` | Modify | Add session + membership + policy loaders used by guard |

## Prisma Models Used

| Model             | Action | Key fields                                                                                             |
| ----------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| `AuthSession`     | Read   | `tokenFingerprint`, `tokenHash`, `userId`, `organizationId`, `expiresAt`, `revokedAt`, `mfaVerifiedAt` |
| `AuthMembership`  | Read   | `userId`, `organizationId`, `status`, `subjectAttributes`, `policyId`, `policyVersion`                 |
| `AuthPolicy`      | Read   | `id`, `version`, `actions`, `subjectRole`, `stateGate`                                                 |
| `AuthDecisionLog` | Create | `decision`, `reasonCode`, `action`, `sessionId`, `userId`, `orgId`, `policyId`, `policyVersion`        |

## Business Rules

1. Guard must be stateless — all context loaded per-request from DB (no in-memory policy cache without TTL).
2. Evaluator failure (DB error, exception) → deny. Never fallback to allow.
3. `policy.stateGate` values: `membership_active` → check membership status.
4. `granted_actions` from `GET /workspace` is a UI projection only. Guard always re-evaluates independently.
5. Policy internals (`policyId`, `policyVersion`, `actions` array) must not appear in 403 error responses.
6. `AuthDecisionLog` is written for every allow AND deny decision (for audit trail completeness).

## Commands / Events

| Name                                   | Type              | Safe payload                                                                          |
| -------------------------------------- | ----------------- | ------------------------------------------------------------------------------------- |
| (No command — guard is infrastructure) | —                 | —                                                                                     |
| `event.pbac.decision`                  | `AuthDecisionLog` | `{ decision, reasonCode, action, sessionId, userId, orgId, policyId, policyVersion }` |

## PBAC

This file IS the PBAC implementation. No circular dependency.

## Test Cases

| ID  | Scenario                                             | Expected                                        |
| --- | ---------------------------------------------------- | ----------------------------------------------- |
| T01 | Valid session + active membership + action in policy | Pass (200 from endpoint)                        |
| T02 | Session expired                                      | 403 `PBAC_DENIED` + deny logged                 |
| T03 | Session revoked                                      | 403 `PBAC_DENIED` + deny logged                 |
| T04 | MFA enrolled + not verified                          | 403 `MFA_REQUIRED` + deny logged                |
| T05 | No active membership                                 | 403 `PBAC_DENIED` + deny logged                 |
| T06 | Policy not found                                     | 403 `PBAC_DENIED` + deny logged                 |
| T07 | Action not in `policy.actions`                       | 403 `PBAC_DENIED` + deny logged                 |
| T08 | Subject role mismatch                                | 403 `PBAC_DENIED` + deny logged                 |
| T09 | Evaluator throws (DB error)                          | 403 `PBAC_DENIED` + deny logged                 |
| T10 | 403 response body has no policy internals            | Response only has `error_code`, `correlationId` |
| T11 | `AuthDecisionLog` written for allow                  | DB row with `decision = allow`                  |
| T12 | `AuthDecisionLog` written for deny                   | DB row with `decision = deny` + `reasonCode`    |

## Definition of Done

- Default deny: any failure path returns 403, never 200.
- `@RequireAction` decorator sets required action; guard evaluates it against policy.
- `AuthDecisionLog` written for all allow and deny decisions.
- 403 response body never contains `policyId`, `policyVersion`, or `actions` array.
- Guard stateless per-request — loads fresh DB context each call.
