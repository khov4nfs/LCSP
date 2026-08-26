---
status: done
baseline_commit: b66788d
---

# Story 1.10: TypeScript Contract, Localization, and Import Boundary Governance

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer, I want authentication and workspace-facing shared modules to use typed public contracts and enforced import boundaries, so that Web/API can share stable behavior without source-path coupling or copy drift.

## Acceptance Criteria

1. **Given** shared auth, workspace, and localization modules are used across apps and packages
   **When** a developer imports contracts, copy keys, or resolvers
   **Then** the import uses approved public package or app exports
   **And** direct source-path imports, forbidden self-import patterns, and disallowed workspace-relative imports are rejected by repository validation.

2. **Given** auth and blocked-state contracts are shared between API and Web
   **When** the contracts are changed
   **Then** TypeScript validation fails if API and Web drift on the contract shape
   **And** tests cover the stable key-based blocked-state behavior across the shared boundary.

## Tasks / Subtasks

- [x] Migrate auth and blocked-state shared modules toward typed public contracts with project-aware TypeScript validation across `apps/api`, `apps/web`, `packages/contracts`, `packages/i18n`, and `tests`. (AC: 1)
- [x] Move customer-facing auth and blocked-state copy resolution to shared i18n dictionaries so backend emits stable keys plus safe metadata instead of final prose. (AC: 2)
- [x] Enforce import-boundary governance so apps and packages consume only approved public exports and repository validation rejects deep source-path, forbidden self-import, or disallowed workspace-relative imports.
- [x] Story-specific subtasks
  - [x] Define or refine public exports for auth/workspace problem contracts, required actions, locale-safe DTOs, and blocked-state keys.
  - [x] Define typed `vi/en` dictionaries and resolver helpers in `packages/i18n` without placing customer-facing prose inside `packages/contracts`.
  - [x] Update API, Web, and tests to consume public package exports only and fail typecheck if shared contract shape drifts.
  - [x] Add repository validation and tests that cover key-based blocked-state rendering plus import-policy enforcement.

## Dev Notes

- Packet type: `planning-derived-developer-packet`
- Story key: `1-10-typescript-contract-localization-and-import-boundary-governance`
- Official execution artifact: `docs/implementation-artifacts/1-10-typescript-contract-localization-and-import-boundary-governance.md`
- Epic: `Epic 1 - Secure Workspace and RBAC-Scoped Collaboration`
- Runtime ownership: `apps/api`, `apps/web`, `packages/contracts`, `packages/i18n`, `tests`

### Current State and Scope Guardrails

- Story này xuất phát từ correction đã được approve ngày `2026-07-02`; mục tiêu là đồng bộ authority docs với implementation direction TypeScript-first, shared i18n dictionary và import governance đã xuất hiện trong repo.
- Đây là story kỹ thuật xuyên package/app cho auth và workspace surface. Nó không thêm capability end-user mới, không thay đổi golden path Manager, và không thay thế scope của Story `1.2` hay `1.3`.
- Boundary cần khóa: contract semantic sống trong shared package, copy sống trong shared i18n package, Web render từ stable key, backend không dựa vào prose hardcoded làm UI message cuối cùng.

- Previous story context: `docs/implementation-artifacts/1-1-approved-account-entry-and-workspace-access.md`
- Supporting correction artifact: `docs/implementation-artifacts/typescript-i18n-migration-plan-2026-07-02.md`
- Migration plan seam: `docs/implementation-artifacts/typescript-i18n-migration-plan-2026-07-02.md`
- Workflow/state focus: compile-time contract integrity, localization key rendering, public export boundaries, and repository validation.

### Story-Specific Implementation Tasks

- Migrate auth and blocked-state shared modules toward typed public contracts with project-aware TypeScript validation across `apps/api`, `apps/web`, `packages/contracts`, `packages/i18n`, and `tests`.
- Move customer-facing auth and blocked-state copy resolution to shared i18n dictionaries so backend emits stable keys plus safe metadata instead of final prose.
- Enforce import-boundary governance so apps and packages consume only approved public exports and repository validation rejects deep source-path, forbidden self-import, or disallowed workspace-relative imports.

### Story-Specific Subtasks

- Define or refine public exports for auth/workspace problem contracts, required actions, locale-safe DTOs, and blocked-state keys.
- Define typed `vi/en` dictionaries and resolver helpers in `packages/i18n` without placing customer-facing prose inside `packages/contracts`.
- Update API, Web, and tests to consume public package exports only and fail typecheck if shared contract shape drifts.
- Add repository validation and tests that cover key-based blocked-state rendering plus import-policy enforcement.

### Task to Acceptance Criteria Traceability

- `AC1`: Migrate auth/i18n/import surfaces to approved public exports and repository validation.
- `AC2`: Add TypeScript cross-project validation and tests for stable key-based blocked-state behavior.

### Dependencies and Prerequisites

