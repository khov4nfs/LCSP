# Changelog

Append new changes under `## Unreleased` only. Keep the newest entry first and
do not rewrite older entries unless correcting a factual error.

## Unreleased

### 2026-08-25 - Remove Legacy User Table

#### Removed

- Removed the legacy standalone `User` Prisma model/table and its unused `users` API module.
- Removed the old `/users` CQRS controller, handlers, repository, DTOs, domain entity, value objects, and bootstrap/export wiring.
- Removed test cleanup against `prisma.user` and the legacy user-controller DI test.

#### Changed

- Kept the active account flow on `AuthUser`, `AuthOrganization`, `AuthMembership`, and `AuthSession`.

#### Migration

- Added `20260825093000_drop_legacy_user` to drop the obsolete `"User"` table.

#### Verification

- `rtk pnpm --filter @lcsp/api exec prisma format --schema prisma/schema.prisma`
- `rtk pnpm run typecheck`
- `rtk pnpm --filter @lcsp/api build`
- `rtk pnpm --filter @lcsp/api test:e2e -- --runInBand --runTestsByPath test/app.e2e-spec.ts test/sign-up.e2e-spec.ts test/auth-workspace.e2e-spec.ts`
- `rtk pnpm run check:imports`
- `git diff --check`

#### Known Remaining Work

- `rtk pnpm run check:contracts` still reports the existing canonical literal audit failures in classification, evidence, legal-rule-catalog, scan, outbox, PBAC, runtime-event, and related tests/services outside this table cleanup.

### 2026-08-25 - Retire Developer Collaboration Flow

#### Removed

- Removed Developer invitation, invitation acceptance, membership revocation, task workspace, navigation, BFF routes, API handlers, client hooks, mock fixtures, and related tests.
- Removed the `AuthInvitation` Prisma model/table and `AuthInvitationState` enum with migration `20260825090000_drop_auth_invitation`.
- Removed active Developer PBAC role/action contracts, including `Developer`, `invite:developer`, and `membership:revoke`.

#### Changed

- Kept self-signup and Manager-owned workspace flow as the active account path.
- Updated assessment, readiness, repository snapshot, and mock workspace paths to fail closed for non-Manager subjects instead of using scoped Developer behavior.
- Updated current docs to mark the Developer invitation/task flow as retired and prevent reintroducing it through task docs.

#### Verification

- `rtk pnpm run typecheck`
- `rtk pnpm run test:web`
- `rtk pnpm --filter @lcsp/api test -- --runInBand --runTestsByPath src/modules/assessment/application/queries/list-assessments/list-assessments.handler.spec.ts src/modules/assessment/application/queries/get-assessment/get-assessment.handler.spec.ts src/modules/github-integration/application/commands/pin-snapshot/pin-snapshot.handler.spec.ts src/modules/scan/application/queries/get-scan-job/get-scan-job.handler.spec.ts src/modules/wizard/application/queries/get-readiness/get-readiness.handler.spec.ts src/platform/pbac/pbac.guard.spec.ts src/platform/pbac/pbac-evaluator.service.spec.ts src/platform/pbac/pbac-context.loader.spec.ts src/modules/auth-workspace/application/commands/oauth-callback/oauth-callback.handler.spec.ts`
- `rtk pnpm --filter @lcsp/api test:e2e -- --runInBand --runTestsByPath test/auth-workspace.e2e-spec.ts test/sign-up.e2e-spec.ts test/assessment-list.e2e-spec.ts test/assessment-get.e2e-spec.ts test/scan-job-status.e2e-spec.ts test/get-technical-evidence.e2e-spec.ts test/document-status.e2e-spec.ts test/resolve-conflict.e2e-spec.ts test/manager-golden-path.e2e-spec.ts`
- `rtk pnpm --filter @lcsp/api build`
- `rtk pnpm --filter @lcsp/web lint`
- `rtk pnpm --filter @lcsp/web build`
- `rtk pnpm run check:imports`
- `rtk pnpm run check:agentic-tools`
- `git diff --check`

#### Compatibility Note

- `AUTH_INVITATION` remains in audit resource enums/mappers for historical audit records only; it is no longer backed by an active invitation table or product flow.

#### Known Remaining Work

- `rtk pnpm run check:contracts` now reaches the existing canonical literal audit and still reports broader literal policy violations in classification, evidence, legal-rule-catalog, scan, outbox, PBAC and runtime-event tests/services outside the Developer flow removal.

### 2026-08-25 - Remove GitHub OAuth Login

#### Removed

- Removed GitHub classic OAuth login from auth-workspace provider registration, config, sign-in UI, and account-link UI.

#### Changed

- Kept OAuth login on Google OIDC only when configured.
- Updated BFF OAuth allowlists so `provider=github` is rejected instead of redirected.
- Updated auth/web/config docs to keep GitHub App repository authorization separate from user login.

#### Verification

- `rtk pnpm --filter @lcsp/api test -- --runTestsByPath src/config/config.spec.ts src/modules/auth-workspace/application/commands/oauth-start/oauth-start.handler.spec.ts src/modules/auth-workspace/application/commands/oauth-callback/oauth-callback.handler.spec.ts --runInBand`
- `rtk pnpm --filter @lcsp/api test:e2e -- --runInBand --runTestsByPath test/oauth-login.e2e-spec.ts`
- `rtk pnpm run typecheck`
- `rtk pnpm run test:web`
- `rtk pnpm --filter @lcsp/api build`
- `rtk pnpm --filter @lcsp/web lint`
- `rtk pnpm --filter @lcsp/web build`
- `rtk pnpm run check:imports`
- `rtk pnpm run check:agentic-tools`
- `git diff --check`

