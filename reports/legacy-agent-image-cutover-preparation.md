# Legacy agent/image cutover preparation ledger

Status: **PREPARATION ONLY — production, image, and remote-CI gates NOT_PROVEN**
Snapshot: agentic-prod-integration, HEAD 5cc2ea8da4a93535e059c40bc195274cc9c2098c, inspected 2026-10-06.
Ownership: this report only. No production source, container file, lockfile, test, fixture, contract, API, web, i18n, entrypoint, lifecycle, image, worker, queue, database, or user change was edited.

This is a current source/container/CI reference ledger for four bounded legacy paths:

1. Legal Rule Triage.
2. Model-driven repository Scanner (the current implementation is RepositoryDeepAnalyzer; there is no current subagents/scanner directory in the inspected source).
3. Direct per-rule Repository Analyst dispatch.
4. Assessment Interview agent and its recovery/skill assets.

DEAD-DELETE below is only a classification for a later removal candidate. It is not permission to delete it now. W2–W5 replacement gates, W6 quiescence/archive/cutover, and W7 retention/removal remain required. W1.1 is the only accepted dependency used for gate context; this preparation does not consume or accept W1.3.

## Evidence rules and classification

The codebase-memory graph was used first for bounded discovery. Its fast index reported 17,633 nodes and excluded directories including docs, scripts, frozen, several test/fixture trees, packages/i18n, node_modules, dist, and graphify-out. Graph results therefore route discovery only: every reference below was checked against the current checkout, and a graph no-match is never treated as source or image absence. Existing freeze/inventory reports are cited only for future gate ownership; their historical findings are not current proof.

| Classification | Meaning in this ledger |
|---|---|
| ACTIVE REQUIRED | Current source is registered, imported, dispatched, copied into a runtime image, or required by a current test/contract. It remains until its named replacement gate passes. |
| HISTORICAL-VOCABULARY ONLY | A current text/comment/fixture/doc reference preserves old terminology but is not an execution registration in this bounded surface. It may still be shipped or CI-visible and must not be mistaken for proof that runtime removal is complete. |
| DEAD-DELETE | No current consumer was found in the inspected scope and the path is a later deletion candidate. This status is not a deletion instruction and is not assigned to any active four-path runtime asset in this snapshot. |
| COMPATIBILITY WITH IDENTIFIED CONSUMER | The reference is not the legacy agent implementation itself, but an identified current consumer such as a scheduler script, API/web projection, frozen comparison, absence guard, or CI path filter. The consumer must be migrated or explicitly retained before removal. |

## Current findings

| Legacy path | Current source truth | Current classification | Replacement owner/gate |
|---|---|---|---|
| Triage | Registered in the specialist flow, root task surface, legal-readiness boundary, singleton lifecycle, legal tools, scheduled prompt, and warm/export scripts. | ACTIVE REQUIRED | W2 Legal Preparation authority; W6 quiesce/archive old legal traffic; W7 source/image absence and removal. |
| Model Scanner | No separate scanner subagent was found. The current model call is RepositoryDeepAnalyzer behind RepositoryAnalysisBoundary, registered on the scan command and streamed as stage scanner. | ACTIVE REQUIRED | W3 Root investigation/source tooling and W4 bounded absence/evidence gate; W6 traffic quiescence; W7 hard deletion after proof. |
| Direct per-rule Repository Analyst | FLOW_SUBAGENTS and RootSubagentDispatcher still dispatch one repository-analyst for each rule through the Python loop. | ACTIVE REQUIRED | W3 native bounded generic Repository Researcher task; W4 Root coverage/finalization; W6 traffic zero; W7 removal. |
| Interview | Initial and targeted/resume Interview dispatches remain registered, persisted, streamed, and covered by the production vertical and frozen skill comparison. | ACTIVE REQUIRED | W3 Root startup and same-thread Human Resolution; W4 HITL/completion; W5 API/web/browser cutover; W6 archive; W7 removal. |

## 1. Legal Rule Triage ledger

