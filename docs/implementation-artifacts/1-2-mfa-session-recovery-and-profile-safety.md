---
baseline_commit: fad76ae81090f42c749c507960588b9b79cda385
---

# Story 1.2: MFA, Session, Recovery, and Profile Safety

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

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

## Tasks / Subtasks

- [x] Add MFA enrollment/challenge, recovery flow hooks and profile-safety actions on top of existing auth session boundary. (AC: 1)
- [x] Enforce session expiry/revocation checks and safe recovery actions on protected routes. (AC: 2)
- [x] Audit MFA, recovery and profile-safety mutations without persisting plaintext secrets. (AC: 3)
- [x] Story-specific subtasks
  - [x] Model MFA enrollment/challenge/recovery state separate from base session and keep membership/RBAC gate intact.
  - [x] Add OTP validation rules for invalid, expired, replayed and rate-limited attempts before workspace access is granted.
  - [x] Implement session expiry/revocation handling so protected routes fail closed with safe recovery/sign-in actions.
  - [x] Audit MFA/recovery/profile-safety success and failure paths without exposing secret values in UI, API, logs or audit records.

### Review Findings

- [x] [Review][Patch] MFA policy has no org/user "mandatory" flag — add a mandatory-MFA field/policy on organization or user and enforce it in sign-in/get-workspace so AC1's "MFA required" given-clause is actually evaluable [apps/api/prisma/schema.prisma; apps/api/src/modules/auth-workspace/application/commands/sign-in/sign-in.handler.ts; apps/api/src/modules/auth-workspace/application/queries/get-workspace/get-workspace.handler.ts]
- [x] [Review][Patch] Build the missing recovery challenge/token flow — task checklist marks "recovery flow hooks" done but only a `recoveryEmail` field exists; add a real recovery-request entity/token/endpoint [apps/api/src/modules/auth-workspace/application/commands/update-profile/update-profile.command.ts, update-profile.handler.ts; apps/api/prisma/schema.prisma]
- [x] [Review][Patch] Add cleanup for `AuthMfaOtpUsed` — prune rows older than the TOTP validity window so the replay-protection table doesn't grow unbounded [apps/api/src/modules/auth-workspace/application/ports/persistence/mfa.repository.ts; apps/api/prisma/schema.prisma]
- [x] [Review][Patch] Redact/allow-list `safeUserProjection`'s `membership.subjectAttributes` before returning it in client-facing API responses — keep only fields the client actually needs (e.g. UI role labels) [apps/api/src/modules/auth-workspace/application/services/auth-workspace/auth-workspace-support.service.ts]
- [x] [Review][Patch] MFA enrollment lets a valid-but-unverified session silently overwrite/replace an existing TOTP secret [apps/api/src/modules/auth-workspace/application/commands/enroll-mfa/enroll-mfa.handler.ts:245]
- [x] [Review][Patch] MFA-verified gate is enforced on get-workspace but not on update-profile (or other mutating routes) [apps/api/src/modules/auth-workspace/application/commands/update-profile/update-profile.handler.ts:824]
- [x] [Review][Patch] MFA secret encryption key silently falls back to a hardcoded placeholder when `MFA_ENCRYPTION_KEY` is unset [apps/api/src/modules/auth-workspace/infrastructure/security/security.utils.ts:3131]
- [x] [Review][Patch] Session token accepted as a GET query-string parameter on `/workspace`, leaking into logs/proxies/history [apps/api/src/modules/auth-workspace/presentation/http/auth-workspace.controller.ts]
- [x] [Review][Patch] Sign-in has a timing side-channel that lets attackers enumerate valid emails (early-return vs scrypt path) [apps/api/src/modules/auth-workspace/application/commands/sign-in/sign-in.handler.ts]
- [x] [Review][Patch] TOTP OTP comparison uses non-constant-time `===` instead of `timingSafeEqual` [apps/api/src/modules/auth-workspace/infrastructure/security/security.utils.ts:3115]
- [x] [Review][Patch] MFA/login rate-limit `failedCount` never resets after the lock naturally expires, re-locking on the very next failure [apps/api/src/modules/auth-workspace/domain/entities/mfa-rate-limit.entity.ts; apps/api/src/modules/auth-workspace/domain/entities/user.entity.ts]
- [x] [Review][Patch] Concurrent verify-mfa-otp requests can both consume the same OTP before `markUsed` lands (TOCTOU on replay protection) [apps/api/src/modules/auth-workspace/application/commands/verify-mfa-otp/verify-mfa-otp.handler.ts:959]
- [x] [Review][Patch] Concurrent invalid-OTP requests can exceed the rate limit before lockout persists (no atomic increment/transaction) [apps/api/src/modules/auth-workspace/application/commands/verify-mfa-otp/verify-mfa-otp.handler.ts:944]
- [x] [Review][Patch] `decryptMfaSecret` failure (e.g. corrupted ciphertext) is uncaught — bypasses rate-limiting and audit logging [apps/api/src/modules/auth-workspace/application/commands/verify-mfa-otp/verify-mfa-otp.handler.ts:968]
- [x] [Review][Patch] `update-profile` `recovery_email` has no email-format or max-length validation [apps/api/src/modules/auth-workspace/application/commands/update-profile/update-profile.handler.ts:851]
- [x] [Review][Patch] `register-approved-path` lacks a transaction — concurrent requests can double-consume an invite / raw unique-constraint 500 [apps/api/src/modules/auth-workspace/application/commands/register-approved-path/register-approved-path.handler.ts:409]
- [x] [Review][Patch] `buildTotpUri` labels the authenticator entry with the raw userId instead of the user's email [apps/api/src/modules/auth-workspace/application/commands/enroll-mfa/enroll-mfa.handler.ts]
- [x] [Review][Patch] `enAuth` i18n messages aren't type-checked with `satisfies AuthMessages` the way `viAuth` is [packages/i18n/src/locales/en/auth.ts]
- [x] [Review][Patch] `REQUIRED_ACTIONS.verifyMfa` isn't reflected in the `CommonMessages.actions` type [packages/i18n/src/types.ts]
- [x] [Review][Patch] Repeated 11-parameter constructor/DI wiring duplicated across handlers and 7x in `auth-workspace.module.ts` [apps/api/src/modules/auth-workspace/auth-workspace.module.ts]

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

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- Batch `bmad-create-story` run on 2026-07-02T22:01:26+07:00.
- Source packet: `docs/developer/story-handbook/1-2-mfa-session-recovery-and-profile-safety.md`.
- Implementation executed 2026-07-04 via `bmad-dev-story` skill.

