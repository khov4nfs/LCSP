---
task_id: MW-auth-006
module: auth-workspace
runtime: nestjs-api
priority: P0
status: DONE
epic_story: 1.4
depends_on:
  - auth-workspace/01-sign-in-endpoint.md
  - platform/rbac/03-nestjs-guard.md
---

# Get Workspace Endpoint

## Outcome

Return the authenticated Manager's active organization workspace context — membership details, granted RBAC actions, and current session state — without leaking policy internals.

## Module Files

| File                                                                                             | Action | Notes                             |
| ------------------------------------------------------------------------------------------------ | ------ | --------------------------------- |
| `apps/api/src/modules/auth-workspace/presentation/http/auth-workspace.controller.ts`             | Verify | `GET /workspace` exists           |
| `apps/api/src/modules/auth-workspace/application/queries/get-workspace/get-workspace.query.ts`   | Verify | Query shape                       |
| `apps/api/src/modules/auth-workspace/application/queries/get-workspace/get-workspace.handler.ts` | Verify | Projection logic                  |
| `apps/api/src/modules/auth-workspace/application/contracts/auth-workspace/workspace.contract.ts` | Verify | `WorkspaceRequest` + response DTO |

## API Contract

**Endpoint:** `GET /workspace`
**Auth required:** Yes — valid session token (MFA-verified if MFA enrolled)

**Query parameters:**

| Param             | Type   | Required | Notes                                           |
| ----------------- | ------ | -------- | ----------------------------------------------- |
| `organization_id` | string | Yes      | Target organization scope                       |
| `session_token`   | string | Yes      | (Should move to Authorization header in future) |

**Success response (200):**

| Field                | Type     | Notes                                            |
| -------------------- | -------- | ------------------------------------------------ |
| `organization_id`    | string   |                                                  |
| `organization_name`  | string   |                                                  |
| `user_id`            | string   |                                                  |
| `display_name`       | string   |                                                  |
| `membership_status`  | string   | `active` only returned here                      |
| `subject_role`       | string   | From `AuthMembership.subjectAttributes.role`     |
| `granted_actions`    | string[] | Actions allowed by RBAC policy for this user+org |
| `session_expires_at` | string   | ISO 8601                                         |
| `mfa_verified`       | boolean  | Whether `session.mfaVerifiedAt` is set           |
| `correlationId`      | string   |                                                  |

**Error responses:**

| HTTP | `error_code`         | Meaning                                           |
| ---- | -------------------- | ------------------------------------------------- |
| 401  | `SESSION_INVALID`    | Token invalid, expired, or revoked                |
| 401  | `MFA_REQUIRED`       | MFA enrolled but not yet verified on this session |
| 403  | `MEMBERSHIP_MISSING` | No active membership in requested org             |
| 403  | `ORG_SCOPE_MISMATCH` | Session org ≠ requested org                       |

## Prisma Models Used

| Model              | Action | Key fields                                                                             |
| ------------------ | ------ | -------------------------------------------------------------------------------------- |
| `AuthSession`      | Read   | Validate token, check `mfaVerifiedAt`                                                  |
| `AuthMembership`   | Read   | `userId`, `organizationId`, `status`, `subjectAttributes`, `policyId`, `policyVersion` |
| `AuthOrganization` | Read   | `id`, `name`                                                                           |
| `AuthPolicy`       | Read   | `id`, `version`, `actions`, `subjectRole`, `stateGate`                                 |
| `AuthUser`         | Read   | `id`, `displayName`                                                                    |

## Business Rules

1. Validate session token (fingerprint + hash + expiry + revoked check).
2. If `AuthUserMfa` exists for user AND `session.mfaVerifiedAt = null` → `MFA_REQUIRED`.
3. Verify `session.organizationId == organizationId` (query param). If mismatch → `ORG_SCOPE_MISMATCH`.
4. Load `AuthMembership` for `(userId, organizationId)` with `status = active`. If not found → `MEMBERSHIP_MISSING`.
5. Load `AuthPolicy` for `(policyId, policyVersion)` from membership.
6. Project `granted_actions` from `policy.actions` — this is a projection/hint for UI only; server must recheck RBAC on each action.
7. Return workspace context. Do not return `policyId`, `policyVersion`, `tokenHash`, or internal policy conditions.

## Commands / Events

No audit event for read operations unless anomalous. RBAC allow/deny for sensitive workspace reads are logged by the RBAC guard.

## RBAC

- Requires valid session AND active membership.
- MFA check: if enrolled → must be verified.
- `granted_actions` is a projection — UI may use it to show/hide controls, but server enforces RBAC independently on every mutation.

## Test Cases

| ID  | Scenario                                                           | Expected                                           |
| --- | ------------------------------------------------------------------ | -------------------------------------------------- |
| T01 | Valid session, active Manager membership                           | 200 with organization, user, role, granted_actions |
| T02 | MFA enrolled + not verified                                        | 401 `MFA_REQUIRED`                                 |
| T03 | Expired session                                                    | 401 `SESSION_INVALID`                              |
| T04 | org_scope_mismatch (session org ≠ query param org)                 | 403 `ORG_SCOPE_MISMATCH`                           |
| T05 | No membership in org                                               | 403 `MEMBERSHIP_MISSING`                           |
| T06 | Response does not contain `policyId`, `policyVersion`, `tokenHash` | Safe projection verified                           |
| T07 | `granted_actions` matches `policy.actions` array                   | Projection matches DB                              |

## Definition of Done

- Workspace context returned for valid MFA-verified sessions with active membership.
- `MFA_REQUIRED` returned when MFA enrolled but not verified.
- Response does not leak policy internals or session token material.
- `granted_actions` is UI hint only — documented as non-authoritative.
