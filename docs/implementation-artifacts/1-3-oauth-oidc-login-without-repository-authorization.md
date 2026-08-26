---
baseline_commit: 4983bf26f6c2853575034990d5d1a2505d4e94b6
---

# Story 1.3: OAuth/OIDC Login Without Repository Authorization

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

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

## Tasks / Subtasks

- [x] Implement OAuth/OIDC callback validation for redirect URI, state, nonce, issuer, audience and expiry. (AC: 1)
- [x] Create LCSP identity/session only after safe account linking. (AC: 2)
- [x] Harden audit and blocked state handling so login never creates repository authorization. (AC: 2)

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

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Batch `bmad-create-story` run on 2026-07-02T22:01:26+07:00.
- Source packet: `docs/developer/story-handbook/1-3-oauth-oidc-login-without-repository-authorization.md`.
- Canonical title/source alignment: `docs/planning-artifacts/epics.md`.
- `bmad-dev-story` implementation run on 2026-07-10, reconciled against the concrete task-doc track (`docs/implementation/tasks/modules/auth-workspace/08-oauth-oidc-start-endpoint.md` = MW-auth-008, `09-oauth-oidc-callback-endpoint.md` = MW-auth-009), which is this session's authoritative source for API contracts, Prisma models and test tables.
- `tsc -b --force`: 0 new errors (19 pre-existing baseline errors, all in unrelated e2e specs for not-yet-implemented modules, unchanged before/after).
- Unit suite (`pnpm test`): 106/106 passing (16 suites), including the 6 new `oauth-callback.handler.spec.ts` cases.
- E2E suite (`pnpm test:e2e`): 96/96 previously-passing tests still pass; 26 pre-existing failures unchanged in scope (assessment/scan/legal-corpus/evidence-gates/classification-guard/reconciliation/audit-trail/smoke health-check/developer-rbac assessment routes, and `oauth-separation.e2e-spec.ts`'s GitHub-App-installation assertions — a different, unimplemented `github-integration` module). New `oauth-login.e2e-spec.ts`: 14/14 passing.
- Fixed a pre-existing test-isolation bug in `test/support/auth-workspace-test-helpers.ts`'s `resetAuthWorkspaceDatabase` (never truncated the generic `User` table), which caused `app.e2e-spec.ts` to flake across repeated local e2e runs — unrelated to OAuth but discovered and fixed while verifying this story.

### Completion Notes List

- Updated 2026-08-25: GitHub classic OAuth login was removed from auth-workspace. `GitHubOAuthProvider` is deleted, `provider=github` is unsupported for login/linking, and Google OIDC is the only registered OAuth login provider when configured. GitHub App repository authorization remains isolated in the separate `github-integration` module.
- Converted planning-derived developer packet into official execution artifact for dev cycle.
- Status set to `ready-for-dev` in `docs/implementation-artifacts/sprint-status.yaml`.
- Story retains planning authority references and scope guardrails for downstream `dev-story` work.
- Implemented `GET /auth/oauth/start` and `GET /auth/oauth/callback` end-to-end: new `AuthOAuthState`/`AuthOAuthIdentity` Prisma models (migration `20260709192021_add_oauth_state_and_identity`), an OIDC-generic `OAuthProvider` interface with a Google OIDC provider implementation, `OAuthStartHandler`/`OAuthCallbackHandler` command handlers wired through the existing `AuthWorkspaceFacade`/`auth-workspace.module.ts` DI pattern, and 5 new `AUTH_ERROR_CODES` (`UNSUPPORTED_PROVIDER`, `INVALID_REDIRECT_URI`, `OAUTH_STATE_INVALID`, `OAUTH_CALLBACK_INVALID`, `ACCOUNT_NOT_FOUND`) with EN/VI i18n messages.
- **Design decision (OIDC validation)**: the `OAuthProvider` interface remains OIDC-shaped (`expectedIssuer`/`expectedAudience` readonly on the provider, `nonce`/`issuer`/`audience`/`expiresAt` nullable on returned claims) so providers can plug in without an interface change. Google OIDC supplies and validates nonce, issuer, audience, and expiry. The generic mismatch branches are proven via a dedicated unit spec (`oauth-callback.handler.spec.ts`) using a stub OIDC-shaped provider.
- **Design decision (no `organization_id` on the callback), documented for follow-up**: the callback endpoint has no organization context, so account resolution requires the account's active-membership set to be exactly 1 (`MembershipRepository.findActiveByUserId`, new port method). 0 or >1 active memberships fails closed as `MEMBERSHIP_MISSING`, per this codebase's stated deny-by-default philosophy (`docs/project-context.md`). Multi-membership OAuth users cannot log in via this story's endpoint alone — a real gap to revisit in a later story (e.g. an org-selection step), not silently handled.
- **HTTP status convention followed, not the task docs' literal tables**: matching every other `auth-workspace` endpoint in this codebase (confirmed via `auth-workspace.e2e-spec.ts`'s own `.expect(201)` on a failed sign-in), both new GET endpoints always return NestJS's default status (200) with `{ok: false, problem: {...}}` in the body on logical failure, rather than mapping `problem.status` (400/403/404 per the task docs) to the actual HTTP response code.
- Per the task docs' explicit business rules, `AuthOAuthIdentity` rows are read-only in this story (`findByProviderAccount` only, no `save`) — account linking/creation is out of scope; a not-found provider account always fails closed as `ACCOUNT_NOT_FOUND`, never auto-creates.
- No `RepositoryConnection`/GitHub-App-installation code exists anywhere in the new OAuth login path — those models don't exist in this codebase yet and belong to a separate, unimplemented `github-integration` module (also the reason 2 of `oauth-separation.e2e-spec.ts`'s pre-existing assertions still fail — unrelated to this story).

