# LCSP Single-Agent Migration Progress

## Current position

2026-10-06: continuing consolidated W1 integration acceptance in `/home/khovan/Workplaces/LCSP`. Branch `develop`; HEAD `c6ce6d954f02a755beffe3f62df2f5cc3e8bfa24`. Intentionally dirty; 67 tracked changed paths and 75 untracked files before this report. No implementation restarted.

## Current authorized Wave

W2 (LCSP-352) authorized by user `continue W2` on 2026-10-06 after W1 GATE PASS. W3+ remain unauthorized.

## Current Gate

W1 holistic integration: PASS (see "W1 browser acceptance" below).

## Jira Wave

LCSP-351 — Close canonical foundation integration gate. No Jira mutation performed.

## Architecture authority

Read the complete `docs/architecture/LCSP_AGENTIC_MIGRATION_HANDOFF.md` and `reports/architecture-freeze-migration-manifest.md`; inspected the W1 gate and coordinator ledger. Freeze wins for architecture; current source/executable evidence wins for implementation. Historical worker state is not authority. User correction permits direct repository tooling and makes SourceNerve availability irrelevant to the gate.

## Preserved user WIP

All nine original files in handoff §2 were independently SHA256-checked against its recorded hashes: 9/9 PASS. No overlap or modification. Hash check used Python hashlib over the nine handoff table paths. Original WIP intent concerns legacy need-ID/Interview/resume behavior and the architecture plan.

## Completed since handoff

- Repository identity/dirty inventory verified; `git diff --check` exit 0.
- Mandatory architecture/context recovery completed.
- Playwright MCP `browser_tabs(action=list)` succeeded and returned `about:blank`.
- SourceNerve local MCP snapshot succeeded during initial harness discovery. User subsequently directed direct repository work; no further SourceNerve discovery or invocation is required.

## Current changed files

Consolidated dirty source/tests/fixtures/reports remain intact. This session has added only `reports/agentic-single-agent-progress.md` so far. No branch/index/commit/push/PR/deployment action.

## Tests actually executed

No W1 product test executed yet in this session. WIP 9/9 SHA256 comparison and `git diff --check` passed. Historical suite results are not current verification.

## Gate evidence

Inherited evidence: `reports/agentic-w1-integration-gate.md` remains FAIL. No fresh Gate PASS claimed.

## Known failures

Inherited full-Web failures concerned stale control-target usage and obsolete fabricated preview labels; repair is present but requires current verification. Initial SourceNerve desktop/daemon help attempts failed; these are irrelevant environment probes, not LCSP failures or gate blockers.

## Active blockers

None established. Local isolated PostgreSQL/API/Web prerequisites must be verified and provisioned for live checks; ordinary setup is authorized.

## Browser/MCP capability status

Direct Playwright MCP is exposed and callable. Direct Codebase Memory discovery tools are exposed; direct list-project/index-status/coverage tools are not exposed in the current catalog. A separate harness extension catalog reported only an unrelated `ar-art` project; this is not canonical LCSP index proof. Verify/reindex canonical root using directly available Codebase Memory tools. Chrome DevTools tools are exposed, operational status not yet tested. No browser acceptance executed.

## Legacy paths removed

No removal this session. Handoff records three already removed Web wrappers/components; their absence/callers require current verification.

## Legacy paths remaining

Scanner, Interview, per-rule orchestration, legal approval/cache/recovery, targeted reanalysis, old stage/readiness projections remain deferred to their frozen replacement/archive gates. W1 does not authorize their broad deletion.

## Exact next action

Use direct Codebase Memory and the existing graphify graph to discover the W1 coordinator/projection/read/control/Web seams, refresh canonical indexing as needed, inspect actual source and current diff, rebuild runtime packages, then execute W1 type/policy/focused/full suites and isolated migrated DB/read/browser checks. Repair observed failures inside W1; persist exact results; stop at W1 PASS. Do not enter W2.

## W1 gate execution log (2026-10-06, this session; logs in /tmp/w1/)

