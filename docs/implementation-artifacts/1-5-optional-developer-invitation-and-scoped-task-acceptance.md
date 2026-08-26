---
baseline_revision: 2dcf9ab47c00215edbef0da829282f34c07bcf84
status: completed
---

# Story 1.5: Optional Developer Invitation and Scoped Task Acceptance

Status: completed

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Manager, I want to invite a Developer with a scoped RBAC task, so that the Developer can help without becoming required for the Manager golden path.

## Acceptance Criteria

1. **Given** a Manager owns an assessment or workspace context
   **When** the Manager invites a Developer
   **Then** LCSP creates an invitation with organization, assessment/task scope, expiry, allowed actions, and policy version
   **And** the invitation does not grant Manager-only actions.

2. **Given** an invited Developer opens the task
   **When** the Developer accepts a valid invitation
   **Then** LCSP shows granted RBAC scope, expiry/revocation state, hidden data boundaries, and assigned task context
   **And** Developer can access only assigned task surfaces
   **And** Manager flow remains available without Developer participation.

3. **Given** an invitation is expired, revoked, wrong-organization, or outside policy scope
   **When** the Developer attempts access
   **Then** LCSP denies access with safe explanation
   **And** no assessment data outside scope is returned
   **And** the denial is audited.

## Tasks / Subtasks

- [x] Add Developer invitation issuance, acceptance and scoped membership/policy binding. (AC: 1)
- [x] Persist optional collaborator scope without making Developer mandatory for Manager golden path. (AC: 2)
- [x] Audit invitation lifecycle, scope assignment and revocation-safe acceptance behavior. (AC: 3)

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `1-5-optional-developer-invitation-and-scoped-task-acceptance`
- Official execution artifact: `docs/implementation-artifacts/1-5-optional-developer-invitation-and-scoped-task-acceptance.md`
- Epic: `Epic 1 - Secure Workspace and RBAC-Scoped Collaboration`
- Runtime ownership: `apps/web`, `apps/api`, `packages/*`

### Current State and Scope Guardrails

- Epic 1 là foundation của toàn bộ workspace. Sai boundary ở đây sẽ làm hỏng assessment, scan trigger và downstream RBAC later stories.
- Story trong epic này chỉ nên mở auth/session/membership/RBAC seams cần thiết cho workspace entry; repository access là boundary khác.
- Repo hiện vẫn documentation-first, nên bootstrap tối thiểu phải bám retained topology thay vì tạo service layout ad hoc.

- Previous story context: `docs/developer/story-handbook/1-4-organization-membership-and-manager-policy-scope.md`
- Next story dependency seam: `docs/developer/story-handbook/1-6-manager-only-action-enforcement.md`
- Artifact chain for this epic: approved identity -> session -> organization membership gate -> RBAC-evaluated workspace access.
- Workflow/state focus: unauthenticated access, membership gate, session lifecycle, RBAC allow/deny and safe blocked auth states.

### Story-Specific Implementation Tasks

- Add Developer invitation issuance, acceptance and scoped membership/policy binding.
- Persist optional collaborator scope without making Developer mandatory for Manager golden path.
- Audit invitation lifecycle, scope assignment and revocation-safe acceptance behavior.

### Task to Acceptance Criteria Traceability

- `AC1`: Add Developer invitation issuance, acceptance and scoped membership/policy binding.
- `AC2`: Persist optional collaborator scope without making Developer mandatory for Manager golden path.
- `AC3`: Audit invitation lifecycle, scope assignment and revocation-safe acceptance behavior.

### Dependencies and Prerequisites

- Story 1.4 organization/policy scope foundation.
- RBAC model able to represent optional Developer collaborator.

### Explicit Non-Goals

- No unrestricted Developer workspace access.
- No structured attestation or deprecated collaboration flow.
- No Manager dependency on Developer to continue assessment flow.

### Story-Specific Risks and Edge Cases

- Invitation accepted into wrong org or wrong scope.
- Developer collaboration becomes workflow blocker.
- Revoked or invalid invite still accepted.

### Architecture Compliance

- Enforcement thực tế phải nằm ở NestJS API guard + service recheck; Web chỉ hiển thị public entry, redirect và backend-projected capability.
- RBAC là source of truth. Role labels `Manager`/`Developer` chỉ là subject attributes hoặc policy templates.
- OAuth/OIDC identity flow và GitHub repository authorization là hai boundary riêng; không trộn side effect trong login/session.

### Functional and Domain Requirements

- Story này phải được triển khai đúng theo acceptance criteria của riêng nó; không kéo behavior của story sau vào cùng slice nếu không có seam thật sự cần thiết.
- Domain chain liên quan của Epic 1: approved identity -> session -> organization membership gate -> RBAC-evaluated workspace access.
- Khi story chạm workflow gate, blocked/degraded path là một phần của yêu cầu chứ không phải edge-case tuỳ chọn.


