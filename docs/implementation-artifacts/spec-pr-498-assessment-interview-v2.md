---
title: 'PR 498 CI recovery and Assessment Interview v2'
type: 'refactor'
created: '2026-11-15'
status: 'in-progress'
baseline_commit: 'caf06e5e3b611be2536111587cf5b7719b773bc9'
review_loop_iteration: 0
context:
  - 'docs/project-context.md'
  - 'docs/planning-artifacts/architecture/architecture-LCSP-2026-11-15/INTERVIEW-AUDIT-REPORT.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** PR #498 has four failing checks caused by governed instruction-construction drift, while Assessment Interview still promotes insufficiently validated answers to facts, invalidates unrelated decisions, deduplicates by wording, and investigates source without a bounded relevance map.

**Approach:** First reconcile `develop`, restore CI, and record a reproducible baseline. Then incrementally add backward-compatible typed FactNeed/answer handling, fail-closed dependency-selective invalidation, rule-aware bounded repository relevance, aligned controls/prompt policy, and measured behavioral evaluation while preserving API authority and durable LangGraph checkpoints.

## Boundaries & Constraints

**Always:** Work on the existing PR #498 branch; reconcile `develop` without force-push; preserve user working-tree changes and historical HumanRequests, facts, decisions, checkpoints and audit records; prefer additive migrations; retain raw answers, evidence provenance, source pins, legal distinctions, audit/outbox, idempotency, concurrency and checkpoint guarantees; add the required five-heading business documentation to changed production logic; verify the exact pushed commit in GitHub CI.

**Ask First:** New runtime dependencies, destructive schema/data operations, or a change that cannot preserve existing accepted assessment history.

**Never:** Create another branch/PR, merge the PR/deploy, force-push, destructively reinterpret historical data, weaken tests or release gates, fabricate compliance or metrics, pre-populate T31–T40 recorders, send/persist unrestricted raw source, replace LangGraph, duplicate Codebase Memory with an unproven graph engine, or use a hard source allowlist that reduces verified coverage.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Clear answer | Valid typed value, no conflict | Raw evidence retained; one accepted fact created | Replay is idempotent |
| Ambiguous/conflicting answer | Uncertain or contradicting value | No silent accepted fact; proposal waits for confirmation/review | Existing decisions remain until accepted change |
| Does not know | `doesNotKnow=true` | Request stays unresolved; no fact/verdict | Preserve existing resume semantics |
| Shared factual need | Equivalent wording/locale for multiple rules | One canonical FactNeed/request with all dependencies | Different scope/timeframe stays distinct |
| Historical assessment | Existing request/fact/decision/checkpoint/audit rows | Continue to load and resume without reinterpretation | New fields use additive compatibility defaults/projections |
| Selective change | Fact A changes; Rule B does not depend on A | Only decisions supported by A are invalidated | Stale revision fails closed |
| Repository investigation | AssessmentRule plus AI/non-AI evidence needs, wrappers, jobs/events/config and unresolved graph edges | Ranked, provenance-bound ranges with audited expansion and separate reachability state | Scanner limits/gaps never become evidence of absence |

</frozen-after-approval>

## Design Amendment — Discovery-First Workflow (2026-11-16)

This amendment preserves the frozen intent and changes the delivery sequence from rule-first retrieval to a discovery-first, explicitly authorized assessment workflow:

`Repository Snapshot -> Deterministic Repository Discovery -> AI Use Case Discovery -> Context Fact Resolution / Interview -> Candidate AssessmentRule Matching -> Explicit Audit Scope Authorization -> Rule-Specific Assessment -> RuleDecisions and Report`.