- Story `1.1` auth/workspace foundation and its safe error contract direction.
- Approved correction artifact dated `2026-07-02` and current TypeScript migration plan.
- Retained topology in `apps/api`, `apps/web`, `packages/*`, `tests/*`.

### Explicit Non-Goals

- No new OAuth/OIDC provider flow implementation.
- No new MFA/recovery capability beyond typed/shared contract seams needed for later stories.
- No reintroduction of backend-owned hardcoded customer-facing prose as the source of truth for blocked-state UI copy.

### Story-Specific Risks and Edge Cases

- Drift between API problem contract and Web rendering contract after refactors.
- Deep imports or self-import shortcuts bypassing package public boundaries.
- Shared dictionaries containing secrets, policy internals, or unstable strings that tests cannot reliably assert.

### Architecture Compliance

- Preserve retained runtime shape: `apps/web` is the web UX boundary, `apps/api` is the NestJS control-plane boundary, and shared semantics live in `packages/*`.
- RBAC, session, and audit behavior remain server-authoritative; this story only hardens the contract and localization seam around those behaviors.
- Public app/package imports must use approved exports; source-path coupling is forbidden.

### Functional and Domain Requirements

- Auth, blocked-state, and safe failure responses for Web/API must expose stable shared keys so Web renders approved user-facing copy without depending on backend prose.
- Shared auth/workspace contracts must fail type validation when API and Web drift on shape or key semantics.
- Contract changes must preserve machine-readable codes, required actions, correlation IDs, and safe metadata semantics already established for auth boundaries.

### Data and Persistence Requirements

- Không cần mở rộng persistence chỉ để phục vụ localization; focus là contract shape, key-space, và resolver boundary.
- Secrets, tokens, policy internals, và raw diagnostic text không được chuyển vào dictionaries hoặc contract payload như customer-facing fields.
- If metadata interpolation is required, keep it typed and safe for frontend rendering.

### State and Audit Requirements

- Existing auth/session/RBAC audit semantics from Story `1.1` must remain intact; contract migration must not remove correlation IDs or safe blocked-action hints.
- Failures from import-policy or type-validation in CI are acceptance evidence, not runtime substitutions for backend enforcement.
- Blocked-state rendering remains non-authoritative; authorization decisions still come from backend RBAC evaluation.

### File Structure Notes

- `packages/contracts` for semantic auth/workspace contracts and public exports.
- `packages/i18n` for typed `vi/en` dictionaries and resolver helpers.
- `apps/api`, `apps/web`, and `tests` must consume public exports only; avoid direct imports into another package's `src/**`.
- Root `tsconfig*.json` and package `tsconfig.json` files are part of the implementation surface for this story.

### Implementation Guidance for the Dev Agent

- Keep ESM-compatible TypeScript settings aligned with the repo's Node module model; do not switch runtime module semantics just to make migration easier.
- `packages/contracts` should define semantics, enums, unions, and DTOs; customer-facing copy belongs in `packages/i18n`.
- Prefer stable namespaced keys and typed interpolation metadata over free-form message strings.
- Repository validation should catch boundary violations early so future stories cannot regress into deep imports.

### Testing Requirements

- TypeScript validation across projects or references must fail when API/Web/shared package contracts drift.
- Tests must cover stable key-based blocked-state rendering across the shared API-Web boundary.
- Repository validation tests or policy checks must reject direct source-path imports, forbidden self-import patterns, and disallowed workspace-relative imports.

### Latest Technical Information

- Node's current TypeScript guidance favors `module: "nodenext"` for alignment with real Node ESM behavior rather than a generic module target. [Source: docs/planning-artifacts/research/technical-migrate-apps-api-apps-web-packages-tests-tu-javascript-sang-typescript-research-2026-07-02.md]
- TypeScript project references and `tsc -b` are the canonical monorepo mechanism for cross-project contract validation. [Source: docs/planning-artifacts/research/technical-migrate-apps-api-apps-web-packages-tests-tu-javascript-sang-typescript-research-2026-07-02.md]
- Shared error contracts should remain machine-readable while final customer-facing copy is rendered from typed dictionaries at the frontend edge. [Source: docs/planning-artifacts/research/technical-migrate-apps-api-apps-web-packages-tests-tu-javascript-sang-typescript-research-2026-07-02.md]

### References

- [Source: docs/project-context.md]
- [Source: docs/planning-artifacts/epics.md]
- [Source: docs/implementation-artifacts/typescript-i18n-migration-plan-2026-07-02.md]
- [Source: docs/implementation-artifacts/typescript-i18n-migration-plan-2026-07-02.md]
- [Source: docs/planning-artifacts/research/technical-migrate-apps-api-apps-web-packages-tests-tu-javascript-sang-typescript-research-2026-07-02.md]
- [Source: docs/architecture/adr/adr-022-typescript-first-npm-only-controlled-prototype.md]
- [Source: docs/implementation/backend-implementation.md]
- [Source: docs/product/prd.md]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Batch `bmad-create-story` run on 2026-07-02T22:01:26+07:00.
- Source packet: `docs/developer/story-handbook/1-10-typescript-contract-localization-and-import-boundary-governance.md`.
- Canonical title/source alignment: `docs/planning-artifacts/epics.md`.

