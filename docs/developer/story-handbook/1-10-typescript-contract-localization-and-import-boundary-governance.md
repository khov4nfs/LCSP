# Story 1.10 Developer Packet

Status: ready-for-dev

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