| Exact current reference | What the reference does | Classification | Gate/owner |
|---|---|---|---|
| deepagents/subagents/__init__.py:8-19 | Imports Interview, Repository Analyst, and Triage definitions and places all three in FLOW_SUBAGENTS. | ACTIVE REQUIRED | W2 replaces the legal specialist authority; W7 removes this registration after W2–W6. |
| deepagents/subagents/triage/definition.py:1-23,149-163 | Defines the triage specialist, legal skill, bounded legal tools, response format, progress middleware, role middleware, and governance middleware. | ACTIVE REQUIRED | W2 Legal Preparation owner. |
| deepagents/agent.py:26,29,86-99 | Root agent imports the Triage definition and exposes it as the only legal-maintenance specialist subagent. | ACTIVE REQUIRED | W2 root/legal-preparation cutover. |
| deepagents/orchestration/dispatcher.py:41-56,58-180 | Builds the default FLOW_SUBAGENTS registry and dispatches the selected specialist; Triage has a special recursion limit. | ACTIVE REQUIRED | W2 dispatcher ownership; W7 remove old dispatch path. |
| deepagents/orchestration/lifecycle.py:14,38-140 | Owns the global Triage singleton reservation, completion, abandonment, and lifecycle event payloads. | ACTIVE REQUIRED | W2 legal-preparation lifecycle; W6 drain/archive. |
| deepagents/middleware/triage_singleton.py:19-149 | Guards root task calls so only one Triage execution can claim the singleton. | ACTIVE REQUIRED | W2 replacement must own equivalent concurrency semantics before deletion. |
| deepagents/middleware/triage_progress.py:11-73 | Requires the three legal Triage progress tools and constrains the specialist request sequence. | ACTIVE REQUIRED | W2 tool/eval gate. |
| deepagents/tools/common/capabilities/agent_runtime/invocation.py:80-85,181-185,204-217 | Registers legal_rule_triage_requested to LegalRuleTriageBoundary; the manifest also assigns stream stage/boundary execution. | ACTIVE REQUIRED | W2 command/event replacement; W6 queue drain. |
| deepagents/tools/triage/legal_rule_triage/boundary.py:19-87 | Adapts ENGINEERING_RULE_NOT_READY to a Root triage dispatch and preserves waiting-assessment reconciliation. | ACTIVE REQUIRED | W2 automatic legal preparation; W6 obsolete command drain. |
| deepagents/tools/triage/legal_rule_triage/contracts.py:1-4 | Defines command.legal-rule-triage.requested.v1 and the assessment resume source event. | ACTIVE REQUIRED | W2 contract replacement; W7 old export removal. |
| deepagents/tools/triage/legal_rule_triage/code.py:1-7,145-203 | Exposes work-item, persist-result, and finish-execution tools to the Triage specialist. | ACTIVE REQUIRED | W2 legal-preparation tool boundary. |
| deepagents/tools/triage/legal_rule_triage/service.py:1-5,22-228 | Loads approved legal sources, validates bounded Triage output, persists READY EngineeringRules, and finishes the singleton batch. | ACTIVE REQUIRED | W2 sole legal portfolio/preparation owner. |
| deepagents/tools/triage/legal_rule_triage/singleton.py:31-227 | Implements the file/state-lock singleton, scope claim, progress, and release behavior. | ACTIVE REQUIRED | W2 replacement concurrency gate; W6 archive. |
| deepagents/schedules/legal_catalog_daily.py:3-35 | Stores the scheduled legal-maintenance prompt directing the Triage flow. The bounded search found its current direct test consumer at deepagents/tests/test_deep_agent_project.py:48-62; no production importer was found in this scoped search. | COMPATIBILITY WITH IDENTIFIED CONSUMER | W2 scheduler/prompt owner must replace or retire it explicitly. |
| scripts/warm_engineering_rules.py:1-11,28,34-42,107-125 | Manual warm-up imports LegalRuleTriageService, dispatches triage, and drains the singleton. | COMPATIBILITY WITH IDENTIFIED CONSUMER | W2 operational replacement; do not run as a cutover action here. |
| scripts/export_precompiled_engineering_rules.py:1-11,41-42,79,147-171 | Reads Triage recovery artifacts and exports the precompiled EngineeringRule bundle. | COMPATIBILITY WITH IDENTIFIED CONSUMER | W2 live portfolio replaces bundle authority; W6 archive/image cleanup. |
| deepagents/config/model_routes.yaml:18-30 | Keeps triage and legal compiler/triage model roles in the shipped route table. | ACTIVE REQUIRED | W2 route ownership; W7 remove only after no consumer remains. |
| deepagents/tests/test_deep_agent_subagent_contract.py:20-35,87-95 and deepagents/tests/test_deep_agent_flow_boundaries.py:18-35,116-146,196-239 | Assert Triage registration, tool isolation, and legal boundary contracts. | ACTIVE REQUIRED | W2 replacement tests must pass before removal. |
| deepagents/tests/test_root_orchestration_dispatcher.py:64-228,282-414 | Exercises Triage lifecycle/dispatch, singleton behavior, failure release, and handoff validation. | ACTIVE REQUIRED | W2 dispatcher gate. |
| deepagents/tests/test_legal_rule_triage_boundary.py:1-8, deepagents/tests/test_legal_rule_triage_control_flow.py:14-21,639, and deepagents/tests/test_legal_rule_triage_singleton.py:5 | Directly import and test the Triage boundary, tools, service, and singleton. | ACTIVE REQUIRED | W2 replacement test ownership. |

### Triage distinction

The current legal Triage service is not itself an LLM: service.py:1-5 says the Deep Agent reasons while the service validates and persists. The retiring target is the Triage specialist/boundary/tool path, not the legal portfolio data model or source integrity rules. W2 must identify the replacement owner for those responsibilities before any DEAD-DELETE decision becomes actionable.

## 2. Model Scanner ledger

### Current model-driven Scanner registration and call chain

