# Story 1.1 Developer Packet

Status: done

Implementation update 2026-08-25: Story 1.1 includes self-signup without
invitation acceptance for new Manager workspace owners. The collaborator path
still uses invitation acceptance.

## Story

As a user, I want to register or enter LCSP through an approved authentication path, so that I can access only the workspace I am authorized to use.

## Acceptance Criteria

1. **Given** a user has an approved account or invitation
   **When** the user registers or signs in with valid credentials
   **Then** LCSP creates an authenticated session scoped to the correct user identity
   **And** workspace access is denied until organization membership is confirmed
   **And** invalid credentials, invalid invite state, or missing membership are rejected with safe user-facing messages
   **And** an audit event records success or failure without secrets.

2. **Given** a user attempts to access a protected workspace without authentication
   **When** the request reaches Web/API
   **Then** LCSP blocks access and routes the user to the approved sign-in flow
   **And** no workspace data is returned.

## Dev Notes

- Packet type: `official-execution-reference`
- Story key: `1-1-approved-account-entry-and-workspace-access`
- Official execution artifact: `docs/implementation-artifacts/1-1-approved-account-entry-and-workspace-access.md`
- Epic: `Epic 1 - Secure Workspace and RBAC-Scoped Collaboration`
- Runtime ownership: `apps/web`, `apps/api`, `packages/*`

### Current State and Scope Guardrails

- Epic 1 là foundation của toàn bộ workspace. Sai boundary ở đây sẽ làm hỏng assessment, scan trigger và downstream RBAC later stories.
- Story trong epic này chỉ nên mở auth/session/membership/RBAC seams cần thiết cho workspace entry; repository access là boundary khác.
- Repo hiện vẫn documentation-first, nên bootstrap tối thiểu phải bám retained topology thay vì tạo service layout ad hoc.

- Previous story context: none; đây là story mở đầu chuỗi của epic hoặc một entry boundary mới.
- Next story dependency seam: `docs/developer/story-handbook/1-2-mfa-session-recovery-and-profile-safety.md`
- Artifact chain for this epic: approved identity -> session -> organization membership gate -> RBAC-evaluated workspace access.
- Workflow/state focus: unauthenticated access, membership gate, session lifecycle, RBAC allow/deny and safe blocked auth states.

### Story-Specific Implementation Tasks

- Implement approved password/invite entry routes and safe auth DTO/error-code contract.
- Implement self-signup for a new Manager-owned organization workspace.
- Create authenticated session plus membership gate before any workspace-scoped data is returned.
- Add backend guard/service recheck and audit trail for login success/failure and access denial.

### Task to Acceptance Criteria Traceability

- `AC1`: Implement approved password/invite entry routes and safe auth DTO/error-code contract.
- `AC2`: Create authenticated session plus membership gate before any workspace-scoped data is returned.
- `AC2`: Add backend guard/service recheck and audit trail for login success/failure and access denial.

### Dependencies and Prerequisites

- Bootstrap-compatible `apps/web` and `apps/api` skeleton from `module task catalog`.
- RBAC/runtime decision shape from `MW-rbac-002`.

### Explicit Non-Goals

- No MFA enforcement beyond seam needed for Story 1.2.
- No OAuth/OIDC provider callback flow beyond separation seam for Story 1.3.
- No repository authorization or scan side effect.

### Story-Specific Risks and Edge Cases

- Account-existence leakage through overly specific error copy.
- Workspace data leak before membership/RBAC gate completes.
- Storing plaintext token or secret material.

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