| Check | Result |
|---|---|
| `pnpm run build:runtime-packages` | PASS |
| contracts / API / Web `tsc --noEmit` | PASS x3 (empty logs, exit 0) |
| `check:imports`, `check:contracts`, `check:agentic-tools` | PASS x3 |
| `tsx --test tests/agentic-runtime-contracts.test.ts tests/assessment-root-eval-fixtures.test.ts` | 6/6 PASS |
| Full Web `pnpm run test:web:run` (4GiB) | 595/595 PASS, 0 fail/skip/cancel, exit 0 (closes the two prior gate failures: stale native usage target + preview labels) |
| Full API jest --runInBand (4GiB), DATABASE_URL unset | 179 suites pass, 8 FAIL / 38 tests: all billing/payment integration suites, cause P1001 (default DB 127.0.0.1:55432 absent). ENVIRONMENT failure, not application. |
| Full API jest, DATABASE_URL=55445/lcsp_w1_full_suite (disposable, container lcsp-w1-full-suite-20261006) | 187 suites pass, 7 skipped; 1222 tests pass, 22 skipped, 1 todo, 0 fail (summary printed; wrapper API_EXIT line lost when session restarted) |
| `node tests/assessment-lifecycle-migrated-db.mjs` (55437) | PASS: 16 constraint assertions, ordered migrate deploy, lifecycle protocol, 5 runtime-control tests |
| `node tests/assessment-canonical-persistence.mjs /tmp/w1/persistence-expand` | PASS: 152 assertions, clean+populated upgrade; whole-schema drift exit 2 identical to V1 baseline (NOT a whole-schema PASS) |
| Read-isolation e2e (55441, 96 migrations applied) | 3/3 PASS |
| Static: no `lifecycleState:`/`deriveStageLifecycles` in apps/web/src; no legacy vocabulary in agentic-runtime.ts; no TS enums (zod enums over constants only); deleted wrappers have zero callers (only ignored apps/web/dist artifacts) | PASS |

Environment note: `lcsp_w1_full_suite` DB has 56 tables but no `_prisma_migrations` (P3005 on migrate deploy); suites passed against it regardless.

## W1 browser acceptance (Playwright MCP, headless, 2026-10-06)

Services: API `node dist/src/main.js` PORT=3311 NODE_ENV=test (built from canonical source) against disposable `lcsp_w14_browser` @127.0.0.1:55439 (96 migrations) and owned broker lcsp-w1-browser-broker-20261006 @55672 (no fogewise services touched); Next dev 3310 with LCSP_API_BASE_URL=http://127.0.0.1:3311, mock flags false. Listeners/readiness verified before navigation (sign-in HTTP 200). Both processes stopped afterwards; ports 3310/3311 free.

| Check | Result |
|---|---|
| Real sign-in (synthetic owner) -> /workspace | PASS; /api/auth/profile, /api/workspace, /api/assessments all 200 |
| Dashboard: canonical-present assessment | "Paused"; V1/null assessment "Assessment state is unavailable." (raw V1 status WIZARD_IN_PROGRESS NOT surfaced as state) |
| Assessment page (present) | Lifecycle = Paused, Execution = Paused; fixture's conflicting RUNNING activity/tool event did not override |
| Assessment page (null) | "Assessment state is unavailable." |
| SSE `/api/workspace/runtime-events` (BFF->API) | canonical_assessments: present = lifecycle PAUSED rev 7, runtime executionState PAUSED threadId 4a7b2e6d..., eventSequence 1; null assessment = lifecycle null, runtime null. Matches UI exactly. `stage_lifecycles: []`. |
| Pure reads / no UI writer | Network log for both pages: GET only (no POST/PUT/PATCH). DB after browsing unchanged: Assessment PAUSED rev 7 / null row, AssessmentRuntime PAUSED seq 1, AssessmentEvent count 0 |
| Console | Errors only HTTP 404s: (a) my own mistaken URL /workspace/assessments/<id>; (b) /api/assessments/<id>/evidence-graph/overview (fixture has no repository; known historical limit). No JS exceptions. |