| Exact current reference | What the reference does | Classification | Gate/owner |
|---|---|---|---|
| deepagents/tools/common/capabilities/agent_runtime/invocation.py:49-55 | Registers scan_requested to RepositoryAnalysisBoundary on command.scan.requested.v1. | ACTIVE REQUIRED | W3 Root investigation/source tooling. |
| deepagents/tools/common/capabilities/agent_runtime/invocation.py:181-185 | Maps scan and targeted-reanalysis boundaries to AGENT_STREAM_STAGES["scanner"]. | ACTIVE REQUIRED | W3/W4 stream/evidence ownership; W5 consumer cutover. |
| deepagents/tools/common/capabilities/evidence/repository_analysis/boundary.py:27-47,49-123 | Starts repository_deep_analysis, invokes the analyzer, emits the ai_discovery callback, and returns the evidence payload. | ACTIVE REQUIRED | W3 Root investigation boundary; W4 bounded absence gate. |
| deepagents/tools/common/capabilities/evidence/repository_analysis/analyzer.py:1-37,71-136 | Defines RepositoryDeepAnalyzer, bounded AI discovery, AI_UNKNOWN, and AI_DISCOVERY_FAILED behavior. | ACTIVE REQUIRED | W3 replaces model-driven Scanner reasoning while preserving deterministic repository preparation and evidence guards. |
| deepagents/tools/common/capabilities/evidence/repository_analysis/analyzer.py:138-190 | Resolves the repository-analyst model role, creates ai-discovery-analyst, applies budget/governance middleware, and invokes model tools at stream stage scanner. | ACTIVE REQUIRED | W3/W4 replacement gate. This role name is shared with the per-rule analyst but this is a separate model entrypoint. |
| deepagents/tools/common/capabilities/evidence/repository_analysis/analyzer.py:193-316,319-460 | Materializes the discovery evidence payload and applies the deterministic absence backstop; a provider failure remains AI_UNKNOWN plus AI_DISCOVERY_FAILED. | ACTIVE REQUIRED | W4 evidence/absence acceptance; no semantic authority may be inferred from the backstop. |
| deepagents/tools/common/capabilities/evidence/repository_analysis/targeted_boundary.py:1,27-31,63-87,89-219,321-324 | Registers targeted reanalysis and routes its bounded rule scope into the current assessment path; the legacy scopes stay readable comment is compatibility input, not proof of old execution. | ACTIVE REQUIRED | W3/W4 same-thread invalidation/research replacement; W6 request/archive. |
| packages/contracts/src/evidence/ai-discovery.ts:66-79,99-117 | Ships the AI-discovery evidence shape and AI_DISCOVERY_FAILED limitation used by current boundary/API consumers. | ACTIVE REQUIRED | W3/W4 contract owner. |
| deepagents/config/model_routes.yaml:18-30 | Supplies the current repository-analyst route used by RepositoryDeepAnalyzer. | ACTIVE REQUIRED | W3 route owner; shared route cannot be removed while the per-rule analyst still consumes it. |
| scripts/check-agentic-tool-runtime.mjs:34-41 | Explicitly expects retired program_graph_tool_entrypoints.py and scanner_tool_entrypoints.py to be missing. | COMPATIBILITY WITH IDENTIFIED CONSUMER | Keep as a scoped absence guard; it does not prove the model Scanner or whole image is absent. Update only after W3/W7 replacement evidence. |
| deepagents/tests/test_repository_deep_analyzer.py:18-73,119-162,188-300,444-534,547-660 | Tests the current analyzer, structured output, bounded absence, governance, provider failure, and evidence payload behavior. | ACTIVE REQUIRED | W3/W4 replacement tests. |

### Scanner naming that is not a second runtime asset

The inspected source has no deepagents/subagents/scanner or ModelScanner registration. The current Scanner behavior is the analyzer path above, while scanner also names durable stage/projection vocabulary. These are distinct references and must not be conflated:

| Exact current reference | Classification | Why it remains |
|---|---|---|
| packages/contracts/src/evidence/assessment-runtime.ts:365-379,440-481 | COMPATIBILITY WITH IDENTIFIED CONSUMER | Contracts describe repository-analyst progress and the scanner, interview, ruleAnalysis, and gate projections. W5 owns consumer cutover. |
| apps/api/src/platform/runtime-events/stage-lifecycle.ts:10-18,65-105,107-155,169-205 | COMPATIBILITY WITH IDENTIFIED CONSUMER | API derives stage projection from durable scan/evidence/interview/rule artifacts; it is not the model Scanner registration. W5 owns its canonical projection cutover. |
| apps/web/src/features/workspace/utils/agent-stream-stages.ts:20-33,66-103 | COMPATIBILITY WITH IDENTIFIED CONSUMER | Web groups the current event stream by Scanner/Interview/rule-analysis stages. W5 browser/API acceptance is required. |
| apps/web/src/features/workspace/utils/assessment-runtime-selectors.ts:154-223,234-245 | COMPATIBILITY WITH IDENTIFIED CONSUMER | Web sidebar projects Scanner and Interview rows from API-backed state. Do not delete as part of a Python image change. |
| packages/i18n/src/locales/en/pages.ts:192,276-282,435-436,1650-1651,1738-1746,1817 and packages/i18n/src/locales/vi/pages.ts:194,278-284,436-437,1652-1653,1739-1748,1818 | COMPATIBILITY WITH IDENTIFIED CONSUMER | Current customer copy still names Scanner and its dependency on Interview. W5 i18n owner must cut over copy and keys. |
| apps/web/tests/agent-stream-stages.test.ts:74-120,295-375,615-639 and apps/web/tests/assessment-repository-flow.test.ts:162-341,389-390 | ACTIVE REQUIRED | Current web tests assert stage and Scanner activity behavior. They are not proof that the model asset is image-absent. |

The explicit missing-entrypoint guard is the only bounded DEAD-DELETE-like Scanner evidence found, but the guard itself is a live compatibility consumer. No current production Scanner reference qualifies as DEAD-DELETE in this snapshot.