- Existing `CUSTOMER_SELECTED`, `SELECTED_RULES`, `FULL_RULE_SET`, and legacy/direct selected-rule audits remain valid when discovery has not run.
- Discovery persists a versioned, pin-bound result containing classified source observations, AI use cases, runtime invocation candidates, entry paths, data flows, safeguards, unknowns, coverage gaps, and cache identity. Candidate findings, README/comments, graph results, and hypotheses never become accepted facts automatically.
- Technology relevance drives use-case discovery. Rule-specific relevance is applied only after a pinned rule is being recommended or assessed and may include non-AI controls such as retention, access control, logging, disclosure, authorization, and security.
- Candidate rule matching is explainable and separate from authorization. `CANDIDATE`, `NEEDS_CONTEXT`, `RECOMMENDED`, `SELECTED`, and `NOT_SELECTED` are recommendation/selection states, never applicability or compliance verdicts. Only the API/customer selection path authorizes an audit scope.
- Rule-specific assessment first reuses compatible accepted evidence, facts, discovery ranges, coverage records, and unresolved dependencies. It performs targeted expansion only for missing support, incomplete call chains, bypasses/counterexamples, unknown runtime configuration, or bounded negative claims.
- The scanner reuses RepositoryProfile and Codebase Memory; it must not execute customer code or introduce a duplicate indexing engine. Ranked ranges are priorities, not an exclusion gate, and every truncation/unsupported language/unresolved edge remains an explicit coverage limitation.
- Scanner/cache evolution remains compatible with historical V1 profiles through explicit signature/version refresh semantics; it never silently reinterprets an old cache artifact.
- Evaluation compares pinned before/after runs over the same repositories and rules for recall, precision, false negatives, source reads, tokens, latency, cache overhead, question quality, evidence reuse, invalidation correctness, and legal accuracy. Only executed measurements may be recorded.

### Current State Classification at `caf06e5e3b611be2536111587cf5b7719b773bc9`

| Requirement | Status | Evidence / gap |
|---|---|---|
| Branch integration and governed instruction repair | IMPLEMENTED | PR is rebased and mergeable; all GitHub checks passed on exact pushed HEAD `caf06e5e3b611be2536111587cf5b7719b773bc9` on 2026-11-16. |
| Existing selected/full/legacy audit compatibility | IMPLEMENTED | API-owned immutable audit requests and direct selected-rule execution already operate without discovery. |
| Deterministic repository inventory and dependency signals | PARTIALLY_IMPLEMENTED | V1 scans bounded manifests, languages, frameworks, containers and gaps, then discovers direct AI calls, raw provider HTTP, model-like wrappers and nearby control/data-flow signals. Measured recall/precision and connection-aware incremental invalidation remain pending. |
| Durable versioned Discovery result | IMPLEMENTED | `LCSP_DISCOVERY_V1` is an immutable assessment-owned API record bound to snapshot/repository/commit/scope/scanner/graph/cache/digest coordinates; V1 RepositoryProfile remains compatible. |
| Runtime call sites, raw HTTP, wrappers and business callers | PARTIALLY_IMPLEMENTED | Deterministic source discovery covers direct SDK calls, raw provider HTTP, model-like wrappers, configuration and nearby controls/data-flow signals. The existing pinned Codebase Memory index now adds bounded cross-file caller/callee priorities with explicit graph gaps; verified production reachability remains pending. |
| Source classification versus verified reachability | PARTIALLY_IMPLEMENTED | Discovery represents the required source contexts separately from conservative reachability; no path is promoted to reachable production without a verified call path. Reachability verification remains pending. |
| Technology and rule-specific RelevanceMap | PARTIALLY_IMPLEMENTED | Technology ranges are digest-bound, deterministically prioritized and exposed as a bounded Root preview; API-owned matching applies the pinned rules and accepted facts without authorizing assessment. Runtime-traced expansion is now durably audited, but deterministic rule-targeted range generation and verified reachability remain pending. |
| Explicit coverage limits and pin/cache identity | PARTIALLY_IMPLEMENTED | Discovery records limits, truncation, unsupported languages, skipped paths, unresolved calls, total resource budgets, scanner signature and graph index identity. Cross-file connection-aware incremental invalidation remains pending. |
| Canonical FactNeed and cross-locale deduplication | IMPLEMENTED | Additive FactNeed persistence distinguishes tenant owner, assessment, subject, predicate, operational scope, environment/deployment, timeframe and value schema; wording/locale and shared rule dependencies reuse one need. |
| Minimal, batched human questions with native interrupt | PARTIALLY_IMPLEMENTED | Atomic batch questions and native checkpoints reuse canonical FactNeeds, including equivalent needs inside one batch; discovery-completeness/materiality gating remains pending. |
| Raw answer -> proposal -> accepted fact | IMPLEMENTED | Non-unknown answers now create immutable Fact Proposals bound to assessment, request revision, case revision, checkpoint, actor and idempotency. Clear proposals atomically reference accepted evidence/facts; ambiguous or conflicting proposals remain `PENDING_REVIEW`, keep the request open and create no authority. Typed-invalid, stale and checkpoint-invalid submissions still reject before persistence. |
| Explainable candidate AssessmentRule matching | IMPLEMENTED | API-owned deterministic matching uses the pinned Rule Set, discovery findings and accepted facts to emit immutable non-authoritative `CANDIDATE`/`NEEDS_CONTEXT` revisions. Candidates never authorize audit scope or become applicability/compliance verdicts. |
| Evidence/discovery reuse before rule investigation | PARTIALLY_IMPLEMENTED | Root reloads accepted facts/evidence and decisions, then can page exact-pin discovery use cases, rule candidates, caveats and ranked ranges as non-authoritative investigation priorities. Expansion beyond those priorities now records an immutable exact-discovery event derived from the runtime trace; exact source still must be read/cited and automatic evidence compatibility remains pending. |
| Direct/indirect selective invalidation | IMPLEMENTED | New decisions persist exact evidence/fact edges; evidence invalidation follows direct and fact-mediated edges, dependency-incomplete history fails closed, human answers preserve unrelated dependency-complete decisions, and affected final reports become INVALID without changing historical bytes. |
| Reproducible quality/efficiency evaluation | PARTIALLY_IMPLEMENTED | Mechanical scanner/HITL tests exist; no pinned before/after corpus measures recommendation quality, source-range recall, question quality, evidence reuse or legal-regression accuracy. |

