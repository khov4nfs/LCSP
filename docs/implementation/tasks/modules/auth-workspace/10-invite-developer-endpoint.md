---
task_id: MW-auth-010
module: auth-workspace
runtime: nestjs-api
priority: P0
status: REVIEW
baseline_commit: bf4653daad074be2c0e34c38cbd2be0ce524d8c5
epic_story: 1.5
depends_on:
  - auth-workspace/06-get-workspace-endpoint.md
  - platform/pbac/03-nestjs-guard.md
  - platform/audit-writer/02-audit-writer-service.md
---

# Invite Developer Endpoint

## Outcome

Allow a Manager to create a scoped Developer invitation for a specific assessment or task scope. The invite defines PBAC-bounded actions only. Manager golden path must not depend on Developer acceptance.

## Module Files

| File                                                                                                    | Action | Notes                                        |
| ------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------- |
| `apps/api/src/modules/auth-workspace/presentation/http/auth-workspace.controller.ts`                    | Modify | Add `POST /organizations/:orgId/invitations` |
| `apps/api/src/modules/auth-workspace/application/commands/invite-developer/invite-developer.command.ts` | Create | Command shape                                |
| `apps/api/src/modules/auth-workspace/application/commands/invite-developer/invite-developer.handler.ts` | Create | Invite creation logic                        |
| `apps/api/src/modules/auth-workspace/application/contracts/auth-workspace/invitation.contract.ts`       | Create | Request/response DTOs                        |
| `apps/api/src/modules/auth-workspace/auth-workspace.module.ts`                                          | Modify | Register new handler                         |

## API Contract

**Endpoint:** `POST /organizations/:orgId/invitations`
**Auth required:** Yes — Manager session + PBAC allow `invite:developer`

**Request body:**

| Field              | Type     | Required | Notes                                                |
| ------------------ | -------- | -------- | ---------------------------------------------------- |
| `email`            | string   | Yes      | Invitee email                                        |
| `assessment_id`    | string   | No       | Scope to specific assessment (must be Manager-owned) |
| `allowed_actions`  | string[] | Yes      | From `DEVELOPER_ALLOWED_ACTIONS` allowlist only      |
| `expires_in_hours` | number   | No       | Default 72h; max 168h                                |

**Success response (201):**

| Field             | Type     | Notes                   |
| ----------------- | -------- | ----------------------- |
| `invitation_id`   | string   |                         |
| `email`           | string   |                         |
| `expires_at`      | string   | ISO 8601                |
| `allowed_actions` | string[] | Echo of granted actions |
| `correlationId`   | string   |                         |

**Error responses:**

| HTTP | `error_code`           | Meaning                                                |
| ---- | ---------------------- | ------------------------------------------------------ |
| 403  | `PBAC_DENIED`          | Manager lacks `invite:developer` permission            |
| 400  | `INVALID_ACTIONS`      | One or more actions not in `DEVELOPER_ALLOWED_ACTIONS` |
| 400  | `ASSESSMENT_NOT_OWNED` | `assessment_id` not owned by Manager's org             |
| 422  | `INVALID_EMAIL`        | Email format invalid                                   |

## Prisma Models Used

