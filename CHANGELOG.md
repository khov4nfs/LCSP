# Changelog

Append new changes under `## Unreleased` only. Keep the newest entry first and
do not rewrite older entries unless correcting a factual error.

## Unreleased

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