## Code Map

- `deepagents/instructions/inventory.json` and `deepagents/scripts/snapshot_instruction_migration.py` -- governed CI drift reconciliation.
- `apps/api/src/modules/assessment/application/commands/answer-human-request/*` -- answer evidence, integrity and fact acceptance.
- `apps/api/src/modules/assessment/application/services/assessment-evidence-invalidation.service.ts` and `apps/api/src/modules/assessment/domain/decision-dependencies.ts` -- normalized direct/indirect dependency integrity, selective invalidation, and fail-closed historical fallback.
- `apps/api/src/modules/assessment/infrastructure/persistence/assessment-human-request-dependencies.ts` and `apps/api/prisma/schema.prisma` -- request identity/dependencies and FactNeed persistence.
- `packages/contracts/src/assessment-domain/*` -- canonical value sets and DTO schemas.
- `deepagents/tools/common/capabilities/platform/repository_scanner.py` and `deepagents/assessment_root/*` -- relevance generation and bounded research context.
- `packages/contracts/src/assessment-domain/*`, `apps/api/prisma/schema.prisma`, and assessment application services -- durable discovery result, candidate recommendation state and compatibility projections.
- Existing evidence/fact/coverage persistence and Root governed tools -- discovery handoff and pin-compatible evidence reuse without a parallel authority store.
- `deepagents/middleware/approved_instructions.py` and governed EN/VI tool sources -- exact per-tool description fallback for newly registered Assessment tools without weakening unknown-tool fail-closed behavior.
- `apps/web/src/features/assessment-runtime/*` -- governed question controls/status presentation; preserve current local edits.
- `.github/workflows/*`, root/API package scripts and PR metadata -- actual CI commands, merge state and exact-SHA verification.

