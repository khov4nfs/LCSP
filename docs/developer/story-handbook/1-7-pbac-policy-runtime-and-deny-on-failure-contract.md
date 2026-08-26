# Story 1.7 Developer Packet

Status: ready-for-dev

## Story

RBAC Policy Runtime and Deny-on-Failure Contract

## Acceptance Criteria

1. **Given** RBAC policies are loaded for an organization
   **When** LCSP evaluates a protected action
   **Then** the decision uses actor, organization, resource, action, subject attributes, policy ID, policy version, and state gates
   **And** records allow/deny outcome, reason code, policy version, and correlation ID.

2. **Given** policy storage, cache, policy engine, or attribute lookup is unavailable
   **When** a protected action is evaluated
   **Then** LCSP denies by default unless the action is explicitly classified as safe public access
   **And** records a degraded authorization event without leaking policy internals.

3. **Given** RBAC policies change or migrate
   **When** new policy versions are activated
   **Then** LCSP preserves prior policy versions for historical audit
   **And** invalidates or refreshes caches according to the policy version contract.

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `1-7-rbac-policy-runtime-and-deny-on-failure-contract`
- Official execution artifact: `docs/implementation-artifacts/1-7-rbac-policy-runtime-and-deny-on-failure-contract.md`
- Epic: `Epic 1 - Secure Workspace and RBAC-Scoped Collaboration`
- Runtime ownership: `apps/web`, `apps/api`, `packages/*`

### Current State and Scope Guardrails

- Epic 1 là foundation của toàn bộ workspace. Sai boundary ở đây sẽ làm hỏng assessment, scan trigger và downstream RBAC later stories.
- Story trong epic này chỉ nên mở auth/session/membership/RBAC seams cần thiết cho workspace entry; repository access là boundary khác.
- Repo hiện vẫn documentation-first, nên bootstrap tối thiểu phải bám retained topology thay vì tạo service layout ad hoc.

- Previous story context: `docs/developer/story-handbook/1-6-manager-only-action-enforcement.md`
- Next story dependency seam: `docs/developer/story-handbook/1-8-foundational-audit-outbox-and-event-contract.md`
- Artifact chain for this epic: approved identity -> session -> organization membership gate -> RBAC-evaluated workspace access.
- Workflow/state focus: unauthenticated access, membership gate, session lifecycle, RBAC allow/deny and safe blocked auth states.

### Story-Specific Implementation Tasks

- Implement evaluator contract for subject, organization, resource, action, context and policy version.
- Define fail-closed behavior for cache miss, evaluator failure and missing policy/state gate.
- Persist `AuthorizationDecision` and expose safe failure reasons to callers.

### Task to Acceptance Criteria Traceability

- `AC1`: Implement evaluator contract for subject, organization, resource, action, context and policy version.
- `AC2`: Define fail-closed behavior for cache miss, evaluator failure and missing policy/state gate.
- `AC3`: Persist `AuthorizationDecision` and expose safe failure reasons to callers.

### Dependencies and Prerequisites

- `MW-rbac-002` authority and persistence model.
- Stories 1.4-1.6 as consuming authorization surfaces.

### Explicit Non-Goals

- No user-facing policy editor.
- No enterprise IAM/SCIM/SAML administration.
- No allow-on-error fallback.

### Story-Specific Risks and Edge Cases

- Cache/evaluator failure silently allowing action.
- Policy version drift between decision and audit.
- Unsafe failure reason leaks internals.

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