### Data and Persistence Requirements

- Các story Epic 1 thường chạm `User`, `Session`, `Organization`, `OrganizationMembership`, `Policy`, `PolicyVersion`, `AuthorizationDecision`, `AuditEvent` và các DTO authz/authn liên quan.
- Token, MFA secret, OAuth token và credential reset material không được lưu plaintext.
- Decision/audit records phải mang correlation ID, organization scope, policy id/version và safe refs.

### State and Audit Requirements

- Thiếu session, thiếu membership active, thiếu policy hoặc evaluator failure đều phải deny-by-default.
- Audit bắt buộc cho login success/failure, access deny, session revoke/expire, policy allow/deny.
- Các blocked states phải có `required_action` an toàn như sign in, verify email, accept invite hoặc contact owner.

### File Structure Notes

- `apps/web` cho entry routes, protected workspace routing và blocked state rendering.
- `apps/api` cho auth/session/membership/RBAC/audit contracts.
- `packages/*` cho DTO, error code, authz contract, shared validation nếu bootstrap đã có.

### Implementation Guidance for the Dev Agent

- Làm đúng slice của story hiện tại; không kéo full MFA vào story non-MFA, không kéo full OAuth vào story non-OAuth.
- Session thành công không đồng nghĩa workspace access thành công; membership/RBAC gate phải chạy tiếp trước khi trả workspace data.
- UI copy phải safe, machine-readable error code phải ổn định, nhưng không được rò account existence hoặc tenant internals không cần thiết.

### Testing Requirements

- API auth/session negative tests và protected-route contract tests.
- RBAC deny-by-default coverage khi thiếu policy/attribute/state gate.
- Web redirect, safe blocked copy, no workspace data leak, audit redaction assertions.

### References

- [Source: docs/project-context.md]
- [Source: docs/planning-artifacts/epics.md]
- [Source: docs/product/prd.md]
- [Source: docs/specs/functional-requirements.md]
- [Source: docs/specs/non-functional-requirements.md]
- [Source: docs/specs/use-cases.md]
- [Source: docs/specs/domain-model.md]
- [Source: docs/specs/domain-state-machines.md]
- [Source: docs/specs/event-catalog.md]
- [Source: docs/architecture/architecture.md]
- [Source: docs/implementation/dev-compendium.md]
- [Source: docs/product/business-rules.md]
- [Source: docs/implementation/backend-implementation.md]
- [Source: docs/implementation/persistence-implementation.md]
- [Source: docs/implementation/decisions/rbac-runtime-decision.md]
- [Source: docs/implementation/tasks/modules/README.md]
- [Source: docs/implementation/tasks/modules/platform/rbac/02-evaluator-service.md]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Batch `bmad-create-story` run on 2026-07-02T22:01:26+07:00.
- Source packet: `docs/developer/story-handbook/1-5-optional-developer-invitation-and-scoped-task-acceptance.md`.
- Canonical title/source alignment: `docs/planning-artifacts/epics.md`.
- MW-auth-011 RED: `rtk pnpm --filter @lcsp/api test:e2e --runTestsByPath test/accept-invitation.e2e-spec.ts` failed with 404 before the endpoint existed.
- MW-auth-011 GREEN: `rtk pnpm --filter @lcsp/api test:e2e --runTestsByPath test/accept-invitation.e2e-spec.ts` passed.
- MW-auth-011 regression: `rtk pnpm --filter @lcsp/api test:e2e --runTestsByPath test/invite-developer.e2e-spec.ts`, `npm run lint`, `pnpm --filter @lcsp/api run build`, `rtk pnpm --filter @lcsp/api test`, and `rtk pnpm --filter @lcsp/api test:e2e` passed.
- MW-auth-012 RED: `rtk pnpm --filter @lcsp/api test:e2e --runTestsByPath test/revoke-membership.e2e-spec.ts` failed with 404 before the endpoint existed.
- MW-auth-012 GREEN: `rtk pnpm --filter @lcsp/api test:e2e --runTestsByPath test/revoke-membership.e2e-spec.ts` passed.
- MW-auth-012 regression: `rtk pnpm --filter @lcsp/api test:e2e --runTestsByPath test/accept-invitation.e2e-spec.ts test/invite-developer.e2e-spec.ts test/revoke-membership.e2e-spec.ts`, `npm run lint`, `pnpm --filter @lcsp/api run build`, `rtk pnpm --filter @lcsp/api test`, and `rtk pnpm --filter @lcsp/api test:e2e` passed.
- Final Story 1.5 check on 2026-07-22: `rtk pnpm test` passed with web 29/29 and API e2e 216/216; `rtk npm run lint` passed import policy, contract literal policy, Prisma generation, and TypeScript build.