## Tasks & Acceptance

**Execution:**
- [x] Preserve local changes, reconcile `develop` on the existing branch, resolve conflicts, reconcile all changed instruction sites, review dispositions, establish baseline metrics, and restore Python/release-gate CI before the larger refactor.
- [x] Classify every discovery-first requirement as implemented, partial, missing or blocked against the current HEAD; record the reproducible baseline before behavioral changes.
- [x] Add versioned discovery contracts and additive persistence for pin-bound observed source facts, candidates, hypotheses, confirmed facts, unknowns, coverage gaps and cache identity while preserving direct selected-rule audits.
- [ ] Build deterministic AI use-case discovery and a two-dimensional RelevanceMap by reusing RepositoryProfile and Codebase Memory; include raw HTTP/custom providers, wrappers, indirect callers, source classification, verified reachability and controlled expansion.
- [x] Add explainable candidate AssessmentRule matching from verified findings and accepted facts without authorizing scope or emitting applicability/compliance verdicts.
- [ ] Reuse compatible discovery evidence/ranges and existing accepted evidence/facts before targeted rule-specific investigation; record why any expansion was required.
- [x] Design and test additive compatibility for existing HumanRequests, accepted facts, decisions, checkpoints and audit history before adding canonical FactNeed/value/proposal contracts and persistence.
- [x] Define FactNeed identity with tenant, assessment, subject/entity, predicate, operational scope, environment, timeframe and value schema as applicable; deduplicate wording/locales and union shared rule dependencies without cross-entity/time merging.
- [x] Refactor answer handling to persist raw evidence, validate/normalize, detect ambiguity/conflict, and create facts only after acceptance.
- [x] Replace answer-triggered case-wide invalidation with fail-closed traversal across direct/indirect evidence, facts, decisions and report findings while retaining history and caseRevision for CAS/audit.
- [ ] Reuse repository scanner and Codebase Memory to build rule-aware RelevanceMap priorities from AssessmentRule criteria/goals/evidence needs plus technology signals; cover DI/interfaces, jobs/events, dynamic config and unresolved edges with bounded traversal and explicit gaps.
- [ ] Separate file classification from verified reachability; preserve commit/scope/version cache pins and invalidate changed/renamed/deleted/new connections; use ranked ranges as priorities with audited expansion, never an absolute allowlist.
- [ ] Align backend/web control types and canonical EN/VI semantic policy without overwriting unrelated UI/i18n work.
- [ ] Add pinned before/after positive, negative, adversarial and regression fixtures covering AI and non-AI rules; measure recall, precision, false negatives, tokens, latency, memory, cache correctness, question quality and legal traceability; never claim unexecuted results.
- [ ] Run verified package/CI commands, document results, make logically grouped commits, push without force, and verify required checks on the exact PR #498 SHA.

**Acceptance Criteria:**
- Given the exact PR branch, when governed inventories and tests run, then every required check passes without bypasses.
- Given existing assessment records, when the additive schema and readers are deployed, then historical requests, facts, decisions, checkpoints and audits retain their original meaning and remain loadable/resumable.
- Given a clear, ambiguous, conflicting, unknown, replayed or stale human answer, when submitted, then only validated accepted facts affect decisions and existing transaction/checkpoint guarantees hold.
- Given equivalent FactNeeds across rules, wording or locale within the same tenant/assessment/entity/scope/environment/time/schema, when questions are opened, then one canonical need is reused; any material identity difference remains separate.
- Given an accepted fact/evidence changes, when invalidation runs, then all directly or indirectly dependent decisions/findings become stale, unrelated complete dependencies remain current, and uncertainty fails closed.
- Given pinned repositories and AssessmentRules, when investigation runs, then ranked ranges cover relevant AI and non-AI evidence, graph gaps/limits are explicit, reachability is not inferred from paths, cache invalidation is correct, pins/provenance remain intact, and audited expansion preserves recall.
- Given the pushed commit, when GitHub CI completes, then all required checks are green and the report records before/after metrics and residual risks.