### Completion Notes List

- Converted planning-derived developer packet into official execution artifact for dev cycle.
- Status set to `ready-for-dev` in `docs/implementation-artifacts/sprint-status.yaml`.
- Story retains planning authority references and scope guardrails for downstream `dev-story` work.
- Consolidated assessment, wizard, auth, RBAC, audit, outbox, GitHub integration, and health workflow values into typed public `@lcsp/contracts` exports.
- Replaced production business literals with shared constants/types across API and Web, including RBAC actions, lifecycle status/state values, decisions, roles, audit/outbox events, and repository connection status.
- Replaced assessment next-action prose with stable i18n keys and added typed English/Vietnamese workspace dictionaries.
- Added `check:contracts` regression enforcement and hardened import-policy scanning to ignore generated directories safely.
- Added shared-contract drift tests; API tests (217), Web contract tests, lint, typecheck, API build, and Web build pass.
- Adversarial review replaced regex import extraction with TypeScript AST coverage for multiline, dynamic, import-equals, import-type, and CommonJS module specifiers; scripts now consume only public package exports.
- Review fixes also added a shared frontend error wire envelope, prevented `NOT_STARTED` from being persisted as a wizard profile status, and fail closed when a workspace organization record is missing.

### File List

- docs/implementation-artifacts/1-10-typescript-contract-localization-and-import-boundary-governance.md
- docs/implementation-artifacts/sprint-status.yaml
- package.json
- packages/contracts/package.json
- packages/contracts/src/{assessment,audit,auth,github-integration,outbox,rbac,shared,wizard}/**/*.ts
- packages/i18n/src/types.ts
- packages/i18n/src/locales/{en,vi}/pages.ts
- apps/api/src/modules/{assessment,audit,auth-workspace,github-integration,health,wizard}/**/*.ts
- apps/api/src/platform/{outbox,rbac}/**/*.ts
- apps/web/src/features/workspace/**/*.ts
- apps/web/src/features/workspace/**/*.tsx
- apps/web/src/lib/api/{auth-client,workspace-client}.ts
- apps/web/src/app/api/auth/{mfa/verify-otp,sign-in}/route.ts
- apps/web/tests/mfa-verify.test.ts
- scripts/check-contract-literals.mjs
- scripts/check-import-policy.mjs
- scripts/import-policy-core.mjs
- tests/story-1-10.contracts.web.test.ts
- tests/story-1-4.web.test.ts

## Suggested Review Order

**Canonical contract model**

- Start here: assessment lifecycle and wizard states now have distinct typed authorities.
  [`statuses.ts:1`](../../packages/contracts/src/assessment/statuses.ts#L1)

- RBAC actions reuse domain action constants instead of duplicating wire literals.
  [`actions.ts:3`](../../packages/contracts/src/rbac/actions.ts#L3)

- Frontend error decoding is anchored to a shared compatibility wire envelope.
  [`problems.ts:71`](../../packages/contracts/src/auth/problems.ts#L71)

- Persisted wizard profiles exclude the response-only `NOT_STARTED` sentinel.
  [`wizard-profile.entity.ts:9`](../../apps/api/src/modules/wizard/domain/entities/wizard-profile.entity.ts#L9)

**API and localization boundary**

- Assessment detail emits stable next-action keys rather than customer-facing prose.
  [`get-assessment.handler.ts:88`](../../apps/api/src/modules/assessment/application/queries/get-assessment/get-assessment.handler.ts#L88)

- Missing workspace organizations now fail closed without exposing internal identifiers.
  [`get-workspace.handler.ts:87`](../../apps/api/src/modules/auth-workspace/application/queries/get-workspace/get-workspace.handler.ts#L87)

- Web keeps assessment lifecycle and wizard progress labels independently typed.
  [`status-labels.ts:25`](../../apps/web/src/features/workspace/config/status-labels.ts#L25)

- Typed locale dictionaries own the new wizard and next-action customer copy.
  [`pages.ts:67`](../../packages/i18n/src/locales/en/pages.ts#L67)

**Regression governance**

- TypeScript AST extraction covers every supported module-specifier syntax.
  [`import-policy-core.mjs:3`](../../scripts/import-policy-core.mjs#L3)

- Import policy self-checks parser coverage before scanning repository boundaries.
  [`check-import-policy.mjs:37`](../../scripts/check-import-policy.mjs#L37)

- Canonical literal scanning blocks repeated statuses, actions, decisions, and codes.
  [`check-contract-literals.mjs:52`](../../scripts/check-contract-literals.mjs#L52)

- Root lint composes import, literal, and cross-project type validation.
  [`package.json:9`](../../package.json#L9)

**Verification**

- Shared-value and compile-time wire assertions guard API/Web contract drift.
  [`story-1-10.contracts.web.test.ts:24`](../../tests/story-1-10.contracts.web.test.ts#L24)
