# LCSP-347 Preparation diagnostics and controlled build handoff

Baseline: PR #456, `87c9ad352bbdd521f21d0a91b05bd33cd899af00`. Keep OPEN/Draft. No merge/deployment or paid model execution is authorized by these artifacts.

## Root cause and implementation

Preparation was below unrelated operational panels. The live hook replaced snapshots; older journal activity had no Admin paging route and the renderer showed only 100 projected rows. Missing counters could become zero and a transport-completed/unknown terminal boundary could settle running rows as completed. PREPARATION_FAILURE metadata was not projected. Localization scope selection could remain hidden on a different backlog page.

Fix: Preparation appears first, selects a running/queued run by default and exposes exact run/source/scope/contract/attempt plus canonical state and timestamps. Run history is bounded visually, without removing retry/resume/cancel or draft/result access. The summary distinguishes persisted frontier/draft/active-rule counters from observed stream counters. Missing data is NOT_REPORTED, counter conflicts are explicit, and observed usage is not described as reconciled billing. Costs remain NOT_AVAILABLE in this view. Stage evidence uses exact known events, canonical phase and backend activation; a completed file read does not certify entire discovery, and tool return does not authorize activation.

The existing durable journal paginator now supports an Admin-only Preparation route: `GET /admin/compliance-rule-sets/preparations/:preparationRunId/activity?limit=100&cursor=...`. It reuses the journal's createdAt/sequence/row-ID cursor and limit-plus-one behavior. Exact run identity, chronological ordering and event-ID deduplication govern live/replay/history merges. Older persisted pages are operator-requested; history boundaries and read failures are visible, and terminal-state changes refresh durable history. No SSE status changes canonical lifecycle. The Admin stream/history allowlist excludes model prompt/content/reasoning events, removes raw text and selects only bounded operational fields. Canonical journal rows remain unchanged.

Localization requires an explicit visible scope selection, clears it on page changes, and shows the exact selected scope ID in the review header. Existing cursor filters, immutable revision/hash bindings, current-page batch limits and itemized failures remain enforced.

## Verification boundaries and commands

All fixtures are isolated; none are production approval or legal gold. PostgreSQL fixtures use only `lcsp347_localization_test` on loopback 55438 with explicit safety checks. The snapshot inspection separately uses READ ONLY transactions and never applies migrations or writes canonical source/rule records.

- API: `pnpm --filter @lcsp/api exec cross-env NODE_OPTIONS=--experimental-vm-modules jest --config jest.config.ts --runInBand --runTestsByPath test/preparation-observability.integration.spec.ts src/platform/runtime-events/preparation-activity-view.spec.ts src/platform/runtime-events/assessment-runtime-event.service.spec.ts src/modules/assessment/presentation/http/workspace-runtime-events.controller.spec.ts src/app.routes.spec.ts` with `LCSP_TEST_LOCALIZATION_DATABASE_URL` pointing at the dedicated test database. Covers actual PostgreSQL journal paging across two clients, persisted history provenance, run isolation, malformed cursors, private telemetry removal, route/RBAC metadata and existing runtime controls.
- Web: `pnpm --dir apps/web exec tsx --tsconfig tsconfig.test.json --test tests/preparation-observability.test.tsx tests/preparation-activity-bff.test.ts tests/rule-set-preparation-activity.test.ts tests/rule-set-preparation-activity-component.test.ts tests/compliance-rule-sets-page.test.tsx tests/localization-pagination.test.tsx tests/rule-grouping-review.test.tsx`. Covers canonical terminal states, EN/VI, missing/malformed/conflicting counters, duplicate/out-of-order/foreign events, replay/reconnect, history paging, existing retry/cancel controls, scope A-to-B identity and explicit Unicode codepoint regression.
- Browser: `node apps/web/tests/browser/verify-reviewed-workflows.mjs`. Actual Chromium, production React/Tailwind components and isolated HTTP fixtures; mobile EN/VI Preparation, safe failure diagnostics, older history, reconnect and PAUSED/resume availability, plus existing localization/report/grouped-catalog regressions. Playwright/DevTools MCP were unavailable, so installed Playwright Chromium was used directly. This is not a deployed authenticated provider journey.
- Python: `uv run --frozen pytest -q tests/test_preparation_failure_diagnostics.py tests/test_rule_set_preparation_checkpointing.py tests/test_agent_run_budget.py tests/test_runtime_instruction_bundle.py tests/test_claim_files.py::test_files_factory_uses_native_todos_shared_budget_and_exclusive_child_tools tests/test_assessment_root_reliability.py::test_native_context_compaction_uses_existing_governed_summary_path`. Provider-free mechanics only, with isolated test approval fixtures where required.
- Equivalence package: `node scripts/prepare-lcsp347-instruction-review.mjs` verifies all 59 exact VI/EN source files/revisions/hashes against inventory and the PENDING compiler manifest. It deterministically exports full paired content, consumers, placeholders and independent-review checklists. All reviewer decisions remain PENDING_REVIEW with null identities/evidence. This exporter is not a trusted approval service.
- Read-only environment inspection: set `LCSP_PREFLIGHT_ENV_FILE` to a private existing local environment file, then run `pnpm --filter @lcsp/api exec tsx scripts/preflight-rule-set-preparation.ts`. The script accepts only loopback databases, runs a READ ONLY transaction, reports schema drift and source/run metadata without credentials or source bodies.
- Candidate legal excerpts: additionally set `LCSP_PREFLIGHT_SOURCE_VERSION_ID` to the exact selected source, then `pnpm --filter @lcsp/api exec tsx scripts/export-preparation-legal-review-candidates.ts`. All extracted text hashes must match stored immutable hashes. Lexical retrieval candidates do not establish legal actor, scope or expected classification. The exported package is explicitly unreviewed and never consumed as approved gold.

