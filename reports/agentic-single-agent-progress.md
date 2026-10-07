# LCSP Single-Agent Migration Progress

## Current position

2026-10-07: W3 (LCSP-353) convention audit and regression gate completed in `/home/khovan/Workplaces/LCSP` and published as PR #360 on `feat/LCSP-353-implement-isolated-assessment-root-and-domain-runtime`. The CI diagnosis used PR head `26bc93ede1ea32f8be06f276518508cc188c8c12`. The user subsequently authorized updating the PR description and fixing CI; the repair evidence is recorded below. The W1/W2 logs are historical. No Wave restarted.

## Current authorized Wave

W3 (LCSP-353) authorized by user `continue W3` on 2026-10-07 after W2 GATE PASS (PR #359 merged, CI green). W4+ remain unauthorized.

## Current Gate

W3 local convention/regression gate: PASS. See `Codebase convention verification` below for implementation evidence, exact commands, skips and proof limits. PR #360 CI repair is recorded separately below; local PASS is not a claim that the new remote head's checks have completed.

## Jira Wave

LCSP-353 — Assessment domain and isolated Root runtime. No Jira mutation performed in this convention audit.

## Architecture authority

Read the complete `docs/architecture/LCSP_AGENTIC_MIGRATION_HANDOFF.md` and `reports/architecture-freeze-migration-manifest.md`; inspected the W1 gate and coordinator ledger. Freeze wins for architecture; current source/executable evidence wins for implementation. Historical worker state is not authority. User correction permits direct repository tooling and makes SourceNerve availability irrelevant to the gate.

## Historical W1 starting snapshot (2026-10-06)

The sections through the first W1 execution log describe the initial W1 handoff, not the current W3 gate.

### Preserved user WIP

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


## W3 log (LCSP-353 — assessment domain and isolated Root runtime) — started 2026-10-07
Authorization: user `continue W3`. Working tree: `develop` (clean at start, HEAD 1647b8d6c). No commit/push/branch change without authorization.
Plan (freeze §11 W3): W3.1 contracts (case/evidence/coverage/tool packets); W3.2 persistence (AssessmentCase+facts, AssessmentEvidence incl. SEARCH_COVERAGE, HumanResolutionRequest, RuleDecision+history, per-rule decision coverage (DRS), AssessmentArtifact metadata, DB guards); W3.3 API (authority-checked case/evidence/request/decision tools, DecisionValidator, runtime preparation PREPARING->ACTIVE with pinned inputs, root claim/lease); W3.4 Python `create_assessment_root_agent` bound to server threadId + bounded Repository Researcher via native task(); W3.5 repository runtime keeps deterministic snapshot/sandbox/index/source-ref, retire model-driven Scanner + callback decision gates; W3.6 W3 vertical + gate evidence.
Scope boundary: semantic decision flow/HITL resume/absence sufficiency/completion gate/report are W4; web projection W5; schema drop W6.

### W3.1–W3.4 built (2026-10-07) — vertical PASS, retirement (W3.5) next
Contracts `packages/contracts/src/assessment-domain/**` (value sets + strict schemas, registered in check-contract-literals; export `./assessment-domain`). Persistence: Prisma models AssessmentCase (pins set-once), AssessmentEvidence (incl. SEARCH_COVERAGE subtype), AssessmentCaseFact(+Evidence links), AssessmentRuleDecision (accepted + immutable history), AssessmentDecisionCoverage (DRS, one row per pinned EngineeringRule), AssessmentHumanRequest, AssessmentArtifact; migration `20261007120000_assessment_domain_expand` with CHECKs, partial unique indexes and triggers (pin immutability/ACTIVE-portfolio-only, evidence/fact/decision immutability, exhaustive DRS + ALCS transition tables, ACTIVE requires pins + full coverage).
API (`modules/assessment/`): nine Root command handlers and two query handlers coordinate shared AssessmentEventAppender (sole non-lifecycle event writer), AssessmentRuntimeAuthority (server-issued thread/execution/lease), AssessmentRuntimePreparation (pins, full decision coverage, PREPARING->ACTIVE via coordinator.transitionVerifiedInTx, single Root command) and AssessmentEvidenceInvalidation. Pure DecisionValidator lives in `domain/`; Prisma case/context support lives in `infrastructure/persistence/`. `AssessmentDomainController` under `/internal/assessment-runtime/:assessmentId` uses worker authentication, Zod transport validation and CommandBus/QueryBus. Lease-header shape is guarded before body parsing; persisted lease authority is checked inside handlers. GetPinnedPortfolioHandler dispatches GetLegalPortfolioVersionQuery to read the pinned (possibly SUPERSEDED) portfolio. Both former monolithic services are deleted; see the convention section for final module wiring.
Python `deepagents/assessment_root/*`: `create_assessment_root_agent` (only assessment entrypoint; thread = server threadId; general-purpose subagent disabled; read-only repo permissions), governed tools (identity/pins/hash/idempotency bound server-side; rejections returned as structured feedback), runtime-authenticated search-trace for coverage, `repository-researcher` native task() subagent with no governed tools, TaskLineage (SUBAGENT activity under the Root execution), runner, boundary registered as `assessment_root_requested`.
Evidence so far: `node tests/assessment-domain-vertical.mjs` PASS 82 (real API+PG+Python Root, scripted model): unique thread per assessment, ACTIVE only after pins+full coverage, validator rejects bad packet with mechanical codes and Root self-corrects, 3/3 rules RESOLVED, evidence/facts/decisions pinned, gap-free event sequence on one thread, researcher events descend from Root execution, restart reloads server state on new execution/same thread, A/B isolation + concurrent claim (one 200/one 409), cross-lease/spoofing/forged-ID rejections, supersession keeps A pinned while new assessment pins new ACTIVE, DB guards. Python offline 14/14, DecisionValidator spec 6/6, handler specs updated.

### W3.5 retirement of V1 model-driven Scanner + callback decision gates — DONE (2026-10-07)
Inventory method: reachability analysis (import graph + boundary registry strings) over candidate V1 directories; deleted only modules with zero production reachability after the five V1 registrations were removed.

DELETE_NOW (done, 92 production files + ~45 tests):
- Python boundary registrations: `scan_requested`, `targeted_reanalysis_requested`, `engineering_assessment_requested`, `assessment_interview_resume_requested`, `assessment_interview_pause_requested` (only `assessment_root_requested` + legal preparation/recovery/gap/report/health remain).
- `evidence/repository_analysis/*` (AI-discovery scanner, targeted reanalysis), `package_signals.py`.
- `assessment/{investigation,planning,evaluation,claims,rule_assessment}/*` (per-rule loop, InterviewGated boundary, rule_sources bridge, claim/classification/conflict/AI-usage engines), `workflow/recovery/*` (interview boundaries, post-guard continuation).
- `orchestration/{dispatcher,lifecycle,interview_progress,technical_coverage_policy,result_validation}.py`, `middleware/{tool_scope,specialist_handoff_validation,interview_runtime_context}.py`, `subagents/*`, `contracts/*` (handoffs), `skills/interview-context/*`, `tools/common/{submit_rule_assessment,retrieve_verified_episodes,retrieve_legal_basis,get_legal_corpus_readiness}`, `tools/legal/corpus/engineering_rules/*` (V1 EngineeringRule contract), V1 `get_code_snippet` ref-minting tool, interview ledger coupling in `runtime_envelope.py`, `scripts/repair_interview_coverage_policy.py`.
- API: `SnapshotCreatedAutoScanService` (Scanner kick-off) and its wiring/specs.
- CI: "Production Interview vertical" job + `seed-lcsp-278-release-vertical.ts` replaced by "Assessment Root vertical" (runs W2 + W3 verticals on real Postgres/API/Python).
- Static gate `check:legal-v1-retired` extended (16 patterns: retired boundary names/classes, SnapshotCreatedAutoScanService, submit_rule_assessment/analyze_rule/TechnicalCoveragePolicy) — 0 references.
- W2 `_to_v1_rule` read bridge removed; W2 vertical step 5 now covered by W3 vertical (`get_pinned_portfolio` through the Root API).

DEFER (recorded, not hidden):
- DEFER_TO_W4: Interview API/web/runtime service + Interview resume/pause *API* surface, human-request answer/interrupt-resume, Root pause command registration (empty `_INTERRUPT_TARGET_BOUNDARIES_BY_COMMAND_BOUNDARY` placeholder), `scan_requested`-keyed scan-job claim/timeout/thread-id infra in `agent_server_client.py`, `rabbitmq_consumer.py`, `system_event_dispatch.py` (dead branches: no boundary uses them).
- DEFER_TO_W5: user-facing scan trigger/rerun/targeted-reanalysis API handlers + UI (they still publish `scanTriggered`/`targetedReanalysisRequested` events that no Python boundary consumes — such scans no longer start; `RepositoryScanJob` remains only as the snapshot-archive hydration ticket for Root), gap/final-report boundaries.
- Known gaps: Root/Legal-Preparation usage metering with real governance middleware not exercised in vertical (`governance=()`); real PostgresSaver restart and Docker `sandbox_backend_factory` hydration not exercised live.

Verification (2026-10-07): Python 1157 passed/7 skipped; API tsc clean; web tsc clean; contracts build; `check:imports`, `check:contracts`, `check:agentic-tools`, `check:legal-v1-retired` pass; W2 vertical PASS 54; W3 vertical PASS 82; API jest unit: 181 suites pass, DB-dependent suites run separately against disposable Postgres (see below).

## W3 GATE — PASS (2026-10-07)
Fresh post-CQRS convention verification: Python 1159 pass/7 skip; API build, root typecheck and zero-warning touched-module lint pass; legal-portfolio/assessment/common-pipe/outbox Jest 30 suites/359 tests pass on a fully migrated disposable database; API e2e 45 suites/294 tests pass (3 suites/21 tests skipped); check:imports/contracts/agentic-tools/legal-v1-retired pass; W2 vertical 54 checks; W3 vertical 82 checks. Earlier broad API unit evidence (181 suites) is historical and is not presented as a full-unit rerun after CQRS. Exact commands and execution-order limits are recorded below.
Gate rows (all evidenced by W3 vertical unless noted): unique assessment↔thread; descendant (researcher) refs/lineage events; researcher cannot mutate (read-only tools, permissions test); survival across restart (new execution, same thread, server state); disjoint A/B namespaces; one immutable ACTIVE portfolio pinned and covering every EngineeringRule (DB guards); V1 Scanner/per-rule loop retired (static gate, 0 references).
Removed e2e test: `pin-commit-snapshot` "auto-chains a trusted scan job" (asserted retired Scanner kick-off).
Recorded gaps (not gate rows): real governance/usage metering for Root, PostgresSaver restart, Docker sandbox hydration live; W4/W5 DEFERs listed in W3.5 block.
No commit/push/branch performed. STOP — awaiting user `continue` for W4.

## Codebase convention verification

Scope: current authorized W3 (LCSP-353), 2026-10-07, including the Legal Portfolio CQRS changes in the current dirty tree. Bounded to added/materially changed production files, their callers, module wiring and relevant tests. Discovery used the checkout's Codebase Memory graph and Graphify; conclusions used direct source reads. Nearby `create-assessment` and `complete-repository-setup` handlers, Legal Corpus query handlers and existing module wiring supplied the production patterns. No unrelated legacy-wide refactor or W4 work.

**Root cause:** the original Assessment Domain controller/service bypassed CQRS and mixed transport parsing, orchestration and Prisma. The Legal Portfolio CQRS handoff removed its monolith but left Prisma loaders/activation/mappers in application services and its pure integrity validator in application. It also lost the old submit error's `problem.meta.issues` paths when validation moved to ZodValidationPipe. Root finish used an inline transport schema, and route IDs/lease-header shape did not receive runtime Zod validation.

**Fix:** retain the existing CQRS decomposition; move persistence-only helpers into infrastructure and pure validators into domain; use the shared schemas at HTTP boundaries. ZodValidationPipe supports opt-in, at-most-20 comma-separated issue paths. Only Legal Portfolio submit enables it, restoring the prior response without exposing input values; existing callers still omit issue metadata. Root validation retains 422 ASSESSMENT_DOMAIN_REQUEST_INVALID; Legal Portfolio retains 400 LEGAL_PORTFOLIO_SUBMIT_REQUEST_INVALID, and HTTP status equals problem.status. Worker authentication and malformed-lease rejection run before body pipes; persisted lease/thread/execution authority remains in handlers.

Implementation evidence:

- Assessment commands (9): `claim-assessment-root`, `heartbeat-assessment-root`, `finish-assessment-root`, `accept-assessment-evidence`, `accept-assessment-fact`, `start-rule-investigation`, `submit-rule-decision`, `open-human-request`, `record-root-activity`. Each has its command and `@CommandHandler` / `ICommandHandler` implementation. Reads are `get-root-context` and `get-pinned-portfolio`, each with its query and `@QueryHandler` / `IQueryHandler`. Existing create/setup handlers reuse AssessmentRuntimePreparation.
- Legal Portfolio commands (4): `start-legal-preparation`, `claim-legal-preparation`, `fail-legal-preparation`, `submit-legal-portfolio`. Queries (3): `validate-legal-portfolio`, `get-active-legal-portfolio`, `get-legal-portfolio-version`. The validation query is read-only. Submit owns integrity validation, serializable retry and activation orchestration; it preserves idempotency, advisory locking, rollback and the prior ACTIVE portfolio on rejection.
- Both HTTP controllers inject CommandBus/QueryBus and dispatch one command/query per endpoint; presentation contains guards, Zod pipes, correlation IDs and result-envelope mapping, with no Prisma or semantic/lifecycle decision logic. The old AssessmentDomainService and LegalPortfolioService are deleted, with no forwarding aliases.
- `assessment.module.ts` and `legal-portfolio.module.ts` import CqrsModule and register their handlers and required helpers locally. Assessment imports LegalPortfolioModule; its GetPinnedPortfolioHandler calls GetLegalPortfolioVersionQuery through QueryBus, preserving the immutable pinned version even after supersession. It does not inject Legal Portfolio implementation services. AppModule remains module composition.
- Pure `decision-validator`, `domain-ids`, `customer-safe-text`, `rule-criteria` and `legal-portfolio-integrity.validator` live in domain; direct inspection and the import scan found no Nest/Prisma/infrastructure/presentation dependency in these files. Validation checks mechanical identities, provenance, revisions and coverage, not legal meaning.
- `legal-corpus-snapshot.service.ts`, `legal-portfolio-read-model.service.ts`, `legal-portfolio-activation.service.ts`, `legal-portfolio.mappers.ts` and `assessment-case-support.service.ts` live in their feature's `infrastructure/persistence/`. Their Prisma projections/transactions and caller imports were inspected. Cohesive application coordination remains in AssessmentRuntimeAuthority, AssessmentRuntimePreparation, AssessmentEventAppender and AssessmentEvidenceInvalidation. No replacement all-use-case service or speculative single-implementation port was introduced.
- All Legal Portfolio request bodies use the existing shared contract schemas. Every Root body, assessmentId route parameter and lease-header shape uses a shared Zod schema or schema field. `LegalPreparationClaimRequest` and `FinishAssessmentRootRequest` derive from schemas in packages/contracts; finish no longer duplicates a local schema. Its accepted vocabulary remains the existing execution-state contract. New closed value sets use `as const`; the literal/enum scan found only permitted Zod enums over canonical constants. Persisted closed vocabularies use Prisma enums. Human-request controlType remains the frozen open identifier contract rather than inventing a closed enum.
- Nest/supertest controller checks use the real pipes, guards and problem filter: malformed inputs never dispatch; submit exposes bounded paths, other Legal Portfolio endpoints omit them; unauthorized worker requests return 401; malformed Root IDs/finish bodies return 422 and malformed lease headers return 403 before body parsing. Shared-pipe tests verify status consistency and absence of submitted secret values.
- No apps/web production file was added/materially changed by W3. Next/BFF Zod, Atomic Design placement, shadcn reuse and RHF + Zod forms are **not applicable** to this Wave; no fresh browser verification is claimed.
- The Python retirement edit in `runtime_envelope.invoke_tool` left a Mapping return followed by unreachable dict conversion. It now preserves dict results and materializes other Mappings; the authored-tool check covers both dict and MappingProxyType. A full-suite failure in the broker timeout test came from an unmocked worker HTTP notification plus a fixed 50 ms sleep. The test now isolates that notifier and waits for the actual nack Event; production broker behavior was not changed.
- The migrated Legal Portfolio integration harness had synchronous Zod throws behind Jest `.rejects`; async wrappers restore the controller's promise behavior. The initial two harness failures were repaired before the fresh passing run.

Fresh checks (all shell commands invoked with RTK; PASS means completed exit 0):

| Command / environment | Result |
|---|---|
| `rtk docker exec lcsp-api-test-postgres-55441-lcsp_w2_base psql -U postgres -d postgres -c 'CREATE DATABASE lcsp_w3_convention_20261007'`; `rtk pnpm --dir apps/api exec cross-env DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55441/lcsp_w3_convention_20261007?schema=public pnpm exec prisma migrate deploy` | PASS; fresh disposable DB, all 98 ordered migrations applied, including W3 SQL guards |
| `rtk pnpm --dir apps/api exec cross-env DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55441/lcsp_w3_convention_20261007?schema=public PHASE25_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55441/lcsp_w3_convention_20261007?schema=public NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --config ./jest.config.ts --runInBand src/modules/legal-portfolio src/modules/assessment src/common/pipes src/platform/outbox` | PASS; 30 suites, 359 tests, no skips; includes legal-portfolio unit/integration and assessment suites |
| `rtk pnpm --dir apps/api run build` | PASS; runtime packages and API rebuilt after the final persistence-helper relocation |
| `rtk pnpm run typecheck` | PASS; root contracts/API/Web typecheck |
| `rtk pnpm --dir apps/api exec eslint src/modules/assessment src/modules/legal-portfolio src/common/pipes/zod-validation.pipe.ts src/common/pipes/zod-validation.pipe.spec.ts --max-warnings=0` | PASS; zero warnings |
| `rtk proxy node tests/legal-portfolio-vertical.mjs` | PASS; 54 checks on built API + migrated disposable PostgreSQL + Python Legal Preparation agent |
| `rtk proxy node tests/assessment-domain-vertical.mjs` | PASS; 82 checks on built API + migrated disposable PostgreSQL + Python Root; both verticals rerun after final helper relocation |
| `rtk pnpm --filter @lcsp/api test:e2e` | PASS; 45 suites/294 tests passed, 3 suites/21 tests skipped; executed after CQRS and transport repairs. The subsequent AssessmentCaseSupport path-only relocation was covered by the final build, focused Jest and both verticals |
| `rtk uv run --project deepagents --extra dev pytest deepagents/tests/test_agent_runtime_rabbitmq_consumer.py -q` | PASS; 52 tests after deterministic timeout-test repair |
| `rtk uv run --project deepagents --extra dev pytest deepagents/tests -q` | PASS; 1159 passed, 7 skipped; final run after both Python repairs |
| `rtk pnpm run check:imports` | PASS |
| `rtk pnpm run check:contracts` | PASS |
| `rtk pnpm run check:agentic-tools` | PASS; 1 Python remediation tool, 9 Nest CQRS tools, 1 runtime-control command |
| `rtk pnpm run check:legal-v1-retired` | PASS; 1492 production files, 16 patterns, zero retired references |
| Changed-use-case direct literal union / enum scan; pure-domain forbidden-import scan; `rtk proxy git diff --check` | PASS; no TS enum/direct literal union violation, no forbidden pure-domain import, no whitespace error |
| `rtk proxy graphify update .` | PASS; AST-only graph refresh. Existing missing SQL parser / smoke-fixture parse warnings are not SQL or fixture acceptance |

Proof limits: verticals use real API, PostgreSQL and native Python agents with SCRIPTED model output. They do not establish live-provider metering, real PostgresSaver crash/checkpoint recovery, Docker sandbox hydration or browser acceptance. Existing W4/W5 deferred surfaces remain recorded above. The standard API e2e harness uses its disposable db-push database; raw SQL constraints are separately covered by ordered migrate-deploy and the verticals. Skipped e2e/Python tests remain skipped, not passed. No remote CI run for this uncommitted head is claimed.

Convention result: **PASS for the inspected current-wave changes**, supported by source, transport tests, migrated persistence tests and vertical execution. The obsolete LegalPortfolioService known-violation entry is closed by its inspected CQRS replacement and fresh checks. At that gate closure no commit, push, PR, deployment or next-Wave action had been performed. The subsequent PR/CI work is recorded below; W4 still requires the user's explicit `continue`.

### W3 PR #360 CI repair (2026-10-07)

Authorization: user requested "update PR description and fix ci failed". Verified a clean feature branch matching PR head `26bc93ede1ea32f8be06f276518508cc188c8c12` before editing. Updated the PR description with the final W3 behavior, CQRS/convention changes, migration rollout, local evidence and deferred scope, then read it back from GitHub.

**Root cause:** [Assessment Root vertical job 112639012651](https://github.com/khovan123/LCSP/actions/runs/37574083501/job/112639012651) failed at Prisma generation: the new job omitted DATABASE_URL, which prisma.config.ts requires. Source/caller inspection also found the scripts launch `deepagents/.venv/bin/python`, while that job installed dependencies globally and never created the virtual environment. [Docker sandbox job 112639012759](https://github.com/khovan123/LCSP/actions/runs/37574083501/job/112639012759) failed one hydration assertion that expected the intentionally retired interview-context skill to be present. Other checks on that original head completed successfully.

**Fix:** the Root vertical job supplies the URL of its own disposable PostgreSQL service and uses `uv==0.10.6` plus `uv sync --frozen --extra dev` to create `.venv` from the committed lockfile, matching the Docker images' package-manager version. The existing stack helper still overrides DATABASE_URL for each named W2/W3 disposable database. Docker hydration now asserts the retired skill entrypoint is absent, while retaining the active LCSP skill, repository contents, marker, hydration idempotency, mountpoint and Git checks. No production runtime, contract, persistence authority or frontend behavior changed.

The first repair commit `cdd563f5c` reached 23 successful remote checks, including Docker, API unit/e2e, Python, Web and Playwright. Only Root dependency installation remained pending. Its initial fresh-venv pip install repeated dependency resolution; a disposable local `pip install --dry-run -e './deepagents[dev]'` reproduced repeated backtracking across OpenTelemetry exporters/proto/instrumentation versions and was terminated after diagnosis. The follow-up uses the reviewed lockfile rather than changing dependency constraints or weakening the job. The pending older run is superseded, not counted as a passing Root vertical.

| Fresh local command / check | Result |
|---|---|
| `rtk pnpm run build:runtime-packages` | PASS |
| `rtk proxy env NODE_ENV=test DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55437/postgres?schema=public pnpm --filter @lcsp/api prisma:generate` | PASS; generation accepts the job's explicit URL |
| Same explicit environment with `pnpm --filter @lcsp/api build` | PASS |
| YAML parse and service/URL port consistency assertion | PASS |
| `uv==0.10.6 sync --project deepagents --python deepagents/.venv/bin/python --frozen --extra dev` with `UV_PROJECT_ENVIRONMENT=/tmp/lcsp353-ci-locked-venv` | PASS; pristine virtual environment, 193 pinned packages installed using the local package cache |
| `rtk proxy env PYTHONPATH=deepagents:deepagents/tests /tmp/lcsp353-ci-locked-venv/bin/python -m pytest deepagents/tests/test_assessment_root_agent.py deepagents/tests/test_runtime_envelope.py -q` | PASS 17, no skips, in that fresh locked environment |
| Same explicit environment with `node tests/legal-portfolio-vertical.mjs` and `node tests/assessment-domain-vertical.mjs` | PASS 54 / 82; real API, migrated named disposable DBs on the helper's local default port 55441, native Python agents, scripted models |
| `rtk docker build -f deepagents/Dockerfile.dev -t lcsp-agent-runtime:lcsp353-ci-fix .`; `rtk docker build -f deepagents-langgraph/Dockerfile -t lcsp-agent-runtime-server:lcsp353-ci-fix .` | PASS; fresh source images with task-specific tags |
| `rtk proxy env LCSP_DOCKER_SANDBOX_E2E=1 LCSP_PRODUCTION_AGENT_SERVER_IMAGE_E2E=1 LCSP_REPOSITORY_SANDBOX_IMAGE=lcsp-agent-runtime:lcsp353-ci-fix LCSP_PRODUCTION_AGENT_SERVER_IMAGE=lcsp-agent-runtime-server:lcsp353-ci-fix uv run --project deepagents --extra dev pytest deepagents/tests/integration/test_codebase_memory_runtime_e2e.py deepagents/tests/integration/test_docker_sandbox_e2e.py deepagents/tests/integration/test_local_agent_runtime_e2e.py deepagents/tests/integration/test_production_agent_server_image_e2e.py -q` | PASS 7, no skips, including real Docker hydration and production-image health-graph persistence/restart |
| `rtk proxy graphify update .`; `rtk proxy git diff --check` | PASS |

Convention verification delta: inspected only the changed CI setup and integration expectation; no new production module, handler, domain, BFF or UI implementation. Existing W3 CQRS/layer/Zod evidence remains applicable. The Docker health graph's persistence/restart check is not Assessment Root PostgresSaver crash-recovery proof. Final remote acceptance must use the pushed PR head's rollup; historical failing jobs and these local checks cannot substitute for it. W4 has not started.