Screenshot: reports/w1-browser-canonical-null-unavailable.png. Transient `.playwright-mcp/` output deleted.

Limits (not claimed): no clean Stop/Continue acceptance (known fixture 404/409); no provider/broker/Root execution (broker is idle); Chrome DevTools not used; whole-schema drift exit 2 is the V1 baseline, not conformance.

## Current Gate

W1 holistic integration: PASS (2026-10-06). Scope is the Freeze §11 W1 gate; Freeze §12 production acceptance remains NOT PROVEN.

## Exact next action

Wait for user review. On `continue`: re-read handoff, Freeze (W2 sections), this file; verify `git status`/`git diff --check`; begin W2 (LCSP-352) by freezing the portfolio submit/read/provenance contract from reports/w2-portfolio-*-preparation.md and real legal-rule-catalog DTOs/FKs. Do not begin W2 before then.


## W2 log (LCSP-352 — single legal portfolio vertical)

Start: 2026-10-06. Repo: branch `develop` @5be71e0e8 (PR #358 W1 merged by user; clean; origin/develop 0/0). Work stays UNCOMMITTED on develop (no branch/commit/push authority for W2).
Context recovered: handoff (full), Freeze (full), W2 persistence-boundary + submit-interface preparation reports (full), W1 PASS durably recorded above.

Plan (serialized, per Freeze §11 W2 / handoff §9):
1. W2.1 contract — `packages/contracts/src/legal-portfolio/`: constants-derived values (no enums/literal unions), strict submit packet (agent meaning only), server result/failure codes (fixture codes: UNRESOLVED_SOURCE_REFERENCE, STALE_SOURCE_HASH, REPEALED_SOURCE_REFERENCE, DUPLICATE_RULE_ID, ORPHAN_CONTEXT_RELATION, INCOMPLETE_SOURCE_COVERAGE, MIXED_CORPUS_VERSION), reuse ALCS/AES from agentic-runtime.
2. W2.2 persistence — expand-only Prisma models + ordered migration: LegalPreparationRun, LegalPortfolioVersion (partial unique ACTIVE), LegalPortfolioRule, EngineeringRule, LegalRuleContextRelation, LegalRuleProvenance, LegalPortfolioActivationRecord. No V1 FK drop/repoint/backfill. Migrated-PG tests.
3. W2.3 API — one worker-authenticated submit -> integrity-validate -> atomic-activate service + read ACTIVE portfolio reader; idempotency in-tx, advisory lock, failure preserves prior ACTIVE; real-PG concurrency/rollback tests; reuse CitationLocatorValidatorService, lock/outbox/audit pattern.
4. W2.4 agent — separate `create_legal_preparation_agent` via create_deep_agent authoring LegalRule+EngineeringRule from one pinned corpus; triggers call one command.
5. W2.5 cutover — assessment rule_sources reads ACTIVE DB portfolio only; retire replaced approval/classifier/lazy-recovery/cache writers AFTER gate evidence.
6. W2.6 gate — live corpus->portfolio vertical (needs model provider credentials: check availability; if absent record as external blocker) + all Freeze §11 W2 gate rows.

### W2.1 contract — DONE (2026-10-06)
`packages/contracts/src/legal-portfolio/{constants,schemas,index}.ts` + `./legal-portfolio` package export. Strict camelCase zod packet (agent meaning only; opaque source claims documentId/locator/contentSha256), submit request/result, read model; value sets as `as const` objects; failure codes include the 7 fixture codes; zero approval vocabulary (asserted). Reuses ALCS/AES schemas from agentic-runtime. `tests/legal-portfolio-contracts.test.ts`: 6/6 PASS; contracts tsc PASS.
Decisions frozen (resolve prep-report §"contract-owner decisions"): camelCase+strict; agent submits opaque source claims server resolves; shape by zod, uniqueness/orphan/source/coverage by server validator returning structured codes; start-preparation + submit are separate idempotent calls; one portfolio per run (repair = new run); BUILDING never persisted (submit is atomic).

### W2.2 persistence — DONE (2026-10-06)
Prisma: enums ArtifactLifecycleState/LegalPortfolioCoverageState/LegalContextRelationKind/LegalPortfolioValidationOutcome; models LegalPreparationRun, LegalPortfolioVersion, LegalPortfolioRule, EngineeringRule, EngineeringRuleLegalRule, LegalRuleProvenance, LegalRuleContextRelation, LegalPortfolioActivationRecord; OutboxAggregateType/AuditResourceType += LEGAL_PORTFOLIO_VERSION (+contract constants +mappers). V1 LegalRule/catalog/approval tables untouched (expand-only).
Migration `20261006120000_legal_portfolio_expand` (97th): partial unique index (single ACTIVE), state-consistency CHECKs, ALCS transition + identity-immutability trigger, immutable child/activation rows, composite FKs (same-portfolio ownership; provenance chunk must belong to the portfolio's corpus), optional composite FK for relation target.
`node tests/legal-portfolio-persistence.mjs` (fresh DB lcsp_w2_portfolio_persistence on 55441, all 97 migrations): PASS 26 guarantees. It caught a real bug in my first migration (NON_ASSESSABLE with NULL reason passed because CHECK treats NULL as pass) — fixed.
API tsc PASS after prisma generate + mapper additions.

### W2.3 API portfolio boundary — DONE (2026-10-06)
New module `apps/api/src/modules/legal-portfolio/` (registered in AppModule): `LegalPortfolioService` (startPreparation idempotent + outbox command; `submit` = zod request check -> idempotent replay -> corpus snapshot + pure `validateLegalPortfolioPacket` -> ONE serializable transaction under advisory lock `lcsp:legal-portfolio-activation`: replay re-check, supersede previous ACTIVE, insert portfolio (ACTIVE or INVALID with structured failures), children only when valid, run state, activation record, outbox, audit; serialization retry x4; `getActivePortfolio` = sole runtime reader selecting the explicit ACTIVE row, parsed by the read-model schema). Worker-API-key controller `internal/legal-portfolio/{preparations,submissions,active}`; actor/correlation from server only.
Mechanical validator (no legal judgement): duplicate ids, orphan engineering rule / relation, source claims resolved to the ONE pinned corpus (unresolved / stale hash / repealed / mixed-version), rule coverage, non-assessable reason presence, provision coverage (every non-repealed leaf chunk or an ancestor cited), empty portfolio, retrieval-index validity.
Tests (all PASS): validator unit 13; service integration on real PostgreSQL 12 (activation, replay, key-conflict, run-conflict, invalid preserves previous ACTIVE + no children + FAILED event, stale/mixed, no valid index, supersession + immutability, 3-way concurrent submissions -> exactly one ACTIVE, concurrent same-key -> one portfolio, rollback on outbox failure + safe retry, request-shape/authority rejection, start idempotency); controller 3. Total 28 PASS on DB lcsp_w2_portfolio (55441).
Findings fixed on the way: audit sanitizer drops payload keys matching /code|key|hash|token/ (renamed to `failureReasons`); API/contracts policies: check:imports, check:contracts PASS (portfolio value sets now registered in scripts/check-contract-literals.mjs).
Known limits recorded (not claimed): corpus APPROVED/DRAFT workflow is still V1 (corpus existence + valid retrieval index required; human corpus approval retires at W2.5); `BUILDING` is never persisted (submit is atomic); startPreparation does not yet enforce one in-flight run per corpus.

### W2.4 Legal Preparation Deep Agent — DONE for plumbing (2026-10-06); semantic/live proof still OPEN (see W2.6)
API additions: `claims` (QUEUED->RUNNING, returns ONLY the run's pinned corpus bundle), `validations` (dry-run, no writes), `failures` (records FAILED with bounded `LegalPreparationFailureReason` enum + DB CHECK that a reason exists iff FAILED), submit marks run FAILED/PORTFOLIO_VALIDATION_FAILED on invalid. API+DB suite now: 31 integration/unit tests PASS, 26 DB guarantees PASS (fresh DB, amended migration).
Python: `deepagents/legal_preparation/{agent,runner,tools,corpus_files}.py` + `instructions.md`; `create_legal_preparation_agent` uses native `create_deep_agent` with read-only `ls/glob/grep/read_file` over `/corpus` (permissions deny everything else), only two governed tools (validate dry-run, submit once; run id + idempotency key are server-bound, not agent-supplied), `subagents=[]`, general-purpose subagent disabled. `WorkerApiClient` gained claim/validate/submit/fail/get_active methods (redact=False so hash/key fields survive).
Real defect found+fixed: `register_harness_profile` MERGES into an existing key, so a "restore" could not undo `enabled=False` and would have leaked into the Root agent; replaced by exact save/restore of the registry entry scoped to graph build time (test pins it).
`deepagents/tests/test_legal_preparation_agent.py`: 9/9 PASS (provider-free ScriptedModel): bound tool set has no write/edit/execute/task/ask_human; forbidden tool calls + paths outside /corpus unavailable; one submit only (2nd never reaches API); invalid submit => FAILED without retry authority; NO_SUBMISSION / MODEL_ERROR / CORPUS_UNAVAILABLE recorded; profile scoped.
NOT proven: any real model's legal reading quality; real API <-> Python HTTP round trip; worker command dispatch; triggers.

### W2.5a trigger + reader cutover — DONE (2026-10-06); retirement of replaced writers still PENDING gate
- Trigger: `LegalCorpusRecoveryDriver` now calls `start_legal_preparation(corpus, f"{key}:legal-preparation:{version}")` right after the retrieval index is validated (single point shared by source-change and admin flows); boundary `legal_portfolio_preparation_requested` (`legal_preparation.boundary:LegalPreparationBoundary`, event `command.legal-portfolio.preparation.requested.v1`) registered in AGENT_INVOCATION_BOUNDARIES; outbox payload carries preparationRunId/legalCorpusVersionId.
- Reader: `legal_preparation/portfolio_reader.py` (sole Python reader of GET internal/legal-portfolio/active) + `rule_sources.resolve_engineering_rules` rewritten to read ONLY the ACTIVE portfolio (no get_or_compile, no `_recover`, no cache/bundle; missing portfolio => BLOCKED NO_ACTIVE_LEGAL_PORTFOLIO). Transitional `_to_v1_rule` bridge feeds the V1 per-rule loop until W3/W4 replaces it.
- USER-WIP OVERLAP (recorded per handoff): `deepagents/tools/common/capabilities/assessment/investigation/engineering_rule/engineering_assessment_boundary.py` — narrow change: the `resolve_engineering_rules(...)` call dropped the `rule_service`, `recovery_driver`, `source_crawl_requests` kwargs (3 lines deleted; no other edit; user's need-ID/interview work untouched).
- Python tests: `test_legal_preparation_trigger.py` (boundary/trigger/client) + rewritten `investigation/test_rule_sources.py` (8) + updated consumer/pipeline/driver/manifest pins. Full Python suite: 1718 passed, 18 skipped, 1 failed = PRE-EXISTING ENVIRONMENT failure (`test_common_tools_own_non_model_callable_implementation_domains`: empty untracked leftover dir `evidence/scanner/ts_js_bridge`, dated 2026-10-02; absent in a clean checkout).

### W2.6 gate evidence so far
`node tests/legal-portfolio-vertical.mjs`: PASS 57 checks on fresh migrated DB lcsp_w2_vertical (55441) with the REAL built API process over HTTP, the REAL Python Legal Preparation agent (native create_deep_agent) + WorkerApiClient; model SCRIPTED. Covers: worker auth (401 w/o/wrong key), idempotent start + cross-corpus conflict, corpus->portfolio automatic activation (5 LegalRules/3 EngineeringRules/2 relations/provenance, activated + preparation outbox events), single ACTIVE reader (`/active`), assessment bridge READY from real API (3 ER ids, pin = ACTIVE, 15 chunks indexed), finished run cannot be re-claimed, supersession (previousActive recorded, old rows readable), stale-hash + orphan packets => INVALID/FAILED with ACTIVE unchanged, no-submission => run FAILED/NO_SUBMISSION, 3 parallel agent processes => exactly one ACTIVE with distinct predecessors, no QUEUED/RUNNING runs left, ZERO CorpusApprovalRecord rows.
STILL OPEN for W2 gate: (1) reviewed SEMANTIC eval with a REAL model on the prepared fixture (definitions/qualifiers/exceptions/cross-refs/non-repository duty, source-answerable...); (2) retire replaced V1 writers (human approval/signoff, regex classifier, lazy recovery, EngineeringRule cache/bundle/Chroma, triage agent) AFTER (1); (3) admin routes/UI cutover (publish/discard -> prepare/history) — handoff schedules the web/admin UI for W5, API routes here; (4) full API/Web/Python regression + CI.

### W2 status as of 2026-10-06 (still W2; NOT gate-passed)
Verified (user-run + agent-run): full Python suite 1719 passed / 1 PRE-EXISTING env failure; real-stack vertical PASS 57; contracts 6/6; DB guarantees 29/29; typecheck, check:imports, check:contracts, API lint clean; full API suite 1316 passed + 1 failure now FIXED (portfolio integration spec; cause: other suites rebuild the shared test DB with `prisma db push`, dropping the migration's raw-SQL triggers/index/CHECKs — DB-level assertion now conditional; DB guarantees remain proven on a migrated DB by tests/legal-portfolio-persistence.mjs). Re-verified portfolio specs 31/31 on the db-push-rebuilt DB. NOTE for W7 CI: add `node tests/legal-portfolio-persistence.mjs` as a required check or the raw-SQL guards are unverified in CI.
Defects found/fixed by tests this wave: NULL-passing CHECK; profile registry merge leak; profile key vs route key; `ResolvedModelConfig` not subscriptable; contract hash format (production uses `sha256:<hex>`); reverse outbox aggregate map missing LEGAL_PORTFOLIO_VERSION (activation events would never publish).
LIVE SEMANTIC EVAL — BLOCKED (external): route llm7/GLM-5.3-Flash => Cloudflare 524 (>120 s/call) on the agent prompt; fallback google_genai/gemini-3.5-flash-lite => 429 RESOURCE_EXHAUSTED (quota) after 23 calls / ~610k input / ~55k output tokens (no portfolio produced). Anthropic/OpenAI keys empty; Inception has no documented model id. Needs a working provider route or a decision from the user. Agent token cost note: 610k input tokens over 23 calls on a 15-chunk corpus suggests heavy context growth; trace capture (tool-call names) added to tests/vertical/live_preparation.py for the next attempt.
STILL OPEN before W2 gate: (1) live reviewed semantic eval; (2) retire replaced V1 writers (human approval/signoff, regex classifier, lazy recovery, EngineeringRule cache/bundle/Chroma, triage agent) after (1); (3) admin routes (publish/discard -> prepare/history); (4) CI on a pushed branch.

## W2 live semantic eval — 2026-10-07 (still W2; NOT gate-passed)
- Added provider `apx` (OpenAI-compatible, `APX_API_KEY`/`APX_BASE_URL`) + route `fallback-02` in model_routes.yaml (user file, additive); `LCSP_W2_LIVE_MODEL` override in live runner; tool I/O trace in live result. Provider suites 147 passed.
- Inception mercury-2.5: 60 calls/1.29M input tokens, GraphRecursionError (120) without submit -> MODEL_ERROR (`inception-mercury-2.5-recursion-limit.json`). Model-capability limit, not a provider outage.
- apx gpt-6-luna-free: 403 event_not_started until 2026-10-09.
- apx claude-sonnet-4-6-free run 1: SUCCEEDED, portfolio ACTIVE (8 LR/6 ER/14 rel) but promoted context provisions (definition, scope, exception, timing) to LegalRules/EngineeringRules -> prompt tightened (operative vs context provisions).
- Run 2 (tightened prompt): SUCCEEDED, ACTIVE, 4 LR/2 ER/12 relations; definitions/scope/exceptions/qualifiers/cross-refs as relations + conditions; art-6 duty NON_ASSESSABLE with reason; pinned corpus version; 7 calls, 78k input tokens. Evidence: reports/w2-live-eval/run-{1,2}-*.json.
- Caveat: single synthetic fixture, one model, free tier; reviewer sign-off on rubric still pending.

## W2 reviewer sign-off (2026-10-07) — semantic fixture evidence
Reviewer decision: Run 2 (`reports/w2-live-eval/run-2-apx-claude-sonnet-4-6-free.json`) ACCEPTED as reviewed W2 semantic fixture evidence.
Rubric: DEFINITIONS PASS; QUALIFIERS PASS; EXCEPTIONS PASS; CROSS_REFERENCES PASS; NON_REPOSITORY_DUTIES PASS; CORPUS_VERSION_PINNING PASS; no invented standalone duties from definition/scope/exception/timing context PASS.
Accepted structure: Art.1/2 context; Art.3 exception linked to retention; Art.4 timing/cross-ref as qualifiers (folded into ER-001); Art.5(b) separate ER; Art.6 NON_ASSESSABLE with reason.
Decision: no further provider/model run required to close the W2 gate. Next: W2.5 retirement of replaced V1 legal writers.

## W2.5 — V1 legal authority retirement (2026-10-07) — COMPLETE
Inventory + classification (DELETE_NOW / KEEP_TRUSTED_INFRASTRUCTURE / DEFER_TO_W3_W4_W5_W6 / HISTORICAL_ONLY): `reports/w2-v1-legal-retirement-inventory.md`.
Retired: human LegalRule/corpus signoff; draft/approve/publish/discard/manual-ingest/recover routes + handlers; regex normative classifiers (API+Python); assessment-triggered recovery/lazy triage dispatch; get_or_compile/Chroma cache/precompiled bundle (+Docker COPYs); legal triage subagent/skill/middleware/registration; duplicate compiler paths; unwired legacy scripts/schedule.
Behaviour: admin prepare auto-activates the validated corpus (no deferActivation/publish) then closes the preparation row; ingest accepts only official-source auto-trusted manifests; admin detail actions always disabled.
`_to_v1_rule` bridge kept as read-only ACTIVE-portfolio adapter, recorded DEFER_TO_W3/W4.
User-WIP overlap: `engineering_assessment_boundary.py` further narrowed (triage dispatch/recovery/rule_service removed). `model_routes.yaml` untouched (unused roles triage/legal-chunk-triage/legal-compiler remain).
Evidence: A static gate `pnpm run check:legal-v1-retired` (added to `lint`) 0 refs/1475 files; B/C/D/E W2 vertical PASS 58 (auto activation, invalid preserves ACTIVE, assessment reads ACTIVE only); DB guarantees 29/29; F: Python 1599 passed + 1 pre-existing env failure (untracked evidence/scanner node_modules dir), API e2e 295 passed, API unit 1242 passed with only DB-less billing suites failing (no Postgres on their port; same as W1) and portfolio/prisma specs 35/35 on disposable DB, web 29+617 passed, contracts 6/6, typecheck/check:imports/check:contracts/check:agentic-tools green; G import/registration searches in the gate.
Known gaps: web admin publish/discard UI+BFF remain (DEFER_TO_W5, disabled); noChanges admin prepare leaves its DRAFT row (pre-existing); Legal Preparation not metered (W3).