## Actual source selection and environment findings

Final focused receipts for this delivery: API 35/35 across five suites (including real disposable PostgreSQL and two independent Prisma clients), Web 47/47 with no skipped tests, Python 25/25 provider-free checks. Real Chromium exercised the production components with isolated HTTP fixtures, including mobile Preparation/history/EN-VI, reconnect, canonical PAUSED/resume availability, explicit scope selection and existing localized report/grouping flows; zero console errors were observed. This is not authenticated deployment acceptance. API and Web TypeScript, targeted ESLint, import policy, contract-literal policy, business documentation (zero missing/invalid) and diff whitespace checks succeeded. No schema migration is introduced by this delivery. No paid call or new Preparation run was started.

The user chose the source created most recently. Read-only inspection confirmed:

- Selected source `ea43540c-513e-4b76-969a-8415f06696f2`, `lcsp-360-official-eight-document-acceptance-corpus.v1`, created `2026-10-25T08:49:38.069Z`, ACTIVE in the local snapshot. Eight documents, 2,915 stored chunks. Activated identity: `structural-integrity:038052812015ac771ec774cee86c0bb2ab7836e8ec1f0876489dd3195b71b664` with matching structural retrieval-validation identity. Structural activation is not independent legal/gold approval.
- Older ACTIVE source `3edc9c2a-4900-4c5a-a4a0-660cf99639fc`, `vn-ai-official-2026.v3`, created `2026-10-23T10:55:43.824Z`.
- The inspected local snapshot has TWO ACTIVE sources and lacks `ComplianceRuleSetVersion.targetActivityScope` and `RuleSetPreparationRun.targetActivityScope`. It is not eligible to start this branch's build. No source was retired or changed and no migration was applied to that snapshot.
- Existing historical active Rule Set: `97004ff3-9240-4e37-8a94-9ade8832c00a`, digest `f06180635588eb5c026a3dc2e9d3c4da1c3c92853258bb8463f2b52c2478d1ce`. Its historic SUCCEEDED run is not evidence of a new build or current semantic quality. Its scope cannot be inferred from a missing column.

Prepare a separate current-schema diagnostic environment from the exact selected source export and referenced retrieval artifacts. Preserve source IDs, source bytes and activation evidence. Do not mutate the original snapshot or replace its active Rule Set. Verify single-source eligibility and current Agent Server/checkpoint/schema compatibility before dispatch.

## Runtime and credential preflight

