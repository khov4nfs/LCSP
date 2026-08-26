# Story 1.9: Python Worker Command and Event Platform Contract

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Python Worker Command and Event Platform Contract

## Acceptance Criteria

1. **Given** a domain worker consumes a command
   **When** the command is accepted
   **Then** LCSP validates command name, schema version, aggregate IDs, organization scope, assessment scope where applicable, idempotency key, correlation ID, causation ID, retry metadata, and actor or system principal.

2. **Given** a worker handles a command
   **When** it locks work and writes results
   **Then** LCSP uses canonical inbox/outbox persistence, idempotency semantics, lease/lock timeout, retry budget, dead-letter behavior, and replay-safe result handling.

3. **Given** a command cannot be processed after retry budget or validation failure
   **When** it enters DLQ or operator recovery
   **Then** LCSP records reason, retry count, last error class, safe recovery action, and audit event
   **And** no worker creates duplicate accepted domain artifacts during replay.

## Tasks / Subtasks

- [ ] Define command/event schemas and handoff envelope for Python worker platform. (AC: 1)
- [ ] Set idempotency, lease, retry/DLQ and replay expectations shared by all workers. (AC: 2)
- [ ] Align API outbox publisher and worker consumer contracts before scanner/legal flows start. (AC: 3)

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `1-9-python-worker-command-and-event-platform-contract`
- Official execution artifact: `docs/implementation-artifacts/1-9-python-worker-command-and-event-platform-contract.md`
- Epic: `Epic 1 - Secure Workspace and RBAC-Scoped Collaboration`
- Runtime ownership: `apps/web`, `apps/api`, `packages/*`

### Current State and Scope Guardrails

- Epic 1 là foundation của toàn bộ workspace. Sai boundary ở đây sẽ làm hỏng assessment, scan trigger và downstream RBAC later stories.
- Story trong epic này chỉ nên mở auth/session/membership/RBAC seams cần thiết cho workspace entry; repository access là boundary khác.
- Repo hiện vẫn documentation-first, nên bootstrap tối thiểu phải bám retained topology thay vì tạo service layout ad hoc.

- Previous story context: `docs/developer/story-handbook/1-8-foundational-audit-outbox-and-event-contract.md`
- Next story dependency seam: none; story này là tail story hiện tại của epic.
- Artifact chain for this epic: approved identity -> session -> organization membership gate -> RBAC-evaluated workspace access.
- Workflow/state focus: unauthenticated access, membership gate, session lifecycle, RBAC allow/deny and safe blocked auth states.

### Story-Specific Implementation Tasks

- Define command/event schemas and handoff envelope for Python worker platform.
- Set idempotency, lease, retry/DLQ and replay expectations shared by all workers.
- Align API outbox publisher and worker consumer contracts before scanner/legal flows start.

### Task to Acceptance Criteria Traceability

- `AC1`: Define command/event schemas and handoff envelope for Python worker platform.
- `AC2`: Set idempotency, lease, retry/DLQ and replay expectations shared by all workers.
- `AC3`: Align API outbox publisher and worker consumer contracts before scanner/legal flows start.

### Dependencies and Prerequisites

- Story 1.8 foundational outbox contract.
- Queue and worker platform implementation authority.

### Explicit Non-Goals

- No specific scanner/legal business logic yet.
- No direct domain mutation from replay without guard.
- No Node.js downstream worker ownership.

### Story-Specific Risks and Edge Cases

- Incompatible command envelope between API and Python workers.
- Replay mutates accepted immutable artifacts.
- Missing idempotency key semantics for later chains.

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
- Source packet: `docs/developer/story-handbook/1-9-python-worker-command-and-event-platform-contract.md`.
- Canonical title/source alignment: `docs/planning-artifacts/epics.md`.

### Completion Notes List

- Converted planning-derived developer packet into official execution artifact for dev cycle.
- Status set to `ready-for-dev` in `docs/implementation-artifacts/sprint-status.yaml`.
- Story retains planning authority references and scope guardrails for downstream `dev-story` work.

### File List

- docs/implementation-artifacts/1-9-python-worker-command-and-event-platform-contract.md