## 3. Direct per-rule Repository Analyst ledger

| Exact current reference | What the reference does | Classification | Gate/owner |
|---|---|---|---|
| deepagents/subagents/__init__.py:8-19 | Registers the Repository Analyst definition in FLOW_SUBAGENTS. | ACTIVE REQUIRED | W3 native Researcher replacement. |
| deepagents/subagents/repository_analyst/definition.py:1-26,30-72 | Defines the one-task/one-EngineeringRule Repository Analyst prompt, graph/evidence tools, response contract, and repository-analyst middleware. | ACTIVE REQUIRED | W3 generic bounded Repository Researcher task. |
| deepagents/orchestration/dispatcher.py:41-56,58-180 | Makes the flow registry dispatchable and builds a Deep Agent for the requested specialist. | ACTIVE REQUIRED | W3 dispatcher replacement/removal. |
| deepagents/tools/common/capabilities/assessment/rule_assessment/run.py:1-6,59,154-244 | Defines analyze_rule; each loop iteration dispatches subagent_type=repository-analyst with exactly one rule and reads the persisted result. | ACTIVE REQUIRED | W3/W4 Root owns coverage/finalization; W7 delete after traffic zero. |
| deepagents/tools/common/capabilities/assessment/investigation/engineering_rule/engineering_assessment_boundary.py:72-107,226-333 | Owns the deterministic Python per-rule loop and calls analyze_rule through a dispatcher. | ACTIVE REQUIRED | W3 Root loop replacement; W4 semantic decision gate. |
| deepagents/tools/common/capabilities/assessment/investigation/engineering_rule/engineering_assessment_boundary.py:305-307 | Explicitly documents the sequential per-rule orchestration. | HISTORICAL-VOCABULARY ONLY | The comment is not execution by itself, but the enclosing loop remains active until W3/W4. |
| packages/contracts/src/evidence/rule-assessment.ts:3-7 | Contract comment names the repository-analyst producer and accepted-evidence ledger. | COMPATIBILITY WITH IDENTIFIED CONSUMER | W3 contract/producer update; preserve accepted evidence shape unless gate changes it. |
| deepagents/tools/common/capabilities/evidence/repository_analysis/analyzer.py:71-82,147-162 | Uses the same model route name for the separate scan-time AI-discovery agent. | COMPATIBILITY WITH IDENTIFIED CONSUMER | Do not treat removal of direct per-rule dispatch as permission to remove scan-time route before W3. |
| deepagents/tests/test_deep_agent_subagent_contract.py:212-229 | Verifies the compact/governed Repository Analyst prompt. | ACTIVE REQUIRED | W3 replacement test. |
| deepagents/tests/test_root_orchestration_dispatcher.py:236-266,424-434 | Verifies direct Repository Analyst dispatch and specialist factory registration. | ACTIVE REQUIRED | W3 dispatcher gate. |
| deepagents/tests/test_assessment_interview_runtime_e2e.py:32-33,267-398 and deepagents/tests/test_repository_sandbox.py:398 | Import the current specialist and exercise direct dispatch/sandbox isolation. | ACTIVE REQUIRED | W3/W4 replacement coverage. |

The current API/web display contract is downstream compatibility, not deletion authority: packages/contracts/src/evidence/assessment-runtime.ts:365-379 describes rule-analysis counts emitted by this loop, and the API/web projection consumers must be cut over under W5 before removing their vocabulary.

## 4. Assessment Interview ledger