Repository strict inventory is PASS: 59 source/candidate pairs and 19 framework surfaces. The candidate remains PENDING; approved pairs are 0/59. Manifest SHA-256 is `78c60051168044a332364a0f7d2e43f7acf06228d46a77469683826d910c67e2`. It is a candidate identity, NOT an authorized production pin.

The unpatched production loader was invoked outside pytest/monkeypatch and rejected with BUNDLE_MISSING before any inference. No authentically authorized diagnostic runtime bundle was found. Synthetic test approvals cannot authorize a paid diagnostic run or production release. Production cutover remains NOT_RUN/BLOCKED.

The repository routes both Preparation and Claim Author to Inception / mercury-3, context declaration 1,000,000 and per-call output ceiling 65,536; current fallback is Google / gemini-3.5-flash-lite. Provider availability/profile compatibility is NOT_PROVEN by reading configuration. Original-workspace Inception credential presence was detected without printing/copying its value; quota/validity is untested. Native Anthropic credential was absent. No key is needed in chat. Provision replacement credentials through an approved process secret store or an untracked private file outside Git using the launcher's supported environment injection. A Claude key requires an explicitly authorized Anthropic/model profile and distinct experiment; it cannot silently replace an Inception key or preserve identical-model comparison claims.

## Budget proposal - not authorization

Propose one bounded DEVELOPMENT_ONLY pilot on the selected source, pinned to Inception / mercury-3 only:

| Limit                      | Proposed ceiling |
| -------------------------- | ---------------: |
| Spend                      |        USD 10.00 |
| Input tokens               |          200,000 |
| Aggregate output tokens    |           65,536 |
| Physical provider attempts |               12 |
| Logical calls              |               12 |
| Build starts               |                1 |
| Wall-clock budget          |    1,200 seconds |

This is a spending ceiling proposal, not a provider price quote, cost estimate or guarantee of finishing the corpus. The existing per-call 65,536 output ceiling is retained to avoid reintroducing known packet truncation. No automatic fallback/retry build/resume is authorized. A different model or provider requires a separately identified experiment.

Before dispatch, freeze the actual diagnostic profile, source, approved bundle and measured admission policy. Reuse the existing physical-attempt/token admission ledger across child calls, compaction and retries; no new spending framework is needed. `LCSP_RSP_MAX_MODEL_CALLS=12` and `LCSP_RSP_MAX_INPUT_TOKENS=200000` alone are NOT a USD or aggregate-output cap. Exact pricing-backed billing admission or a verified provider-side hard spend cap must enforce USD 10; otherwise do not dispatch. Unknown pricing cannot be converted into invented cost evidence. Existing quota pause flushes committed work and establishes PAUSED; paid resume requires renewed explicit authorization and preserved prior usage receipts, not a free budget reset.

Stop before any drift, missing approval/budget evidence, exceeded cap/deadline, human scope-review requirement or uncertain physical attempt. Record every physical attempt (including failures), response IDs, source/model/bundle hashes, token categories and actual provider/billing reconciliation. A partial paused pilot cannot prove complete legal quality.

The user has NOT approved this budget. Do not run paid calls until that approval AND the runtime/source/environment gates are satisfied.

## Legal review and acceptance still required

The independent source-candidate export provides exact version/document/chunk/locator/text/hash evidence for all seven reported-case search groups, plus developer-context candidates. These are lexical candidates, not verified mappings or gold. Actor, action, trigger, stage, expected disposition, independent reviewer and gold revision/hash remain unresolved. Positive DEVELOPMENT, mixed and HITL controls still require independent legal establishment. The existing evaluator's review preflight correctly reports BLOCKED_EXTERNAL_REVIEW_INPUT; approved gold is 0/7 and no live model comparison ran.

The 59-pair review package includes actual VI/EN content and exact hashes, not approval. Independent equivalence reviewers must approve the bytes, and release authority must publish/pin an authentic manifest. The Coding Agent did neither.

Fresh paid Preparation, real-provider resume/subagents/compaction/post-compaction, full authenticated customer journey, provider fidelity and deployment-specific restart/worker/billing reconciliation remain NOT_RUN. Offline mechanics and fixture browser tests are not substituted for these gates. No provider cost or semantic accuracy result is asserted.