| Model             | Action | Key fields                                                                                                                                                                                                                               |
| ----------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AuthInvitation`  | Create | `id`, `email`, `organizationId`, `state = approved`, `emailVerified = false`, `membershipStatus = active`, `subjectAttributes = { role: 'Developer', scope: assessmentId }`, `policyId` (developer policy), `policyVersion`, `expiresAt` |
| `AuthPolicy`      | Read   | Load developer policy template for org                                                                                                                                                                                                   |
| `AuthDecisionLog` | Create | PBAC allow/deny for `invite:developer` action                                                                                                                                                                                            |
| `AuthAuditEvent`  | Create | `AUTH_DEVELOPER_INVITED`                                                                                                                                                                                                                 |

## Business Rules

1. PBAC guard: evaluate `action = invite:developer`, `subject = Manager`, `org = session.organizationId`. Deny if not allowed.
2. Validate `allowed_actions` ⊆ `DEVELOPER_ALLOWED_ACTIONS` constant. Reject any action outside allowlist.
3. If `assessment_id` provided: verify assessment belongs to session org. Otherwise → `ASSESSMENT_NOT_OWNED`.
4. Create `AuthInvitation` with `state = approved`, expiry, and scoped `subjectAttributes`.
5. Developer invitation must NOT grant Manager-only actions (VerifiedProfile approval, classification request, final report generation, org management).
6. Emit audit event `AUTH_DEVELOPER_INVITED` with actor, org, invitee email (non-sensitive for audit), scope, expiry.

**`DEVELOPER_ALLOWED_ACTIONS` allowlist:**

- `evidence:read:redacted`
- `ai-usage-flow:read`
- `findings:read:redacted`
- `conflict:comment` (if enabled)
- `scan:read` (assessment-scoped status polling only)

## Commands / Events

| Name                           | Type             | Safe payload                                                                       |
| ------------------------------ | ---------------- | ---------------------------------------------------------------------------------- |
| `InviteDeveloperCommand`       | App command      | `{ orgId, email, assessmentId?, allowedActions, expiresInHours?, correlationId? }` |
| `event.auth.developer-invited` | `AuthAuditEvent` | `{ actorId, orgId, inviteeEmail, allowedActions, expiresAt, correlationId }`       |

## PBAC

- Manager must have `invite:developer` in their `AuthPolicy.actions`.
- Developer policy is a separate policy template in org; developer's `policyId` is the developer template ID.

## Test Cases

| ID  | Scenario                                                               | Expected                                      |
| --- | ---------------------------------------------------------------------- | --------------------------------------------- |
| T01 | Manager with `invite:developer` + valid actions + org-owned assessment | 201 invitation created                        |
| T02 | Manager lacks `invite:developer`                                       | 403 `PBAC_DENIED`                             |
| T03 | `allowed_actions` contains Manager-only action                         | 400 `INVALID_ACTIONS`                         |
| T04 | `assessment_id` not owned by Manager's org                             | 400 `ASSESSMENT_NOT_OWNED`                    |
| T05 | Invalid email format                                                   | 422 `INVALID_EMAIL`                           |
| T06 | `expires_in_hours` > 168                                               | Clamp to 168 or reject with `INVALID_REQUEST` |
| T07 | Invite has `state = approved` in DB                                    | DB row verified                               |
| T08 | PBAC deny logged in `AuthDecisionLog` when blocked                     | DB row with deny decision                     |
| T09 | Manager golden path unaffected if invite not accepted                  | Assessment flow continues                     |

## Definition of Done

- Invitation created with correct scope, policy, and expiry.
- `allowed_actions` strictly within `DEVELOPER_ALLOWED_ACTIONS`.
- Manager-only actions never granted to Developer invitations.
- PBAC deny logged for unauthorized calls.
- Manager workflow continues independently of Developer acceptance.

## Dev Agent Record

### Debug Log References

- RED: `rtk pnpm --filter @lcsp/api test -- --runTestsByPath src/modules/auth-workspace/application/commands/invite-developer/invite-developer.handler.spec.ts` failed on missing `invite-developer.command.ts`.
- GREEN: `rtk pnpm --filter @lcsp/api test --runTestsByPath src/modules/auth-workspace/application/commands/invite-developer/invite-developer.handler.spec.ts` passed.
- E2E: `rtk pnpm --filter @lcsp/api test:e2e --runTestsByPath test/invite-developer.e2e-spec.ts` passed.
- Regression: `rtk pnpm --filter @lcsp/api lint`, `rtk pnpm --filter @lcsp/api build`, `rtk pnpm --filter @lcsp/api test`, and `rtk pnpm --filter @lcsp/api test:e2e` passed.

### Completion Notes

- Added `POST /organizations/:orgId/invitations` with `PbacGuard` + `RequireAction("invite:developer")`.
- Added invite command, request/response contract, handler validation, developer action allowlist, assessment organization scope check, developer policy lookup, invitation creation, expiry clamp, and `AUTH_DEVELOPER_INVITED` audit event.
- Moved Developer policy action allowlist into JSON-backed config under `application/config/policies`.
- Added `AuthInvitation.expiresAt` persistence and Prisma migration.
- Preserved Manager golden path independence: invite creation is optional and assessment e2e continues without Developer acceptance.

### File List

- apps/api/prisma/migrations/20260713000000_auth_invitation_expires_at/migration.sql
- apps/api/nest-cli.json
- apps/api/prisma/schema.prisma
- apps/api/src/modules/app/infrastructure/providers/static-app-greeting.provider.ts
- apps/api/src/modules/auth-workspace/application/config/developer-policy.config.ts
- apps/api/src/modules/auth-workspace/application/config/policies/developer-policy.json
- apps/api/src/modules/auth-workspace/application/commands/invite-developer/invite-developer.command.ts
- apps/api/src/modules/auth-workspace/application/commands/invite-developer/invite-developer.handler.spec.ts
- apps/api/src/modules/auth-workspace/application/commands/invite-developer/invite-developer.handler.ts
- apps/api/src/modules/auth-workspace/application/commands/oauth-callback/oauth-callback.handler.spec.ts
- apps/api/src/modules/auth-workspace/application/contracts/auth-workspace/invitation.contract.ts
- apps/api/src/modules/auth-workspace/application/ports/persistence/assessment-scope.repository.ts
- apps/api/src/modules/auth-workspace/application/ports/persistence/invitation.repository.ts
- apps/api/src/modules/auth-workspace/application/ports/persistence/policy.repository.ts
- apps/api/src/modules/auth-workspace/application/services/auth-workspace/auth-workspace.facade.ts
- apps/api/src/modules/auth-workspace/auth-workspace.module.ts
- apps/api/src/modules/auth-workspace/domain/entities/invitation.entity.ts
- apps/api/src/modules/auth-workspace/domain/value-objects/subject-attributes.value-object.ts
- apps/api/src/modules/auth-workspace/infrastructure/persistence/prisma-assessment-scope.repository.ts
- apps/api/src/modules/auth-workspace/infrastructure/persistence/prisma-auth-workspace.mappers.ts
- apps/api/src/modules/auth-workspace/infrastructure/persistence/prisma-auth-workspace.repositories.ts
- apps/api/src/modules/auth-workspace/presentation/http/auth-workspace.controller.ts
- apps/api/src/platform/pbac/pbac-preflight.service.ts
- apps/api/src/platform/pbac/pbac.guard.ts
- apps/api/test/invite-developer.e2e-spec.ts
- apps/api/test/support/auth-workspace-test-helpers.ts
- apps/api/tsconfig.build.json
- docs/implementation-artifacts/sprint-status.yaml
- docs/implementation/tasks/modules/auth-workspace/10-invite-developer-endpoint.md

### Change Log

- 2026-07-13: Implemented MW-auth-010 Invite Developer Endpoint and moved task to review.