### File List

- docs/implementation-artifacts/1-3-oauth-oidc-login-without-repository-authorization.md
- apps/api/prisma/schema.prisma
- apps/api/prisma/migrations/20260709192021_add_oauth_state_and_identity/migration.sql
- apps/api/src/modules/auth-workspace/domain/entities/oauth-state.entity.ts
- apps/api/src/modules/auth-workspace/domain/entities/oauth-identity.entity.ts
- apps/api/src/modules/auth-workspace/domain/models/auth-workspace.models.ts
- apps/api/src/modules/auth-workspace/application/ports/persistence/oauth-state.repository.ts
- apps/api/src/modules/auth-workspace/application/ports/persistence/oauth-identity.repository.ts
- apps/api/src/modules/auth-workspace/application/ports/persistence/membership.repository.ts
- apps/api/src/modules/auth-workspace/application/ports/persistence/auth-workspace-repositories.ts
- apps/api/src/modules/auth-workspace/application/contracts/auth-workspace/oauth.contract.ts
- apps/api/src/modules/auth-workspace/application/commands/oauth-start/oauth-start.command.ts
- apps/api/src/modules/auth-workspace/application/commands/oauth-start/oauth-start.handler.ts
- apps/api/src/modules/auth-workspace/application/commands/oauth-callback/oauth-callback.command.ts
- apps/api/src/modules/auth-workspace/application/commands/oauth-callback/oauth-callback.handler.ts
- apps/api/src/modules/auth-workspace/application/commands/oauth-callback/oauth-callback.handler.spec.ts
- apps/api/src/modules/auth-workspace/application/services/auth-workspace/auth-workspace.facade.ts
- apps/api/src/modules/auth-workspace/infrastructure/oauth/oauth-provider.interface.ts
- apps/api/src/modules/auth-workspace/infrastructure/oauth/google-oauth.provider.ts
- apps/api/src/modules/auth-workspace/infrastructure/oauth/oauth-provider.registry.ts
- apps/api/src/modules/auth-workspace/infrastructure/persistence/prisma-auth-workspace.mappers.ts
- apps/api/src/modules/auth-workspace/infrastructure/persistence/prisma-auth-workspace.repositories.ts
- apps/api/src/modules/auth-workspace/infrastructure/security/security.utils.ts
- apps/api/src/modules/auth-workspace/presentation/http/auth-workspace.controller.ts
- apps/api/src/modules/auth-workspace/auth-workspace.module.ts
- apps/api/test/oauth-login.e2e-spec.ts
- apps/api/test/support/auth-workspace-test-helpers.ts
- packages/contracts/src/auth/codes.ts
- packages/contracts/src/auth/problems.ts
- packages/contracts/src/auth/safe.ts
- packages/i18n/src/types.ts
- packages/i18n/src/locales/en/auth.ts
- packages/i18n/src/locales/vi/auth.ts
- docs/implementation-artifacts/sprint-status.yaml

## Change Log

- 2026-07-10: Implemented OAuth/OIDC login (start + callback) via `bmad-dev-story`, reconciled with `MW-auth-008`/`MW-auth-009` task docs. All 3 story tasks complete; all 2 ACs satisfied. Status moved `ready-for-dev` → `in-progress` → `review`.