### Completion Notes List

- Converted planning-derived developer packet into official execution artifact for dev cycle.
- Implemented TOTP RFC 6238 from scratch using `node:crypto` only (no external deps): base32, HMAC-SHA1, dynamic truncation, ±1 step window.
- MFA secret encrypted at rest with AES-256-GCM (random IV per record, auth tag checked on decrypt).
- Replay protection via `AuthMfaOtpUsed` composite PK `(userId, otpCode)`.
- Rate limiting: 5 consecutive failures → 15-min lock via `AuthMfaRateLimit`.
- Session `mfaVerifiedAt` is the MFA gate; workspace access requires it when enrollment exists.
- Profile update audit records field names only, never field values.
- All 29 e2e tests pass (20 existing + 9 new for AC1/AC2/AC3).
- TypeScript: 0 errors across all packages after Prisma generate and package declaration rebuild.

### File List

- packages/contracts/src/auth/codes.ts
- packages/contracts/src/auth/actions.ts
- packages/contracts/src/auth/problems.ts
- packages/contracts/src/auth/safe.ts
- packages/i18n/src/types.ts
- packages/i18n/src/locales/en/auth.ts
- packages/i18n/src/locales/vi/auth.ts
- apps/api/prisma/schema.prisma
- apps/api/src/modules/auth-workspace/domain/entities/session.entity.ts
- apps/api/src/modules/auth-workspace/domain/entities/user.entity.ts
- apps/api/src/modules/auth-workspace/domain/entities/mfa-enrollment.entity.ts
- apps/api/src/modules/auth-workspace/domain/entities/mfa-rate-limit.entity.ts
- apps/api/src/modules/auth-workspace/domain/models/auth-workspace.models.ts
- apps/api/src/modules/auth-workspace/application/ports/persistence/auth-workspace-repositories.ts
- apps/api/src/modules/auth-workspace/application/ports/persistence/mfa.repository.ts
- apps/api/src/modules/auth-workspace/application/contracts/auth-workspace/sign-in.contract.ts
- apps/api/src/modules/auth-workspace/application/contracts/auth-workspace/mfa.contract.ts
- apps/api/src/modules/auth-workspace/application/contracts/auth-workspace/profile.contract.ts
- apps/api/src/modules/auth-workspace/application/commands/enroll-mfa/enroll-mfa.command.ts
- apps/api/src/modules/auth-workspace/application/commands/enroll-mfa/enroll-mfa.handler.ts
- apps/api/src/modules/auth-workspace/application/commands/verify-mfa-otp/verify-mfa-otp.command.ts
- apps/api/src/modules/auth-workspace/application/commands/verify-mfa-otp/verify-mfa-otp.handler.ts
- apps/api/src/modules/auth-workspace/application/commands/update-profile/update-profile.command.ts
- apps/api/src/modules/auth-workspace/application/commands/update-profile/update-profile.handler.ts
- apps/api/src/modules/auth-workspace/application/commands/sign-in/sign-in.handler.ts
- apps/api/src/modules/auth-workspace/application/commands/register-approved-path/register-approved-path.handler.ts
- apps/api/src/modules/auth-workspace/application/commands/revoke-session/revoke-session.handler.ts
- apps/api/src/modules/auth-workspace/application/queries/get-workspace/get-workspace.handler.ts
- apps/api/src/modules/auth-workspace/application/services/auth-workspace/auth-workspace-support.service.ts
- apps/api/src/modules/auth-workspace/application/services/auth-workspace/auth-workspace.facade.ts
- apps/api/src/modules/auth-workspace/infrastructure/persistence/prisma-auth-workspace.mappers.ts
- apps/api/src/modules/auth-workspace/infrastructure/persistence/prisma-auth-workspace.repositories.ts
- apps/api/src/modules/auth-workspace/infrastructure/security/security.utils.ts
- apps/api/src/modules/auth-workspace/auth-workspace.module.ts
- apps/api/src/modules/auth-workspace/presentation/http/auth-workspace.controller.ts
- apps/api/test/auth-workspace.e2e-spec.ts
- apps/api/test/support/auth-workspace-test-helpers.ts
- docs/implementation-artifacts/1-2-mfa-session-recovery-and-profile-safety.md
- docs/implementation-artifacts/sprint-status.yaml
