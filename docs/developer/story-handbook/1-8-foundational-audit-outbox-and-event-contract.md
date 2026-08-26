# Story 1.8 Developer Packet

Status: ready-for-dev

## Story

Foundational Audit, Outbox, and Event Contract

## Acceptance Criteria

1. **Given** a material domain transition occurs
   **When** LCSP commits the domain change
   **Then** it writes the domain state, audit event, and outbox event transactionally where supported
   **And** includes event name, schema version, aggregate ID, organization ID, assessment ID where applicable, correlation ID, causation ID, actor, result, and redaction status.

2. **Given** an event payload contains secrets, raw source, full prompts, repository tokens, or out-of-scope tenant data
   **When** audit or outbox payload is built
   **Then** LCSP redacts or omits unsafe fields
   **And** stores only approved metadata, hashes, and safe references.

3. **Given** audit or outbox write fails for a required material transition
   **When** LCSP evaluates the operation
   **Then** LCSP blocks, retries, or marks the operation degraded according to the domain failure policy
   **And** never silently drops required audit evidence.

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `1-8-foundational-audit-outbox-and-event-contract`
- Official execution artifact: `docs/implementation-artifacts/1-8-foundational-audit-outbox-and-event-contract.md`
- Epic: `Epic 1 - Secure Workspace and RBAC-Scoped Collaboration`
- Runtime ownership: `apps/web`, `apps/api`, `packages/*`

### Current State and Scope Guardrails

- Epic 1 là foundation của toàn bộ workspace. Sai boundary ở đây sẽ làm hỏng assessment, scan trigger và downstream RBAC later stories.
- Story trong epic này chỉ nên mở auth/session/membership/RBAC seams cần thiết cho workspace entry; repository access là boundary khác.
- Repo hiện vẫn documentation-first, nên bootstrap tối thiểu phải bám retained topology thay vì tạo service layout ad hoc.

- Previous story context: `docs/developer/story-handbook/1-7-rbac-policy-runtime-and-deny-on-failure-contract.md`
- Next story dependency seam: `docs/developer/story-handbook/1-9-python-worker-command-and-event-platform-contract.md`
- Artifact chain for this epic: approved identity -> session -> organization membership gate -> RBAC-evaluated workspace access.
- Workflow/state focus: unauthenticated access, membership gate, session lifecycle, RBAC allow/deny and safe blocked auth states.

### Story-Specific Implementation Tasks

- Define foundational audit event schema for auth/RBAC/session and early workflow actions.
- Introduce outbox ownership and event naming conventions for future async domains.
- Ensure append-only audit plus correlation ID propagation across sync-to-async boundary.

### Task to Acceptance Criteria Traceability

- `AC1`: Define foundational audit event schema for auth/RBAC/session and early workflow actions.
- `AC2`: Introduce outbox ownership and event naming conventions for future async domains.
- `AC3`: Ensure append-only audit plus correlation ID propagation across sync-to-async boundary.

### Dependencies and Prerequisites

- Core persistence baseline and RBAC decision metadata.
- Future async worker contract expectations from queue implementation docs.

### Explicit Non-Goals

- No full downstream worker implementation.
- No dropping audit on material transitions.
- No ad hoc event naming outside canonical pattern.

### Story-Specific Risks and Edge Cases

- Audit and outbox diverge on correlation/event identity.
- Material action succeeds without durable audit.
- Early contract choices block later worker orchestration.

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