## Spec Change Log

- 2026-11-16: Added the human-requested discovery-first workflow amendment, compatibility modes, durable discovery result, explainable rule recommendation boundary, evidence reuse order, cache evolution and measured evaluation requirements. Frozen intent remains unchanged.
- 2026-11-16: Recorded the green exact-HEAD CI baseline and the focused deterministic scanner regression baseline before discovery behavior changes.
- 2026-11-16: Implemented the first additive discovery slice: deterministic static AI-use-case signals, conservative source/reachability classification, explicit coverage/resource gaps, immutable pin-bound API persistence, leased Root submission, and a bounded non-authoritative discovery preview in the existing governed assessment context.
- 2026-11-16: Added API-owned deterministic candidate matching against the pinned AssessmentRules and ACCEPTED facts. Worker-authored recommendations are rejected, non-AI control terms remain matchable, missing matches never become negative legal conclusions, and candidate revisions remain immutable and non-authoritative.
- 2026-11-16: Added additive canonical FactNeed persistence and Root/API contracts. Historical HumanRequests remain nullable and uninterpreted; equivalent wording/locales and same-batch questions reuse one need, material deployment/timeframe/value differences remain distinct, and a known accepted answer resolves its linked need atomically while UNKNOWN remains open.
- 2026-11-16: Added typed FactNeed answer normalization for text, boolean, integer, number, date, date-time, enum and JSON values, and connected the existing high-impact ambiguity/conflict guard to production answer acceptance. Invalid values are rejected before case/fact/evidence mutation; accepted evidence retains both the raw and normalized value.
- 2026-11-16: Added an additive immutable decision dependency ledger. New decisions record exact evidence/fact edges; evidence invalidation traverses direct and fact-mediated support, historical decisions without a ledger fail closed, and unrelated dependency-complete decisions may survive a later case revision while caseRevision remains the CAS/audit clock. Active final reports are marked INVALID when their case/support changes.
- 2026-11-16: Exposed immutable repository-discovery details and ranked source ranges to Assessment Root through bounded exact-pin pages. The governed EN/VI contracts keep candidates/ranges non-authoritative, require exact source citation before evidence acceptance, preserve explicit gaps, and permit investigation beyond ranked priorities.
- 2026-11-16: Reused the pinned Codebase Memory graph to enrich discovered invocation symbols with bounded caller/callee priorities. Trace failures, ambiguity, empty results, row/output budgets and unsupported runtime edges remain explicit coverage gaps; static topology never upgrades production reachability.
- 2026-11-16: Added immutable, assessment-bound controlled-expansion audit events. Assessment Root derives redacted query digests, paths, result counts, truncation/failure gaps and deterministic idempotency from executed runtime trace; events grant no scope, evidence, reachability or legal conclusion.
- 2026-11-16: Completed the answer proposal boundary with additive immutable `AssessmentHumanFactProposal` records. Accepted proposals link the exact evidence/fact atomically; ambiguous/conflicting submissions remain pending, do not advance the case, and can be corrected at the next request revision without rewriting history.

## Reproducible Pre-Change Baseline — 2026-11-16

- Pushed PR HEAD: `caf06e5e3b611be2536111587cf5b7719b773bc9`.
- GitHub PR checks: all reported checks passed, including API checks/coverage/E2E/unit, Assessment Root vertical, Python worker checks/tests, Docker sandbox E2E, web checks/tests/build, CodeQL, dependency review, Trivy, SecureAI-Scan, Trustabl reliability and the V2 required release gate.
- Focused scanner command: `cd deepagents && uv run pytest tests/test_repository_scanner.py -q --durations=10`.
- Focused scanner result: `18 passed in 0.10s`.
- Interpretation: this is a mechanical compatibility baseline only. It does not measure source-range recall, rule-recommendation accuracy, legal correctness, tokens, or runtime investigation cost; no performance improvement is claimed from it.

