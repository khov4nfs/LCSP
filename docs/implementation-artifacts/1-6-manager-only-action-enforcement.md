---
baseline_commit: ce72894d829504024b988b0d19ce28da50e32275
---

# Story 1.6: Manager-Only Action Enforcement

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Manager, I want Manager-only actions protected from Developer access, so that final assessment authority stays with the accountable Manager.

## Acceptance Criteria

1. **Given** a Developer has accepted a scoped task
   **When** the Developer attempts to edit Wizard answers, finalize conflict resolution, approve VerifiedProfile, run final classification, generate final report, export compliance dossier, change Manager decisions, invite users, or manage assessment settings
   **Then** LCSP denies the action server-side
   **And** the UI does not present the action as available when policy/state is known
   **And** the denial is audited with actor, action, resource, result, policy version, and correlation ID.

2. **Given** a Manager has valid policy and state gates allow the action
   **When** the Manager performs a Manager-only action
   **Then** LCSP permits the action
   **And** the action is auditable and tenant-scoped.

## Tasks / Subtasks

- [x] Enumerate Manager-only actions and wire RBAC-protected API guard plus service recheck. (AC: 1)
- [x] Hide or block Manager-only UX actions based on backend capability projection. (AC: 2)
- [x] Audit allow/deny with policy id/version and correlation ID. (AC: 2)

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `1-6-manager-only-action-enforcement`
- Official execution artifact: `docs/implementation-artifacts/1-6-manager-only-action-enforcement.md`
- Epic: `Epic 1 - Secure Workspace and RBAC-Scoped Collaboration`
- Runtime ownership: `apps/web`, `apps/api`, `packages/*`

### Current State and Scope Guardrails

- Epic 1 là foundation của toàn bộ workspace. Sai boundary ở đây sẽ làm hỏng assessment, scan trigger và downstream RBAC later stories.
- Story trong epic này chỉ nên mở auth/session/membership/RBAC seams cần thiết cho workspace entry; repository access là boundary khác.
- Repo hiện vẫn documentation-first, nên bootstrap tối thiểu phải bám retained topology thay vì tạo service layout ad hoc.

- Previous story context: `docs/developer/story-handbook/1-5-optional-developer-invitation-and-scoped-task-acceptance.md`
- Next story dependency seam: `docs/developer/story-handbook/1-7-rbac-policy-runtime-and-deny-on-failure-contract.md`
- Artifact chain for this epic: approved identity -> session -> organization membership gate -> RBAC-evaluated workspace access.
- Workflow/state focus: unauthenticated access, membership gate, session lifecycle, RBAC allow/deny and safe blocked auth states.

### Story-Specific Implementation Tasks

- Enumerate Manager-only actions and wire RBAC-protected API guard plus service recheck.
- Hide or block Manager-only UX actions based on backend capability projection.
- Audit allow/deny with policy id/version and correlation ID.

### Task to Acceptance Criteria Traceability

- `AC1`: Enumerate Manager-only actions and wire RBAC-protected API guard plus service recheck.
- `AC2`: Hide or block Manager-only UX actions based on backend capability projection.
- `AC2`: Audit allow/deny with policy id/version and correlation ID.

### Dependencies and Prerequisites

- Stories 1.4 and 1.5 policy scope and optional Developer context.
- RBAC runtime deny-by-default behavior.

### Explicit Non-Goals

- No broad role-based shortcut.
- No client-only authorization.
- No Developer override path for Manager-only mutations.

### Story-Specific Risks and Edge Cases

- Manager-only route callable by Developer via direct API.
- Hidden UI action still executable server-side.
- Policy evaluator failure accidentally allows action.

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
- Source packet: `docs/developer/story-handbook/1-6-manager-only-action-enforcement.md`.
- Canonical title/source alignment: `docs/planning-artifacts/epics.md`.
- RED: `rtk pnpm run test:web` failed because `@lcsp/contracts/rbac` did not export `MANAGER_ONLY_ACTIONS`.
- RED: `rtk pnpm --filter @lcsp/api test --runTestsByPath src/modules/assessment/application/commands/create-assessment/create-assessment.handler.spec.ts src/modules/wizard/application/commands/save-wizard-draft/save-wizard-draft.handler.spec.ts` failed because service handlers did not recheck Manager-only RBAC context or write policy metadata in audit.
- GREEN: `rtk pnpm run test:web` passed 31/31.
- GREEN: `rtk pnpm --filter @lcsp/api test --runTestsByPath src/modules/assessment/application/commands/create-assessment/create-assessment.handler.spec.ts src/modules/wizard/application/commands/save-wizard-draft/save-wizard-draft.handler.spec.ts` passed 15/15.
- GREEN: `rtk pnpm --filter @lcsp/api test:e2e --runTestsByPath test/developer-rbac.e2e-spec.ts` passed 5/5.
- Regression: `rtk pnpm --filter @lcsp/api test:e2e --runTestsByPath test/developer-rbac.e2e-spec.ts test/auth-workspace.e2e-spec.ts test/revoke-membership.e2e-spec.ts test/invite-developer.e2e-spec.ts` passed 55/55.
- Final validation: `rtk npm run lint` passed import policy, contract literal policy, Prisma generation, and TypeScript build.
- Final validation: `rtk pnpm test` passed web 31/31 and API e2e 25 suites / 219 tests.

### Completion Notes List

- Converted planning-derived developer packet into official execution artifact for dev cycle.
- Status set to `ready-for-dev` in `docs/implementation-artifacts/sprint-status.yaml`.
- Story retains planning authority references and scope guardrails for downstream `dev-story` work.
- Added canonical `MANAGER_ONLY_ACTIONS` contract covering current and planned Manager-only authority actions.
- Wired existing Manager-only mutation routes (`assessment:create`, `wizard:write`) to pass RBAC context into command handlers and added service-level rechecks before mutation.
- Updated Manager-only audit writes so allow and service-level deny events include policy id/version and correlation ID.
- Updated workspace capability helper so Manager-only UI affordances remain hidden unless the backend grants the matching action.
- Added Story 1.6 web, unit, and e2e coverage for Developer denial, Manager allow, service recheck, safe responses, and audit metadata.

### File List

- docs/implementation-artifacts/1-6-manager-only-action-enforcement.md
- docs/implementation-artifacts/sprint-status.yaml
- packages/contracts/src/rbac/actions.ts
- packages/contracts/src/rbac/index.ts
- packages/contracts/src/rbac/manager-policy.ts
- apps/web/src/lib/api/workspace-client.ts
- tests/story-1-6.web.test.ts
- apps/api/src/modules/assessment/application/commands/create-assessment/create-assessment.command.ts
- apps/api/src/modules/assessment/application/commands/create-assessment/create-assessment.handler.ts
- apps/api/src/modules/assessment/application/commands/create-assessment/create-assessment.handler.spec.ts
- apps/api/src/modules/assessment/presentation/http/assessment.controller.ts
- apps/api/src/modules/wizard/application/commands/save-wizard-draft/save-wizard-draft.command.ts
- apps/api/src/modules/wizard/application/commands/save-wizard-draft/save-wizard-draft.handler.ts
- apps/api/src/modules/wizard/application/commands/save-wizard-draft/save-wizard-draft.handler.spec.ts
- apps/api/src/modules/wizard/presentation/http/wizard.controller.ts
- apps/api/test/developer-rbac.e2e-spec.ts
- apps/api/test/invite-developer.e2e-spec.ts
- apps/api/test/support/auth-workspace-test-helpers.ts

### Change Log

- 2026-07-22: Implemented Story 1.6 Manager-only action enforcement and moved story to review.
