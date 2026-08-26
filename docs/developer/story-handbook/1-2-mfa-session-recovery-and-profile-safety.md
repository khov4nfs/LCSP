# Story 1.2 Developer Packet

Status: ready-for-dev

## Story

As a workspace user, I want MFA, session, recovery, and safe profile controls, so that account access remains protected after login.

## Acceptance Criteria

1. **Given** MFA is required for the user or organization
   **When** the user signs in
   **Then** LCSP requires valid MFA verification before workspace access
   **And** invalid, expired, replayed, or rate-limited OTP attempts are rejected
   **And** MFA secret material is not persisted or logged in plaintext.

2. **Given** a session is expired or revoked
   **When** the user calls a protected route
   **Then** LCSP denies the request and shows a safe recovery or sign-in action
   **And** the denial is audited.

3. **Given** the user updates profile or recovery settings
   **When** the update succeeds or fails
   **Then** LCSP records a safe audit event
   **And** no secret values appear in logs, audit, UI, or API response.

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `1-2-mfa-session-recovery-and-profile-safety`
- Official execution artifact: `docs/implementation-artifacts/1-2-mfa-session-recovery-and-profile-safety.md`
- Epic: `Epic 1 - Secure Workspace and RBAC-Scoped Collaboration`
- Runtime ownership: `apps/web`, `apps/api`, `packages/*`

### Current State and Scope Guardrails

- Epic 1 là foundation của toàn bộ workspace. Sai boundary ở đây sẽ làm hỏng assessment, scan trigger và downstream RBAC later stories.
- Story trong epic này chỉ nên mở auth/session/membership/RBAC seams cần thiết cho workspace entry; repository access là boundary khác.
- Repo hiện vẫn documentation-first, nên bootstrap tối thiểu phải bám retained topology thay vì tạo service layout ad hoc.

- Previous story context: `docs/developer/story-handbook/1-1-approved-account-entry-and-workspace-access.md`
- Next story dependency seam: `docs/developer/story-handbook/1-3-oauth-oidc-login-without-repository-authorization.md`
- Artifact chain for this epic: approved identity -> session -> organization membership gate -> RBAC-evaluated workspace access.
- Workflow/state focus: unauthenticated access, membership gate, session lifecycle, RBAC allow/deny and safe blocked auth states.

### Story-Specific Implementation Tasks

- Add MFA enrollment/challenge, recovery flow hooks and profile-safety actions on top of existing auth session boundary.
- Enforce session expiry/revocation checks and safe recovery actions on protected routes.
- Audit MFA, recovery and profile-safety mutations without persisting plaintext secrets.

### Story-Specific Subtasks

- Model MFA enrollment/challenge/recovery state separate from base session and keep membership/RBAC gate intact.
- Add OTP validation rules for invalid, expired, replayed and rate-limited attempts before workspace access is granted.
- Implement session expiry/revocation handling so protected routes fail closed with safe recovery/sign-in actions.
- Audit MFA/recovery/profile-safety success and failure paths without exposing secret values in UI, API, logs or audit records.

### Task to Acceptance Criteria Traceability

- `AC1`: Add MFA enrollment/challenge, recovery flow hooks and profile-safety actions on top of existing auth session boundary.
- `AC2`: Enforce session expiry/revocation checks and safe recovery actions on protected routes.
- `AC3`: Audit MFA, recovery and profile-safety mutations without persisting plaintext secrets.

### Dependencies and Prerequisites

- Story 1.1 auth/session foundation.
- Rate-limit and safe-message behavior aligned with business rules.

### Explicit Non-Goals

- No repository authorization or GitHub connection.
- No full OAuth provider login implementation.
- No weakening of existing membership/RBAC gate.

### Story-Specific Risks and Edge Cases

- OTP replay/expired code acceptance.
- Recovery flow leaking secret values or account existence.
- Revoked session still accepted by protected routes.

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