## Phase 1 Verification — Discovery Artifact and Durable Handoff

- Scanner and Assessment Root regression: `167 passed` (`31` scanner, `136` Root).
- Focused API persistence/context/controller tests: `4` suites, `41` tests passed.
- Contracts: `12` suites, `147` tests passed.
- API lint, Prisma schema validation, contracts/API TypeScript compilation, Python compilation, contract-literal policy, business-logic documentation gates and `git diff --check`: passed.
- Governed instruction inventory: strict result `PASS`, zero unresolved mappings and zero missing English candidates.
- No quality, recall, precision, token, latency or legal-accuracy improvement is claimed yet; the reproducible evaluation corpus remains a later phase.

## Phase 2 Verification — Non-Authoritative Rule Candidates

- API-focused regression: `4` suites, `45` tests passed, including deterministic replay, accepted-fact recommendation revision, non-AI retention-control relevance, bounded preview, and rejection of worker-authored candidates.
- Contracts: `12` suites, `148` tests passed; scanner and Assessment Root regression: `167` tests passed (`31` scanner, `136` Root).
- API lint, contracts/API TypeScript compilation, Prisma validation, contract-literal policy, business-logic documentation gates and `git diff --check`: passed.
- Candidate states are limited by implementation to `CANDIDATE` or `NEEDS_CONTEXT`; every candidate is `authorizesAssessment=false`. No rule is automatically emitted as `NOT_SELECTED`, `SELECTED`, or a legal applicability/compliance outcome.
- Candidate matching is deterministic lexical engineering prioritization over current discovery ranges/use cases and accepted facts. Cross-file rule-targeted expansion, legal actor/scope resolution and measured recommendation recall/precision remain later work; no performance or legal-accuracy improvement is claimed.

## Phase 3 Verification — Canonical FactNeed Compatibility

- Additive migration keeps `AssessmentHumanRequest.factNeedId` nullable, performs no historical UPDATE/DELETE/DROP, and adds assessment-bound foreign keys, lifecycle checks and an immutable semantic-identity guard. Migration static compatibility tests: `3 passed`; Prisma schema validation passed. A live PostgreSQL migration could not run locally because Docker/PostgreSQL was unavailable.
- FactNeed identity regression covers casing/wording reuse and separation across tenant owner, assessment, deployment and timeframe. Focused API/compatibility regression: `8` suites, `81` tests passed; contracts: `13` suites, `152` tests passed.
- Root and governed instruction regression: `184` tests passed; strict inventory result `PASS`, with zero unresolved paths and no missing VI/EN sources. API lint, contracts/API TypeScript compilation, Prisma validation, contract-literal policy, business-logic documentation gates and `git diff --check` passed.
- The repository-wide API command completed `219` suites / `1857` tests successfully, with `22` suites skipped. Its remaining `12` failing integration suites (`108` tests) require PostgreSQL at `127.0.0.1:55432`; the one non-database route-allowlist failure was corrected and its `4` tests pass. These are not reported as a green full-suite result.
- This phase does not yet implement raw-answer proposal/review, typed normalization/conflict acceptance, selective dependency invalidation or measured efficiency/legal-accuracy improvements.

## Phase 4 Verification — Typed Answer Acceptance Guard

- Focused answer regression: `3` suites, `33` tests passed, covering every FactNeed value kind, invalid/unsafe numeric and temporal forms, raw-plus-normalized evidence, UNKNOWN behavior, ambiguity, prior-human-fact conflict and atomic FactNeed resolution.
- Contracts: `13` suites, `153` tests passed, including historical answer audits without `normalizedAnswer`; the new field is optional and does not reinterpret stored answer history.
- API lint, contracts/API TypeScript compilation, contract-literal policy, business-logic documentation gates and `git diff --check` passed.
- Rejected ambiguous/conflicting answers currently return `HUMAN_ANSWER_INVALID` before persistence. Durable raw rejected-attempt/proposal review and explicit reviewed acceptance remain pending, so the full proposal pipeline task is intentionally not marked complete.

