---
task_id: MW-auth-015
module: auth-workspace
runtime: nestjs-api
priority: P0
status: DONE
epic_story: 1.5
depends_on:
  - auth-workspace/10-invite-developer-endpoint.md
  - auth-workspace/11-accept-developer-invitation-endpoint.md
---

# Preview Developer Invitation and Preserve Acceptance Scope

## Outcome

Allow an invited Developer to inspect display-safe organization, assessment, granted-action, and expiry metadata before accepting, without consuming the invitation. Preserve the same authoritative scope in the acceptance response so the Web BFF can route to the exact assigned assessment.

## Module Files

| File                                                                                                       | Action | Notes                                                       |
| ---------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------- |
| `apps/api/src/modules/auth-workspace/presentation/http/auth-workspace.controller.ts`                       | Modify | Add public `POST /auth/invitations/preview`                 |
| `apps/api/src/modules/auth-workspace/application/queries/preview-invitation/preview-invitation.query.ts`   | Create | Query containing the opaque token and correlation ID        |
| `apps/api/src/modules/auth-workspace/application/queries/preview-invitation/preview-invitation.handler.ts` | Create | Validate without mutation and build the safe projection     |
| `apps/api/src/modules/auth-workspace/application/contracts/auth-workspace/invitation-preview.contract.ts`  | Create | Preview request/response DTOs                               |
| `apps/api/src/modules/auth-workspace/application/contracts/auth-workspace/accept-invitation.contract.ts`   | Modify | Add the accepted invitation's typed scope projection        |
| `apps/api/src/modules/auth-workspace/application/commands/accept-invitation/accept-invitation.handler.ts`  | Modify | Return scope from the consumed invitation, not client input |
| `apps/api/src/modules/auth-workspace/application/services/auth-workspace/auth-workspace.facade.ts`         | Modify | Expose preview query dispatch                               |
| `apps/api/src/modules/auth-workspace/auth-workspace.module.ts`                                             | Modify | Register the preview handler                                |
| `apps/api/test/preview-invitation.e2e-spec.ts`                                                             | Create | Public preview and non-leak regression coverage             |
| `apps/api/test/accept-invitation.e2e-spec.ts`                                                              | Modify | Assert acceptance scope parity                              |

## API Contract

**Endpoint:** `POST /auth/invitations/preview`  
**Auth required:** No. The single-use invitation token is the credential and must be sent in the JSON body, never a route or query parameter.

**Request body:**

| Field              | Type   | Required | Notes                            |
| ------------------ | ------ | -------- | -------------------------------- |
| `invitation_token` | string | Yes      | Opaque `AuthInvitation.id` value |

**Success response (200):**

| Field             | Type                                                                                                             | Notes                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `organization`    | `{ id: string, name: string }`                                                                                   | Display-safe organization identity                         |
| `scope`           | `{ type: 'assessment', assessment: { id: string, name: string } } \| { type: 'organization', assessment: null }` | Authoritative invitation scope                             |
| `allowed_actions` | string[]                                                                                                         | Filtered through `DEVELOPER_ALLOWED_ACTIONS`; UI hint only |
| `expires_at`      | string                                                                                                           | ISO 8601 invitation expiry                                 |
| `correlationId`   | string                                                                                                           | Safe request correlation identifier                        |

**Acceptance response extension (`POST /auth/accept-invitation`):**

| Field   | Type                                                                                             | Notes                                                                |
| ------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `scope` | `{ type: 'assessment', assessment_id: string } \| { type: 'organization', assessment_id: null }` | Derived from the accepted invitation inside the transaction boundary |

All existing acceptance response fields remain unchanged.

**Error responses:**

| HTTP | `error_code`         | Meaning                                                                                                                                      |
| ---- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | `INVITATION_INVALID` | Missing, unknown, expired, consumed, non-approved, malformed-scope, missing-policy, wrong-organization assessment, or missing display entity |

All invalid states use the same status and code. The response must not reveal whether the token ever existed or why it is unusable.

## Prisma Models Used

| Model              | Action                         | Key fields                                                                                     |
| ------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `AuthInvitation`   | Read only for preview          | `id`, `state`, `expiresAt`, `organizationId`, `subjectAttributes`, `policyId`, `policyVersion` |
| `AuthOrganization` | Read only                      | `id`, `name`                                                                                   |
| `Assessment`       | Read only for assessment scope | `id`, `organizationId`, `name`                                                                 |
| `AuthPolicy`       | Read only                      | Confirm pinned policy exists and intersect actions safely                                      |

## Business Rules

1. Preview is side-effect free: do not consume the invitation, create a user/membership/session, or write an allow audit event.
2. Treat missing, expired, consumed, non-approved, malformed, or unverifiable invitations identically as `INVITATION_INVALID`.
3. Resolve organization and assessment labels from persisted records. Never accept display labels or scope from the client and never decode the opaque token.
4. For assessment scope, require `Assessment.organizationId = AuthInvitation.organizationId`; fail closed otherwise.
5. Return only actions present in `DEVELOPER_ALLOWED_ACTIONS`. Do not expose policy internals, role-derived Manager actions, email, subject attributes, policy IDs, or policy versions.
6. Preview and acceptance must derive scope through one shared projection helper so they cannot disagree.
7. Acceptance returns scope only after atomic consumption succeeds. The session token remains unchanged and must never be logged or audited.
8. Repeated valid previews are allowed until expiry or consumption and must not extend invitation lifetime.
9. Record a safe denied audit event for invalid preview attempts using correlation ID and no raw token or invitation existence signal.

## PBAC

Public endpoint. The invitation token authorizes only this narrow, read-only preview. It grants no membership, session, repository access, or protected assessment access.

## Test Cases

| ID  | Scenario                                           | Expected                                                                       |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------ |
| T01 | Valid assessment-scoped invitation                 | 200 with organization, assessment, whitelisted actions, expiry, correlation ID |
| T02 | Valid organization-scoped invitation               | 200 with `type = organization` and `assessment = null`                         |
| T03 | Unknown, expired, consumed, or non-approved token  | Same 400 `INVITATION_INVALID` envelope                                         |
| T04 | Assessment belongs to another organization         | 400 `INVITATION_INVALID`; no cross-tenant label leaked                         |
| T05 | Policy or display entity missing                   | 400 `INVITATION_INVALID`                                                       |
| T06 | Preview repeated before acceptance                 | Invitation remains approved and expiry unchanged                               |
| T07 | Preview followed by acceptance                     | Acceptance succeeds once and returns matching scope ID                         |
| T08 | Invalid action present in stored attributes/policy | Action omitted; Manager action never returned                                  |
| T09 | Response and audit inspection                      | No email, token, policy internals, subject attributes, or secret material      |
| T10 | Manager workspace flow                             | No behavior change                                                             |

## Definition of Done

- A Developer can see the exact display-safe organization, assessment, allowed scope, and expiry before acceptance.
- Preview never mutates invitation or authentication state and all invalid states remain non-enumerable.
- Acceptance returns authoritative assessment or organization scope without exposing the session token beyond the existing API boundary.
- Unit/e2e coverage verifies scope parity, tenant isolation, action filtering, and audit/token redaction.
