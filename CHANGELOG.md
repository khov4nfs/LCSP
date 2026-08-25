# Changelog

Append new changes under `## Unreleased` only. Keep the newest entry first and
do not rewrite older entries unless correcting a factual error.

## Unreleased

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