| Exact current reference | What the reference does | Classification | Gate/owner |
|---|---|---|---|
| deepagents/subagents/__init__.py:8-19 | Imports the Interview definition into FLOW_SUBAGENTS. | ACTIVE REQUIRED | W3 Root startup/Human Resolution replacement. |
| deepagents/subagents/interview/__init__.py:1-5 | Exports the Interview subagent definition. | ACTIVE REQUIRED | W3/W7. |
| deepagents/subagents/interview/definition.py:1-30,32-128,130-150 | Loads the interview-context skill package, defines the customer-safe Interview prompt, disables repository tools, and registers the interview specialist. | ACTIVE REQUIRED | W3 Root/Human Resolution replacement; W5 customer/browser proof. |
| deepagents/tools/common/capabilities/agent_runtime/invocation.py:63-78,181-185,204-217 | Registers initial engineering assessment plus resume/pause/recovery boundaries and maps resume stream events to interview. | ACTIVE REQUIRED | W3 same-thread replacement; W5 API/SSE cutover; W6 outbox drain. |
| deepagents/tools/common/capabilities/assessment/investigation/engineering_rule/interview_gated_boundary.py:46-93,95-143 | Starts the decision-before-downstream Interview gate, reads discovery/coverage, and handles AI absence/unknown limitations. | ACTIVE REQUIRED | W3/W4 Root evidence and Human Resolution gate. |
| deepagents/tools/common/capabilities/assessment/investigation/engineering_rule/interview_gated_boundary.py:271-317 | Dispatches the initial Interview with subagent_type=interview, metadata, and interview:{assessment_id} thread. | ACTIVE REQUIRED | W3 one Root/same-thread replacement; W6 quiescence. |
| deepagents/tools/common/capabilities/assessment/investigation/engineering_rule/interview_gated_boundary.py:605-714,773-820 | Builds the Interview handoff and enforces INITIAL_INTERVIEW before current per-rule analysis. | ACTIVE REQUIRED | W3/W4 startup and decision gate. |
| deepagents/tools/common/capabilities/workflow/recovery/interview_boundary.py:618-655 | Defines the persisted Interview resume command and AssessmentInterviewResumeBoundary. | ACTIVE REQUIRED | W3 same-thread Human Resolution; W5 API/SSE; W6 archive. |
| deepagents/tools/common/capabilities/workflow/recovery/interview_boundary.py:791-819,926-1029 | Loads safe projection/runtime context and dispatches the resume Interview with subagent_type=interview. | ACTIVE REQUIRED | W3/W4 resume gate; W6 request/queue drain. |
| packages/contracts/src/assessment/events.ts:8-13 | Ships Interview answer, pause, and resume command/event values. | COMPATIBILITY WITH IDENTIFIED CONSUMER | W5 canonical API/event cutover. |
| packages/contracts/package.json:46-55 | Exports the assessment-interview evidence contract to API/web consumers. | COMPATIBILITY WITH IDENTIFIED CONSUMER | W5 contract owner. |
| deepagents/tests/test_interview_context_skill.py:17-46,77-107,110-138 | Directly loads the current skill package and byte-compares it to frozen/interview-agent-frozen/.... | COMPATIBILITY WITH IDENTIFIED CONSUMER | W3 replacement skill/tool owner; frozen comparison must be retired or re-pointed deliberately. |
| .github/workflows/test.yml:34-78 | Includes frozen/interview-agent-frozen/** in API/web/Python/release-gate path filters. | COMPATIBILITY WITH IDENTIFIED CONSUMER | CI owner must update path filters after W3/W5. |
| .github/workflows/test.yml:367-455 | Runs the Production Interview vertical and tests/test_assessment_interview_production_vertical.py. | ACTIVE REQUIRED | W5 browser/API production vertical replacement gate. |
| apps/api/test/assessment-interview.e2e-spec.ts:235-719 | Current API e2e consumer exercises private context, initial question, and Interview agent decisions. | COMPATIBILITY WITH IDENTIFIED CONSUMER | W5 API cutover; do not remove with worker source. |
| apps/web/tests/pipeline-continue.test.ts:1-10 and apps/web/tests/post-finding-flow-components.test.ts:340 | Current web tests consume the assessment-interview client/projection. | COMPATIBILITY WITH IDENTIFIED CONSUMER | W5 web/browser owner. |
| packages/i18n/src/locales/en/pages.ts:1738-1746,1817 and packages/i18n/src/locales/vi/pages.ts:1739-1748,1818 | Current customer copy names the Interview state and Scanner prerequisite. | COMPATIBILITY WITH IDENTIFIED CONSUMER | W5 i18n owner. |

## 5. Container, packaging, lock, and deploy references

The image boundary is broad: each runtime Dockerfile copies the whole deepagents directory. Removing an import from a Python graph is therefore not equivalent to removing its files from the image. Conversely, deepagents/pyproject.toml:46-50 lists only tools and runtime as wheel packages, while the Dockerfiles copy the full source tree; a wheel package list alone cannot establish image absence.

| Exact reference | Current behavior | Classification |
|---|---|---|
| deepagents/Dockerfile:8-17,21-25 | Copies deepagents wholesale, copies the precompiled EngineeringRule bundle, installs /app/deepagents, and starts entrypoint.py. | ACTIVE REQUIRED |
| deepagents/Dockerfile.dev:19-34,38-43 | Installs from deepagents/pyproject.toml/uv.lock with uv sync --frozen, then copies deepagents wholesale. | ACTIVE REQUIRED |
| deepagents-langgraph/Dockerfile:10-24,28-39 | Installs the frozen runtime, copies the precompiled bundle and whole deepagents tree, and starts the production local server. | ACTIVE REQUIRED |
| .dockerignore:18-24 | Excludes reports/* but re-includes the precompiled rule bundle and legal PDFs used by the production build context. | COMPATIBILITY WITH IDENTIFIED CONSUMER |
| deepagents/pyproject.toml:6-29,31-37 | Keeps shared runtime, LangChain/LangGraph, RabbitMQ (pika), Chroma, and dev-test dependencies. These are not per-agent deletion evidence. | ACTIVE REQUIRED |
| deepagents/pyproject.toml:46-50 | Wheel package selection is only tools and runtime; the Docker source copy is broader. | COMPATIBILITY WITH IDENTIFIED CONSUMER |
| deepagents/uv.lock:491-510,634-650,1491-1503,1533-1550,1596-1610,1671-1695,2503-2510,2838-2850 | Pins shared packages (chromadb, deepagents, LangChain/LangGraph, pika, pydantic). No legacy agent module path appears in the lockfile. | ACTIVE REQUIRED for shared dependencies; HISTORICAL-VOCABULARY ONLY is not a valid lockfile-absence conclusion. |
| .fogewise/deploy.yml:12-31 | Deploys both deepagents-langgraph (agent-runtime-server) and deepagents (agent-runtime) services; the server receives LCSP_REPOSITORY_SANDBOX_IMAGE. | ACTIVE REQUIRED |
| scripts/run.mjs:248-263,753-793 | Builds the development worker image, runs it, and states that model routes ship inside the worker image. | ACTIVE REQUIRED |
| .github/workflows/test.yml:352-365 | Builds both Docker images and runs sandbox/local-runtime/production-image e2e tests. | ACTIVE REQUIRED |
| .github/workflows/fogewise-deploy.yml:157-185 | Resolves Fogewise service paths and invokes docker buildx build ... --push. This was read only and was not run. | ACTIVE REQUIRED |

The lockfile contains dependency pins, not a manifest of triage, interview, repository_analyst, or RepositoryDeepAnalyzer files. The absence of those names from uv.lock is expected and is not an image absence proof.

## 6. CI/test invocation matrix

| Exact reference | Current invocation/consumer | Classification |
|---|---|---|
| .github/workflows/test.yml:34-78 | Changes in deepagents/**, deepagents-langgraph/**, frozen Interview assets, scripts, contracts, i18n, and tests select Python/release-gate jobs. | ACTIVE REQUIRED |
| .github/workflows/test.yml:303-327 | Installs deepagents editable, validates langgraph.json as ./agent.py:agent, imports agent, then runs the complete Python pytest suite. | ACTIVE REQUIRED |
| .github/workflows/test.yml:329-365 | Builds the dev and production runtime images and runs four runtime/sandbox e2e suites. | ACTIVE REQUIRED |
| .github/workflows/test.yml:367-455 | Runs the production Interview vertical after API/worker setup. | ACTIVE REQUIRED |
| .github/workflows/decision-pr-review-triage.yml:1-97 | Runs python -m decision.pr_review_triage and uploads a PR-review shadow-triage artifact. This is a separate decision-PR review recorder, not the Legal Rule Triage runtime asset. | COMPATIBILITY WITH IDENTIFIED CONSUMER |
| deepagents/tests/test_deep_agent_project.py:120-157 | Asserts current skill packages and invocation boundary manifest, including legal Triage. | ACTIVE REQUIRED |
| deepagents/tests/test_deep_agent_flow_boundaries.py:87-146,152-239,411-445 | Asserts specialist tool surfaces, Triage isolation, direct legacy import rejection, and agent surface shape. | ACTIVE REQUIRED |
| deepagents/tests/test_repository_deep_analyzer.py:18-660 | Exercises the model Scanner/analyzer path and bounded absence/failure behavior. | ACTIVE REQUIRED |
| deepagents/tests/test_root_orchestration_dispatcher.py:20-434 | Exercises Triage, Interview, and Repository Analyst specialist dispatch. | ACTIVE REQUIRED |
| deepagents/tests/test_assessment_interview_runtime_e2e.py:267-549 | Exercises current Interview and direct Repository Analyst runtime vertical behavior. | ACTIVE REQUIRED |
| deepagents/tests/test_interview_context_skill.py:38-138 | Compares current Interview skill bytes with frozen English pack and runs skill lint/provenance checks. | COMPATIBILITY WITH IDENTIFIED CONSUMER |
| deepagents/tests/integration/test_docker_sandbox_e2e.py:167 | Expects the Interview skill path inside the sandbox. | COMPATIBILITY WITH IDENTIFIED CONSUMER |
| apps/web/tests/agent-stream-stages.test.ts:74-120,295-375,615-639 | Asserts Scanner/Interview stage grouping and activity behavior. | COMPATIBILITY WITH IDENTIFIED CONSUMER |
| apps/api/test/assessment-interview.e2e-spec.ts:235-719 | Exercises API Interview routes and agent decisions. | COMPATIBILITY WITH IDENTIFIED CONSUMER |

The workflow's pytest invocation is broad, so the Python tests above are direct current consumers even where the workflow does not name each file. A future replacement gate must update both direct tests and broad-suite expectations; deleting a named test is not evidence that the runtime path is absent.

## 7. Future gate ownership and required order

This section uses the frozen target only to name future owners. It does not claim any gate passed. The freeze says the target has one Root, optional native generic Repository Researcher tasks, no model Scanner/Interview/per-rule authority, and no fallback (reports/architecture-freeze-migration-manifest.md:10-45). Its wave definitions are W2 at :377-384, W3 at :386-393, W4 at :395-402, W5 at :404-411, W6 at :413-420, and W7 at :422-430. The coordinator ledger separately records all legacy rows as pending replacement gate (reports/agentic-migration-coordinator-ledger.md:39-65).

| Legacy path | Replacement proof required before classification can become deletion authority |
|---|---|
| Triage | W2 must provide one automatic Legal Preparation authority, approved portfolio activation/integrity proof, and replacement for scheduled/readiness/manual consumers. W6 drains old legal commands/recovery; W7 verifies source/import/image absence. |
| Model Scanner | W3 must provide Root-owned investigation/source tooling preserving deterministic repository hydration, sandbox, evidence/provenance and failure boundaries. W4 must pass bounded AI absence/evidence/completion behavior. |
| Direct per-rule Repository Analyst | W3 must replace the Python per-rule dispatcher with the native bounded generic Researcher task lineage. W4 must establish Root-owned rule coverage/finalization and structural-only validation. |
| Interview | W3 must replace mandatory Initial Interview and targeted agent lifecycle with Root-owned same-thread Human Resolution. W4 must pass HITL/restart/completion gates; W5 must pass API/SSE/web/browser cutover. |
| Shared container/lock assets | Keep shared LangGraph/LangChain, checkpoint, Chroma, RabbitMQ and runtime dependencies until all four replacement paths no longer consume them. W6 snapshots images and W7 proves absence in the actual release image; a lockfile no-match is insufficient. |

## 8. Safe, read-only absence checks

These commands are evidence procedures for the applicable W6/W7 gate. They are not run by this preparation, do not build/push/deploy/quiesce/archive, and do not inspect or mutate queues, workers, databases, or services. A no-match is scoped to the exact files/paths searched and must be combined with production-shaped proof.

### Source/import/registration scan

~~~
rg -n --hidden \
  --glob '!node_modules/**' --glob '!graphify-out/**' --glob '!dist/**' \
  --glob '!reports/**' \
  -i 'subagents[./_]?(triage|interview|repository.?analyst|scanner)|repository.?deep.?analyzer|legal.?rule.?triage|ai.?discovery|scanner_tool_entrypoints|program_graph_tool_entrypoints' \
  deepagents deepagents-langgraph apps packages scripts .github .fogewise
~~~

~~~
for path in \
  deepagents/subagents/triage \
  deepagents/subagents/interview \
  deepagents/subagents/repository_analyst \
  deepagents/subagents/scanner \
  deepagents/tools/common/capabilities/evidence/repository_analysis/analyzer.py \
  deepagents/tools/common/capabilities/agentic_evidence/entrypoints/program_graph_tool_entrypoints.py \
  deepagents/tools/common/capabilities/agentic_evidence/entrypoints/scanner_tool_entrypoints.py
do
  if test -e "$path"; then printf 'PRESENT %s\n' "$path"; else printf 'ABSENT %s\n' "$path"; fi
done
~~~

The first command is a source reference inventory, not an absence assertion. The second intentionally reports current presence/absence; it must be rerun at the final W7 commit and reconciled with the exact replacement import graph.

### Actual merged-rootfs probe (W7 only; unexecuted here)

[`docker image save`](https://docs.docker.com/reference/cli/docker/image/save/) produces a tarred repository containing parent layers, tags, and versions; its outer archive is not the merged container rootfs. The former `docker save IMAGE | tar -tf -` check is therefore removed: a no-match there cannot prove image absence, and layer/whiteout ordering is not resolved by scanning the outer archive. Docker documents [`docker container export`](https://docs.docker.com/reference/cli/docker/container/export/) as exporting a container filesystem tar, so the later W7 gate may use Docker's native merged view without custom layer-unpack or overlay tooling.

The exact W7 target set is the legacy runtime image surface: `/app/deepagents/subagents/{triage,interview,repository_analyst,scanner}/`, `/app/deepagents/tools/triage/legal_rule_triage/`, `/app/deepagents/tools/common/capabilities/evidence/repository_analysis/{analyzer,boundary,targeted_boundary}.py`, `/app/deepagents/tools/common/capabilities/assessment/investigation/engineering_rule/interview_gated_boundary.py`, `/app/deepagents/tools/common/capabilities/workflow/recovery/interview_boundary.py`, and `/app/deepagents/skills/interview-context/`. The shared `deepagents/config/model_routes.yaml` is deliberately excluded because it still has identified non-legacy consumers; source/import reconciliation remains separately required.

At the later W7 gate, set `AGENT_RUNTIME_IMAGE` to the exact local `agent-runtime@sha256:<64-hex-digest>` and `AGENT_RUNTIME_SERVER_IMAGE` to the exact local `agent-runtime-server@sha256:<64-hex-digest>`. Tags, placeholders, missing/unreadable images, declared image volumes, and any metadata/create/export/read/cleanup error are `NOT_PROVEN`; neither image may be skipped. `docker container create` does not start the container ([official docs](https://docs.docker.com/reference/cli/docker/container/create/)), and the probe overrides the entrypoint, uses `--pull=never --network=none --read-only`, supplies no mount/volume/port flags, rejects image-declared volumes, and creates only a task-owned disposable probe. It cannot start the production app or reach a network/DB; the stream is filtered to path names and no host/user-data mount is supplied.

~~~bash
#!/usr/bin/env bash
set -u

readonly -a RUNTIME_LABELS=("agent-runtime" "agent-runtime-server")
readonly -a RUNTIME_IMAGES=(
  "${AGENT_RUNTIME_IMAGE:-}"
  "${AGENT_RUNTIME_SERVER_IMAGE:-}"
)
readonly TARGET_RE='(^|/)deepagents/(subagents/(triage|interview|repository_analyst|scanner)(/|$)|tools/triage/legal_rule_triage(/|$)|tools/common/capabilities/evidence/repository_analysis/(analyzer|boundary|targeted_boundary)\.py$|tools/common/capabilities/assessment/investigation/engineering_rule/interview_gated_boundary\.py$|tools/common/capabilities/workflow/recovery/interview_boundary\.py$|skills/interview-context(/|$))'
probe=''

cleanup_probe() {
  if [ -z "$probe" ]; then
    return 0
  fi
  if rtk docker container rm "$probe" >/dev/null 2>&1; then
    probe=''
    return 0
  fi
  probe=''
  return 1
}

trap 'cleanup_probe >/dev/null 2>&1 || true' EXIT

for index in "${!RUNTIME_IMAGES[@]}"; do
  label="${RUNTIME_LABELS[$index]}"
  image="${RUNTIME_IMAGES[$index]}"

  if [[ ! "$image" =~ @sha256:[0-9a-f]{64}$ ]]; then
    printf '%s INVALID_OR_UNPINNED_IMAGE — NOT_PROVEN\n' "$label"
    continue
  fi
  if ! rtk docker image inspect --type=image "$image" >/dev/null 2>&1; then
    printf '%s IMAGE_NOT_PRESENT_OR_UNREADABLE %s — NOT_PROVEN\n' "$label" "$image"
    continue
  fi
  volume_count="$(rtk docker image inspect --type=image --format '{{len .Config.Volumes}}' "$image" 2>/dev/null)" || volume_count=''
  if [ "$volume_count" != 0 ]; then
    printf '%s IMAGE_VOLUMES_OR_METADATA_ERROR — NOT_PROVEN\n' "$label"
    continue
  fi

  probe="lcsp-w7-legacy-image-probe-${label}-$$"
  if ! rtk docker container create \
      --name "$probe" \
      --label lcsp.probe=legacy-agent-image-w7 \
      --pull=never \
      --network=none \
      --read-only \
      --entrypoint=/bin/false \
      "$image" >/dev/null; then
    printf '%s ROOTFS_PROBE_CREATE_ERROR — NOT_PROVEN\n' "$label"
    probe=''
    continue
  fi

  set +e
  rtk docker container export "$probe" \
    | rtk tar -tf - \
    | rtk rg -n "$TARGET_RE"
  pipeline_status=("${PIPESTATUS[@]}")
  set -e

  cleanup_status=0
  cleanup_probe || cleanup_status=$?
  if [ "$cleanup_status" -ne 0 ]; then
    printf '%s ROOTFS_PROBE_CLEANUP_ERROR — NOT_PROVEN\n' "$label"
  elif [ "${pipeline_status[0]}" -ne 0 ] || [ "${pipeline_status[1]}" -ne 0 ]; then
    printf '%s ROOTFS_EXPORT_OR_READ_ERROR — NOT_PROVEN\n' "$label"
  elif [ "${pipeline_status[2]}" -eq 0 ]; then
    printf '%s TARGET_PATH_PRESENT — absence gate FAIL\n' "$label"
  elif [ "${pipeline_status[2]}" -eq 1 ]; then
    printf '%s NO_TARGET_PATHS — W7 evidence candidate only; current ledger remains NOT_PROVEN\n' "$label"
  else
    printf '%s PATH_SCAN_ERROR — NOT_PROVEN\n' "$label"
  fi
done
~~~

Only `docker export=0`, `tar=0`, and `rg=1` (a completed merged-rootfs scan with no target path) may emit `NO_TARGET_PATHS`; every permission, execution, or read error is `NOT_PROVEN`, never a no-match pass. `TARGET_PATH_PRESENT` is explicit absence-gate failure. This preparation did not execute the probe, so the current result remains `NOT_PROVEN`; future W7 evidence must record successful results for both exact pinned runtime images after W6 snapshot/cutover controls.

### CI/build/lock reference scan

~~~
rg -n -i \
  'docker (build|buildx build)|Dockerfile(\.dev)?|deepagents-langgraph|uv\.lock|pip install -e|pytest|frozen/interview-agent-frozen|decision\.pr_review_triage|scanner|interview|repository.?analyst|legal.?rule.?triage' \
  .github/workflows scripts package.json deepagents/pyproject.toml deepagents/uv.lock .fogewise .dockerignore
~~~

This command reports remaining build/CI consumers; it does not authorize removing broad path filters or the separate PR-review triage recorder. Reconcile every match with the replacement owner before declaring a CI/image absence gate complete.

## Coverage limits and final status

This ledger directly verified the current Python registrations, invocation manifest, boundaries, specialist definitions, orchestration call chain, model routes, container copy/build files, lockfile anchors, deploy descriptors, CI workflow invocations, and direct test/fixture consumers listed above. It does not classify every lexical use in all API/web/i18n/Prisma/history/docs files, every generated artifact, every remote CI run, every registry image, or any live production queue/worker/database; use the read-only scans and the W5/W6/W7 gates for those surfaces. frozen/interview-agent-frozen/**, customer-facing labels, API/web lifecycle projections, and broad contracts are explicitly compatibility consumers, not proof that the corresponding runtime agent is still authoritative or that it has been removed.

Current result: all four runtime paths have current ACTIVE REQUIRED references; compatibility consumers are identified; no bounded current production asset is classified DEAD-DELETE; no production/image/CI absence gate passed. The next safe action is gate-owned replacement verification, followed by W6 quiescence/archive/cutover and only then W7 source/import/image absence proof.

## Dated correction note — 2026-10-06

- Root cause: the prior `docker save | tar -tf` procedure scanned Docker's outer layer archive, not the merged container rootfs, so no-match could not establish module absence.
- Fix: removed that absence test and documented the later W7 exact-digest, both-runtime-image, stopped-container `docker container export` probe with strict `NOT_PROVEN` handling for all errors.
- Verification: official Docker [`image save`](https://docs.docker.com/reference/cli/docker/image/save/) and [`container export`](https://docs.docker.com/reference/cli/docker/container/export/) documentation was checked; no Docker build/save/export/create/run/rm/push/deploy command was executed, and image/rootfs absence remains `NOT_PROVEN`.
