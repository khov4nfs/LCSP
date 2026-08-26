---
baseline_commit: 4fa0cc15d09c6c662e07817aca5f7aae6a0cbe7d
---

# Story 1.7: RBAC Policy Runtime and Deny-on-Failure Contract

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

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

## Tasks / Subtasks

- [x] Implement evaluator contract for subject, organization, resource, action, context and policy version. (AC: 1)
- [x] Define fail-closed behavior for cache miss, evaluator failure and missing policy/state gate. (AC: 2)
- [x] Persist `AuthorizationDecision` and expose safe failure reasons to callers. (AC: 3)

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

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Batch `bmad-create-story` run on 2026-07-02T22:01:26+07:00.
- Source packet: `docs/developer/story-handbook/1-7-rbac-policy-runtime-and-deny-on-failure-contract.md`.
- Canonical title/source alignment: `docs/planning-artifacts/epics.md`.
- `bmad-dev-story` reconciliation run on 2026-07-10. This story's 3 tasks were implemented and merged BEFORE this run, via the parallel Jira/task-doc track (not through `/bmad-dev-story`), so `sprint-status.yaml` had drifted stale (`ready-for-dev`) relative to the real codebase. This session verified the existing implementation against each task/AC line-by-line (see Completion Notes) rather than re-implementing from scratch, then reconciled story tracking to match reality.
  - `MW-rbac-002` (Policy persistence model) → `LCSP-95`, merged PR #7.
  - `MW-rbac-002` (Evaluator service) → `LCSP-96`, merged PR #8.
  - `MW-rbac-003` (NestJS Guard) → `LCSP-97`, merged PR #13.
  - `MW-rbac-004` (Worker preflight) → `LCSP-98`, merged PR #14.
- Unit suite (`pnpm test`): 106/106 passing (16 suites), including 46 RBAC-specific tests across `rbac-context.loader.spec.ts`, `rbac-evaluator.service.spec.ts`, `rbac.guard.spec.ts`, `rbac-preflight.service.spec.ts`, `rbac-preflight.controller.spec.ts`.
- E2E suite (`pnpm test:e2e`): 96/96 previously-passing tests still pass. `developer-rbac.e2e-spec.ts` [AC-024/025/026] has 6 pre-existing failures, all traced to routes owned by _other_ stories that don't exist yet (`POST /assessments`, `POST /assessments/:id/scan-trigger`, `POST /assessments/:id/conflicts/:id/resolve`, `POST /organizations/:id/invitations`, `DELETE /organizations/:id/memberships/:id` — Epic 2/3/4/5 and Story 1.4/1.5 territory) — every one 404s before it ever reaches `RbacGuard`, so none of them are a RBAC-runtime defect. The guard's own equivalent case (revoked/inactive membership → deny) is unit-tested and passing (`rbac-context.loader.spec.ts`: "MEMBERSHIP_MISSING when the membership exists but is not active").
- `bmad-dev-story` revalidation run on 2026-07-22 after downstream Story 1.6 manager-only enforcement landed. No Story 1.7 runtime changes were required; the existing RBAC evaluator, guard, context loader, decision log repository and persisted policy-version model still satisfy all 3 ACs.
- `rtk npm run lint`: passed import policy, contract literal policy, Prisma client generation and TypeScript build.
- `rtk pnpm test`: passed web regression 31/31 and API e2e regression 25/25 suites, 219/219 tests.

### Completion Notes List