#### Known Remaining Work

- `rtk pnpm --filter @lcsp/api lint` still reports the pre-existing `require-await` error in `apps/api/src/modules/wizard/presentation/http/wizard.controller.ts` plus existing legal-rule-catalog warnings.
- `rtk pnpm run check:contracts` still reports broader pre-existing canonical literal policy violations outside the OAuth login removal.

### 2026-08-25 - Self Sign-Up Account Flow

#### Added

- Added public API endpoint `POST /auth/sign-up` for account creation without invitation acceptance.
- Added transactional self-signup handler that creates the user, organization workspace, Manager PBAC policy, active membership, scoped session, and auth audit event together.
- Added web BFF route `/api/auth/sign-up`, `/sign-up` page, signup form schema/config, i18n copy, and sign-in page link to account creation.
- Added `SIGN_UP_ERROR_CODES` and auth signup audit event constants in shared contracts.

#### Changed

- Exported signup schema/client helpers from `@lcsp/web`.
- Updated auth/web implementation docs and web component index for the signup path.

#### Verification

- `rtk pnpm --filter @lcsp/api test:e2e -- --runInBand --runTestsByPath test/sign-up.e2e-spec.ts`
- `rtk pnpm run typecheck`
- `rtk pnpm run test:web`
- `rtk pnpm --filter @lcsp/api build`
- `rtk pnpm --filter @lcsp/web build`
- `rtk pnpm run check:imports`
- `rtk pnpm run check:agentic-tools`
- `git diff --check`

#### Known Remaining Work

- `rtk pnpm run check:contracts` still reports broader pre-existing canonical literal policy violations outside the signup change.
- `rtk pnpm --filter @lcsp/api lint` still reports a pre-existing `require-await` error in `apps/api/src/modules/wizard/presentation/http/wizard.controller.ts` and warnings in legal-rule-catalog specs.

### 2026-08-25 - GitHub PR Milestone Mapping

#### Changed

- Updated GitHub milestone descriptions for `Release` and `Core Backend`.
- Mapped all 270 pull requests across the milestone taxonomy:
  - `Landing & Docs`
  - `Release`
  - `Core Backend`
  - `Tools & Deep Agents`
  - `Web App & UI`

#### Verification

- Refreshed all PR milestone metadata from GitHub after update.
- Verified final mapping mismatch count: `0`.

### 2026-08-25 - EngineeringRule Runtime Cleanup

#### Changed

- Renamed the managed runtime CI surface from Sprint-6/AO terminology to EngineeringRule terminology.
  - Workflow: `EngineeringRule managed runtime`
  - Job: `EngineeringRule runtime integrity`
  - Job: `Worker EngineeringRule runtime`
  - Runtime checker log tag: `[engineering-rule-runtime]`
- Renamed active Deep Agents runtime symbols away from stale Sprint-6/AO labels.
  - `ENGINEERING_RULE_AGENTIC_CAPABILITIES`
  - `ENGINEERING_RULE_AGENTIC_TOOL_BINDINGS`
  - `build_engineering_rule_agentic_registry`
  - `SCANNER_TOOL_BINDINGS`
  - `LEGAL_CORPUS_TOOL_BINDINGS`
- Renamed contract wrapper files and constants to functional names for wizard, gap requirements, admin source catalog, and PBAC gap requirements.
- Updated reviewed legal corpus recovery labels and generated version prefix from `VN-LEGAL-AO6` to `VN-LEGAL-CORPUS`.
- Corrected current documentation references for contract and Deep Agents runtime paths.

#### Removed

- Removed legacy verified-profile and legal-rule-match callback test coverage that targeted retired handlers.
- Removed stale runtime input expectations for retired legal-rule-match callback flow.
- Removed retired managed invocation boundaries for the legacy classification proposal path.

#### Fixed

- Fixed the managed runtime workflow path trigger to watch `deepagents/tools/common/capabilities/agentic_evidence/**`.
- Fixed Deep Agents tests and runtime manifest expectations after retiring obsolete CQRS tools.
- Fixed AI usage smoke expectations so they assert the current structured claim/provenance flow.

#### Verification

- `rtk node scripts/check-agentic-tool-runtime.mjs`
- `rtk uv run --directory deepagents --extra dev python -m pytest -q`
- `rtk uv run --directory deepagents --extra dev python -m pytest tests/agentic_evidence tests/test_legal_corpus_recovery_driver.py -q`
- `rtk pnpm run test:web`
- `rtk pnpm --filter @lcsp/api test:e2e`
- `rtk pnpm --filter @lcsp/api build`
- `rtk pnpm --filter @lcsp/api test -- --runTestsByPath src/modules/legal-rule-catalog/application/services/rule-catalog-version.service.spec.ts --runInBand`
- `rtk pnpm run typecheck`
- `git diff --check`

#### Known Remaining Work

- `rtk pnpm run check:contracts` still reports broader pre-existing canonical literal policy violations across API specs/services. These are outside the CI/runtime rename cleanup.