## Phase 5 Verification — Dependency-Selective Invalidation

- The migration is additive: historical decisions default to `dependencyGraphComplete=false`, no historical JSON packet is backfilled or reinterpreted, and exact evidence/fact edges use assessment-bound foreign keys. The completeness marker is immutable after decision creation.
- New accepted decisions atomically persist their deduplicated direct evidence and fact references. Evidence invalidation follows direct edges plus evidence -> fact -> decision edges; any accepted historical decision with incomplete dependency metadata is invalidated fail-closed instead of being assumed unrelated.
- Human answer acceptance no longer invalidates every older accepted decision. Rules affected by the question were already invalidated when the request opened; unrelated older decisions survive only when their persisted ledger exactly matches the immutable packet and current evidence/facts still validate. Generic facts without a declared rule scope retain case-wide fail-closed invalidation.
- Any case-changing human answer invalidates an ACTIVE final-report projection; evidence invalidation does the same when it invalidates a supporting decision. Artifact bytes, hashes, pins, decisions, and audit history remain unchanged.
- Focused dependency, decision, answer, completion, selected-finalization, audit-reuse and migration regression: `9` suites, `114` tests passed. API lint, TypeScript compilation, Prisma validation, contract-literal policy, business-logic documentation gates, and `git diff --check` passed.
- The repository-wide API command completed `224` suites / `1887` tests successfully, with `22` suites skipped. Its remaining `12` failing integration suites (`108` tests) all report PostgreSQL `P1001` at `127.0.0.1:55432`; no non-database suite failed. A live migration remains unverified locally for the same environment reason.

## Phase 6 Verification — Governed Discovery Reuse Handoff

- Assessment Root, HITL/checkpoint, source-scope and locale regression: `159` tests passed. This includes exact-pin discovery range/detail paging, the complete Root tool surface, native human interrupts, checkpoint recovery, source-scope isolation and rejection of invalid tool arguments.
- Governed instruction inventory/lifecycle/runtime-bundle regression: `40` tests passed. The strict inventory verifier completed successfully after mapping the two new promoted tool descriptions to their exact EN/VI per-tool sources.
- The runtime instruction boundary resolves a newly registered Assessment tool from its exact governed per-tool entry only when the legacy aggregate catalog lacks that name. Unknown tools still fail closed; a regression covers this path.
- Discovery ranges, use cases and rule candidates remain investigation priorities only. They do not authorize audit scope, establish applicability/compliance, or become accepted evidence until the exact pinned source is read and cited. No source-recall, latency, token or legal-accuracy improvement is claimed from this mechanical handoff.
- Durable recording of controlled expansion reasons/resource use is still pending, so the broader evidence-reuse task remains partially implemented.

## Phase 7 Verification — Bounded Codebase Memory Enrichment

- Focused repository scanner regression: `35` tests passed, including caller/callee enrichment, graph-query failure, trace-budget truncation, exact cache-pin persistence and reuse.
- Assessment Root, Codebase Memory lifecycle and repository sandbox regression: `200` tests passed. Instruction inventory/tool lifecycle regression: `46` tests passed with strict inventory result `PASS`, zero unresolved paths and no missing EN/VI sources.
- Each graph trace is bounded to 50 unique invocation symbols per discovery, depth 3, 100 rows and a 4,000-token output budget. Exact graph totals and truncation metadata are checked; excess or unrecognized results become explicit gaps instead of absence claims.
- Codebase Memory output supplies investigation priorities only. `reachability` remains `NOT_ESTABLISHED`; dependency injection, interfaces, async jobs, events, dynamic configuration and deployed runtime use remain unresolved until separately verified.
- The scanner source signature changed while `LCSP_DISCOVERY_V1` stayed stable. Exact scanner-signature and graph-index pins therefore refresh old cache artifacts without introducing a V2 contract or reinterpreting historical discovery records.
- Business-logic documentation gates, contract-literal policy, Python compilation and `git diff --check` passed. Ruff and graphify remain unavailable in the local environment; no performance, recall, precision, token, latency or legal-accuracy improvement is claimed.

