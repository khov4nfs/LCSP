---
baseline_commit: 04647ccb88a1933d89bdee74cb2d17f27745d011
---

# Story 1.4: Organization Membership and Manager Policy Scope

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Manager, I want LCSP to recognize my organization and Manager policy scope, so that I can start and own assessments without receiving unauthorized powers.

## Acceptance Criteria

1. **Given** an authenticated user belongs to an organization
   **When** the user enters the workspace
   **Then** LCSP displays the active organization/workspace context
   **And** RBAC evaluates workspace-scoped actions using actor identity, organization, resource, action, subject attributes, policy, and policy version.

2. **Given** the user has Manager policy scope for an organization
   **When** the user opens Manager workspace actions
   **Then** LCSP allows only actions granted by RBAC and current state gates
   **And** denied actions are hidden where appropriate or blocked with safe explanation
   **And** allow/deny decisions are audited with policy ID/version and correlation ID.

## Tasks / Subtasks

- [x] Materialize active organization/workspace context for authenticated users. (AC: 1)
- [x] Bind Manager subject attributes and policy versioning into RBAC evaluation context. (AC: 2)
- [x] Project safe allow/deny results into workspace UX while auditing server-side decisions. (AC: 2)

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `1-4-organization-membership-and-manager-policy-scope`
- Official execution artifact: `docs/implementation-artifacts/1-4-organization-membership-and-manager-policy-scope.md`
- Epic: `Epic 1 - Secure Workspace and RBAC-Scoped Collaboration`
- Runtime ownership: `apps/web`, `apps/api`, `packages/*`

### Current State and Scope Guardrails

- Epic 1 là foundation của toàn bộ workspace. Sai boundary ở đây sẽ làm hỏng assessment, scan trigger và downstream RBAC later stories.
- Story trong epic này chỉ nên mở auth/session/membership/RBAC seams cần thiết cho workspace entry; repository access là boundary khác.
- Repo hiện vẫn documentation-first, nên bootstrap tối thiểu phải bám retained topology thay vì tạo service layout ad hoc.

- Previous story context: `docs/developer/story-handbook/1-3-oauth-oidc-login-without-repository-authorization.md`
- Next story dependency seam: `docs/developer/story-handbook/1-5-optional-developer-invitation-and-scoped-task-acceptance.md`
- Artifact chain for this epic: approved identity -> session -> organization membership gate -> RBAC-evaluated workspace access.
- Workflow/state focus: unauthenticated access, membership gate, session lifecycle, RBAC allow/deny and safe blocked auth states.

### Story-Specific Implementation Tasks

- Materialize active organization/workspace context for authenticated users.
- Bind Manager subject attributes and policy versioning into RBAC evaluation context.
- Project safe allow/deny results into workspace UX while auditing server-side decisions.

### Task to Acceptance Criteria Traceability

- `AC1`: Materialize active organization/workspace context for authenticated users.
- `AC2`: Bind Manager subject attributes and policy versioning into RBAC evaluation context.
- `AC2`: Project safe allow/deny results into workspace UX while auditing server-side decisions.

### Dependencies and Prerequisites

- Story 1.1 session + membership gate.
- RBAC persistence/runtime decision from `MW-rbac-002`.

### Explicit Non-Goals

- No Developer invitation/task assignment yet.
- No Manager-only action enforcement outside scope needed to enter workspace.
- No role-label-only authorization shortcuts.

### Story-Specific Risks and Edge Cases

- Wrong organization scope attached to session.
- Policy version not recorded in allow/deny trail.
- UI infers authorization locally instead of using backend projection.

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
- Source packet: `docs/developer/story-handbook/1-4-organization-membership-and-manager-policy-scope.md`.
- Canonical title/source alignment: `docs/planning-artifacts/epics.md`.
- RED: `auth-workspace.e2e-spec.ts` failed because `GET /workspace` did not expose the flat organization context contract.
- GREEN: targeted auth-workspace E2E passed 36/36; full API E2E passed 181/181.

### Implementation Plan

- Lock the flat workspace response contract with an end-to-end regression test.
- Reuse the exact membership-bound policy evaluation and return only its safe action projection.
- Verify the existing web projection, safe redirects, and server-side authorization audit trail.

### Completion Notes List

- Converted planning-derived developer packet into official execution artifact for dev cycle.
- Status set to `ready-for-dev` in `docs/implementation-artifacts/sprint-status.yaml`.
- Story retains planning authority references and scope guardrails for downstream `dev-story` work.
- Materialized the active organization, Manager membership, session expiry, MFA state, and granted actions in the workspace response.
- Preserved deny-by-default evaluation and projected actions from the exact policy ID/version bound to the active membership without exposing policy or token internals.
- Verified the workspace UX consumes backend-projected actions only, with safe auth/MFA redirects and server-side RBAC decision auditing.
- Validation: API build passed; API unit tests passed 269/269; API E2E passed 181/181; web tests passed 4/4; changed API files passed ESLint and Prettier checks.
- Repository-wide lint/typecheck remains blocked by pre-existing `github-integration` spec errors outside Story 1.4 scope.

### File List

- docs/implementation-artifacts/1-4-organization-membership-and-manager-policy-scope.md
- docs/implementation-artifacts/sprint-status.yaml
- apps/api/src/modules/auth-workspace/application/contracts/auth-workspace/workspace.contract.ts
- apps/api/src/modules/auth-workspace/application/queries/get-workspace/get-workspace.handler.ts
- apps/api/src/modules/auth-workspace/application/services/auth-workspace/auth-workspace-support.service.ts
- apps/api/test/auth-workspace.e2e-spec.ts
- apps/api/test/support/auth-workspace-test-helpers.ts

## Change Log

- 2026-07-19: Implemented the safe organization/Manager workspace context projection, policy-bound granted actions, and authorization audit coverage; moved story to review.
