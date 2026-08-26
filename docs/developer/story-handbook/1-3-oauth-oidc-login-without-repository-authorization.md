# Story 1.3 Developer Packet

Status: ready-for-dev

## Story

As a user, I want OAuth/OIDC login to authenticate only my LCSP identity, so that signing in does not accidentally grant repository scan access.

## Acceptance Criteria

1. **Given** an OAuth/OIDC provider is configured
   **When** the user completes provider login
   **Then** LCSP validates redirect URI, state, nonce, issuer, audience, expiry, and safe account linking
   **And** LCSP creates only LCSP identity/session state
   **And** no GitHub RepositoryConnection, repository token, or scan permission is created.

2. **Given** an OAuth/OIDC callback is invalid or unsafe
   **When** LCSP receives the callback
   **Then** the callback is rejected
   **And** the user sees a safe failure message
   **And** an audit event records the failure reason without tokens.

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `1-3-oauth-oidc-login-without-repository-authorization`
- Official execution artifact: `docs/implementation-artifacts/1-3-oauth-oidc-login-without-repository-authorization.md`
- Epic: `Epic 1 - Secure Workspace and RBAC-Scoped Collaboration`
- Runtime ownership: `apps/web`, `apps/api`, `packages/*`

### Current State and Scope Guardrails

- Epic 1 là foundation của toàn bộ workspace. Sai boundary ở đây sẽ làm hỏng assessment, scan trigger và downstream RBAC later stories.
- Story trong epic này chỉ nên mở auth/session/membership/RBAC seams cần thiết cho workspace entry; repository access là boundary khác.
- Repo hiện vẫn documentation-first, nên bootstrap tối thiểu phải bám retained topology thay vì tạo service layout ad hoc.

- Previous story context: `docs/developer/story-handbook/1-2-mfa-session-recovery-and-profile-safety.md`
- Next story dependency seam: `docs/developer/story-handbook/1-4-organization-membership-and-manager-policy-scope.md`
- Artifact chain for this epic: approved identity -> session -> organization membership gate -> RBAC-evaluated workspace access.
- Workflow/state focus: unauthenticated access, membership gate, session lifecycle, RBAC allow/deny and safe blocked auth states.

### Story-Specific Implementation Tasks

- Implement OAuth/OIDC callback validation for redirect URI, state, nonce, issuer, audience and expiry.
- Create LCSP identity/session only after safe account linking.
- Harden audit and blocked state handling so login never creates repository authorization.

### Task to Acceptance Criteria Traceability

- `AC1`: Implement OAuth/OIDC callback validation for redirect URI, state, nonce, issuer, audience and expiry.
- `AC2`: Create LCSP identity/session only after safe account linking.
- `AC2`: Harden audit and blocked state handling so login never creates repository authorization.

### Dependencies and Prerequisites

- Story 1.1 auth/session base.
- Provider configuration and callback routes in web/api topology.

### Explicit Non-Goals

- No GitHub App repository connection.
- No repository token persistence or scan permission.
- No bypass of membership/RBAC gate after provider login.

### Story-Specific Risks and Edge Cases

- Unsafe callback validation or account-linking bug.
- Identity login accidentally treated as repo authorization.
- Token leakage in audit/log/UI surfaces.

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