## Phase 8 Verification — Audited Controlled Expansion

- Added an additive `AssessmentRepositoryDiscoveryExpansion` model and migration. Each immutable event is bound to assessment, discovery record, discovery content digest and an assessment-scoped idempotency key; no existing discovery, decision, evidence or audit row is rewritten.
- Root expansion records are derived from executed repository-tool trace without consuming the later search-coverage trace. Raw search terms and source bytes are excluded; the API receives bounded query digests, paths, counts and explicit truncation/failure/dropped-trace gaps.
- The API revalidates current repository pins, authorized rule coverage and the complete discovery digest, rejects foreign priority ranges, and compares the full canonical semantic packet on replay. Reusing an idempotency key for different content fails with an idempotency conflict.
- Focused API/controller/migration regression: `3` suites, `19` tests passed. Discovery contract regression: `6` tests passed. Assessment Root regression: `139` tests passed, including redaction, trace preservation and rejection of untraced model claims. Governed inventory/runtime workflow regression: `31` tests passed.
- API build, Prisma validation, targeted API lint, business-logic documentation gates, Python compilation and `git diff --check` passed. A live PostgreSQL migration remains unverified locally; Ruff and graphify are unavailable. No performance, recall, precision, token, latency or legal-accuracy improvement is claimed.

## Phase 9 Verification — Durable Human Fact Proposals

- Added an additive immutable `AssessmentHumanFactProposal` ledger. Historical HumanRequests, answer JSON, accepted evidence/facts, decisions and checkpoints are not backfilled or reinterpreted; proposal metadata in answer contracts is optional for historical compatibility.
- Every non-unknown answer that passes schema/typed normalization creates one proposal bound to assessment, request, FactNeed when present, case/request revision, native checkpoint, actor, request digest and idempotency key. `ACCEPTED` proposals must reference both accepted evidence and fact; `PENDING_REVIEW` proposals must contain a typed guard failure and cannot reference accepted authority.
- Ambiguous and conflicting material answers now return a successful unresolved receipt with `PENDING_REVIEW`, keep the request open, leave `caseRevision` unchanged, create no evidence/fact, and do not resume Root. Exact replay returns the same proposal; a corrected answer at the next request revision creates a new accepted proposal without mutating the pending record.
- Human-answer normalization/integrity/controller/proposal-migration regression: `5` suites, `46` tests passed. Focused FactNeed contract regression: `6` tests passed. API build, Prisma validation, targeted lint, business-logic documentation and contract-literal gates passed.
- A live PostgreSQL migration and browser presentation of the new pending-review receipt remain unverified. No legal conclusion, operational fact or compliance authority is derived from a pending proposal.

## Design Notes

Use API-owned typed state for semantic identity and acceptance; models propose but never directly establish authority. Preserve the current Root/checkpoint boundary for this PR. Relevance combines rule-specific evidence goals with technology signals and existing graph/index data; traversal budgets produce explicit coverage gaps rather than absence claims or invented confidence.

## Verification

**Commands:**
- `cd deepagents && pytest` -- full Python worker suite passes.
- `pnpm --filter @lcsp/api test` -- API unit/integration regressions pass.
- `pnpm --filter @lcsp/api test:e2e` -- API E2E regressions pass against the disposable database.
- `pnpm run test:web` -- web regressions pass.
- `pnpm run check:business-logic-docs && pnpm run test:business-logic-docs` -- changed business logic is documented.
- `pnpm run check:contracts` -- contract value-set policy passes.
- `git diff --check` -- patch integrity passes.
- `gh pr checks 498 --watch` -- required checks pass on the exact pushed SHA.