- Converted planning-derived developer packet into official execution artifact for dev cycle.
- Status set to `ready-for-dev` in `docs/implementation-artifacts/sprint-status.yaml`.
- Story retains planning authority references and scope guardrails for downstream `dev-story` work.
- **AC1 (evaluator contract)** — `RbacEvaluatorService.evaluate()` (`apps/api/src/platform/rbac/rbac-evaluator.service.ts`) takes a `RbacEvaluationContext` carrying subject (role, scope), organization (via policy.organizationId), resource/action, membership status, and the full policy (id + version + subjectRole + stateGate + actions). `RbacGuard.recordDecision()` persists organization_id, action, decision, reason_code, policy_id, policy_version and correlationId on every allow/deny.
- **AC2 (fail-closed)** — `RbacContextLoader.load()` (`rbac-context.loader.ts`) wraps the entire session→MFA→membership→policy lookup chain in try/catch, returning `LOAD_ERROR` (deny) on any unexpected storage failure — "never allow on error" per its own inline comment. `RbacEvaluatorService.evaluate()` separately catches any evaluator-internal throw and defaults to deny `POLICY_NOT_FOUND`. Missing policy, inactive state gate, role mismatch, and action-not-granted are each explicit deny branches, not fallthrough. All of these paths are unit-tested (T02–T06 in `rbac-evaluator.service.spec.ts`; `SESSION_INVALID`/`MFA_REQUIRED`/`MEMBERSHIP_MISSING`/`POLICY_NOT_FOUND`/`LOAD_ERROR` cases in `rbac-context.loader.spec.ts`).
- **AC3 (persist + safe failure reasons)** — `AuthorizationDecision` rows are appended via `PrismaAuthorizationDecisionRepository` (`AuthDecisionLog` table) on every guard decision, carrying policy id/version and correlation id for audit. Thrown `UnauthorizedException`/`ForbiddenException` bodies only ever carry a machine-readable `error_code` (from `AUTH_ERROR_CODES`) and `correlationId` — never raw policy content, action lists, or internal reason strings. Historical policy versions are preserved by construction: `AuthPolicy` is keyed by the composite `(id, version)` (never overwritten in place), and each `AuthMembership`/`AuthInvitation` pins its own `policyId`+`policyVersion`, so no separate cache-invalidation step is needed — the runtime always reads the current DB state and every past decision remains attributable to the exact policy version it was evaluated against.
- No code changes were required for this story; verification-only. If a genuine gap had been found, it would have been implemented following the red-green-refactor cycle per the skill's Step 5, same as Story 1.3.
- 2026-07-22 revalidation confirmed the deny-on-failure contract still holds after the manager-only action enforcement work: backend guard/service enforcement remains authoritative, safe caller errors stay redacted, and current full regression passes without Story 1.7 code changes.

### File List

- docs/implementation-artifacts/1-7-rbac-policy-runtime-and-deny-on-failure-contract.md
- docs/implementation-artifacts/sprint-status.yaml
- apps/api/src/platform/rbac/rbac-evaluator.service.ts (pre-existing, verified — LCSP-96)
- apps/api/src/platform/rbac/rbac-evaluator.service.spec.ts (pre-existing, verified — LCSP-96)
- apps/api/src/platform/rbac/rbac-context.loader.ts (pre-existing, verified — LCSP-97)
- apps/api/src/platform/rbac/rbac-context.loader.spec.ts (pre-existing, verified — LCSP-97)
- apps/api/src/platform/rbac/rbac.guard.ts (pre-existing, verified — LCSP-97)
- apps/api/src/platform/rbac/rbac.guard.spec.ts (pre-existing, verified — LCSP-97)
- apps/api/src/platform/rbac/rbac-preflight.service.ts (pre-existing, verified — LCSP-98)
- apps/api/src/platform/rbac/rbac-preflight.service.spec.ts (pre-existing, verified — LCSP-98)
- apps/api/src/platform/rbac/rbac-preflight.controller.ts (pre-existing, verified — LCSP-98)
- apps/api/src/platform/rbac/rbac-preflight.controller.spec.ts (pre-existing, verified — LCSP-98)
- apps/api/src/modules/auth-workspace/infrastructure/persistence/prisma-auth-workspace.repositories.ts (pre-existing, verified — `PrismaAuthorizationDecisionRepository`)
- apps/api/prisma/schema.prisma (pre-existing, verified — `AuthPolicy` composite `(id, version)` key, `AuthDecisionLog` model)

## Change Log

- 2026-07-10: Reconciled story tracking with already-merged RBAC runtime implementation (LCSP-95/96/97/98). No new code — verified each task/AC against existing evaluator/guard/loader/decision-log code and its 46 passing unit tests. All 3 story tasks complete; all 3 ACs satisfied. Status moved `ready-for-dev` → `in-progress` → `review`.
- 2026-07-22: Revalidated Story 1.7 against the current repo after Story 1.6 enforcement work. `rtk npm run lint` and `rtk pnpm test` pass; no Story 1.7 code changes required.
