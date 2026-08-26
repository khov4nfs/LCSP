# Story 1.5 Developer Packet

Status: ready-for-dev

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