### Completion Notes List

- Converted planning-derived developer packet into official execution artifact for dev cycle.
- Status set to `ready-for-dev` in `docs/implementation-artifacts/sprint-status.yaml`.
- Story retains planning authority references and scope guardrails for downstream `dev-story` work.
- MW-auth-011 complete: added public Developer invitation acceptance endpoint with atomic consume/user/membership/session creation and clean audit event.
- MW-auth-012 complete: added RBAC-protected Developer membership revocation with transactionally revoked membership, active session invalidation, self-revoke prevention, org mismatch guard, and clean audit event.
- **Added**: Implemented web scoped task workspace component (`DeveloperTaskWorkspace`) that loads developer task context and technical evidence, handles all access states (redirect, access_revoked, error, loading, empty, loaded), and displays scope summary and findings appropriately.
- Final check confirms all Story 1.5 tasks are complete, regression tests pass, and File List has been synchronized with the implemented API, web, i18n, contract, and test artifacts.

### File List

- docs/implementation-artifacts/1-5-optional-developer-invitation-and-scoped-task-acceptance.md
- apps/api/src/modules/auth-workspace/application/commands/accept-invitation/accept-invitation.command.ts
- apps/api/src/modules/auth-workspace/application/commands/accept-invitation/accept-invitation.handler.ts
- apps/api/src/modules/auth-workspace/application/contracts/auth-workspace/accept-invitation.contract.ts
- apps/api/src/modules/auth-workspace/application/services/auth-workspace/auth-workspace.facade.ts
- apps/api/src/modules/auth-workspace/auth-workspace.module.ts
- apps/api/src/modules/auth-workspace/presentation/http/auth-workspace.controller.ts
- apps/api/src/platform/rbac/rbac-context.loader.spec.ts
- apps/api/test/accept-invitation.e2e-spec.ts
- apps/api/prisma/migrations/20260713080000_auth_membership_revoked_at/migration.sql
- apps/api/prisma/schema.prisma
- apps/api/src/modules/auth-workspace/application/commands/revoke-membership/revoke-membership.command.ts
- apps/api/src/modules/auth-workspace/application/commands/revoke-membership/revoke-membership.handler.ts
- apps/api/src/modules/auth-workspace/application/contracts/auth-workspace/revoke-membership.contract.ts
- apps/api/test/revoke-membership.e2e-spec.ts
- apps/web/src/app/(auth)/invite/accept/page.tsx
- apps/web/src/app/(workspace)/developer/assessments/page.tsx
- apps/web/src/app/(workspace)/developer/assessments/[id]/page.tsx
- apps/web/src/app/api/auth/accept-invitation/route.ts
- apps/web/src/app/api/auth/invitations/preview/route.ts
- apps/web/src/app/api/assessments/[id]/evidence/route.ts
- apps/web/src/app/api/workspace/developer-task/route.ts
- apps/web/src/features/auth/components/organisms/accept-invitation-form.tsx
- apps/web/src/features/auth/schemas/accept-invitation.schema.ts
- apps/web/src/features/developer-task/components/organisms/developer-task-selection.tsx
- apps/web/src/features/developer-task/components/organisms/developer-task-workspace.tsx
- apps/web/src/features/developer-task/components/organisms/redacted-findings-list.tsx
- apps/web/src/features/developer-task/components/organisms/scope-summary-card.tsx
- apps/web/src/features/developer-task/config/action-labels.ts
- apps/web/src/features/developer-task/types/developer-task.types.ts
- apps/web/src/index.ts
- apps/web/src/lib/api/auth-client.ts
- apps/web/src/lib/api/developer-task-client.ts
- apps/web/src/lib/api/evidence-client.ts
- packages/contracts/src/auth/audit-event-types.ts
- packages/i18n/src/locales/en/pages.ts
- packages/i18n/src/locales/vi/pages.ts
- packages/i18n/src/types.ts
- tests/story-1-5.web.test.ts
- docs/developer/task-index.md
- docs/implementation/tasks/modules/auth-workspace/11-accept-developer-invitation-endpoint.md
- docs/implementation/tasks/modules/auth-workspace/12-revoke-developer-membership-endpoint.md

### Change Log

- 2026-07-13: Implemented MW-auth-011 Accept Developer Invitation Endpoint; Story 1.5 remains in-progress for remaining task slices.
- 2026-07-13: Implemented MW-auth-012 Revoke Developer Membership Endpoint; Story 1.5 remains in-progress for web scoped task workspace.
- 2026-07-22: Completed final Story 1.5 verification and synchronized Dev Agent Record evidence/File List.
