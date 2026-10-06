# LCSP Production Agentic Architecture Freeze and Migration Manifest

**Status:** Frozen target; this is the implementation authority for the production migration.

**Scope:** Production architecture and migration plan only. This change adds no application code.

**Authority order:** this freeze resolves the implementation plan and the five Wave 0 audits against the checked-out production source.
**Rule:** semantic legal/compliance decisions belong to agents; deterministic code enforces identity, provenance, security, persistence, lifecycle, and completion.

## 1. Final architecture

```text
Official legal source acquisition and immutable LegalCorpusVersion
  -> Legal Preparation Deep Agent
  -> LegalRule propositions + legal-context relations
  -> EngineeringRule assessment contracts
  -> deterministic portfolio integrity validation
  -> one atomic ACTIVE LegalRule/EngineeringRule portfolio

Assessment + pinned repository snapshot + pinned ACTIVE portfolio
  -> one Assessment Root Deep Agent on one server-owned thread/checkpoint
       -> optional bounded, ephemeral Repository Researcher via native task()
       -> AssessmentCase and AssessmentEvidence through governed tools
       -> agentic use-case discovery and EngineeringRule applicability
       -> agentic criterion and compliance decisions
       -> HumanResolutionRequest only for unresolved human-owned facts
  -> deterministic decision/provenance validation
  -> deterministic Completion Gate
  -> Root synthesizes report from frozen accepted state
  -> persisted AssessmentArtifact; Assessment becomes COMPLETE
```

The only legal preparation path is a Legal Corpus version to the Legal Preparation Deep Agent to a complete LegalRule and EngineeringRule portfolio to mechanical validation and atomic activation. LegalRules and EngineeringRules are generated automatically; no person reviews, approves, signs off, or publishes the semantic output. A validation failure leaves the previous ACTIVE portfolio in place and produces a retryable preparation failure.

The Assessment Root Deep Agent owns the assessment’s reasoning from first inspection through the final report. It discovers use cases, plans investigation, interprets evidence, decides applicability, adjudicates criteria and compliance, decides whether absence is sufficiently established, and decides whether a human fact is material. It may delegate a bounded repository question to an ephemeral Repository Researcher using Deep Agents `task()`. That researcher returns candidate findings and source references; the Root verifies and accepts evidence and makes every assessment decision. The researcher has no assessment lifecycle, customer-question, decision, or shared-memory write authority.

One assessment has one server-created, server-persisted Root thread and checkpoint namespace for its lifetime. The database enforces one assessment-to-thread mapping and one thread-to-assessment mapping. Pause, human interrupt, restart, retry, and resume reuse that mapping. Native child tasks are execution descendants of the Root namespace and carry the same assessment and parent-execution identity; they are not new assessment threads or independent customer-memory scopes.

Deterministic code is limited to mechanically verifiable trust and integrity boundaries: authorization and tenant scoping; repository/corpus/version/hash identity; citation and evidence-reference validation; schema and immutable provenance validation; optimistic revision and stale-decision rejection; idempotency, leases, transaction and event ordering; token/billing accounting; and the completion/finalization gate. No deterministic rule evaluator, universal applicability evaluator, regex legal classifier, or hidden API/UI projection may make or repeat a semantic legal/compliance decision.

Human-in-the-loop resolves facts owned by a person or organization that repository, documents, runtime inspection, and already-confirmed case facts cannot establish. The Root investigates first, chooses whether a fact is material, and writes customer-safe question wording. An answer supplies evidence/facts; it never approves applicability, a criterion, compliance, or a report. “I do not know” is recorded but does not resolve the request. No approval step exists in legal preparation or assessment.

Assessment-private episodic memory is checkpoint state scoped to that assessment. Authoritative facts, evidence, requests, decisions, and artifacts live in the assessment database. Sanitized long-term learning is a separate, governed, non-authoritative store. Skills are versioned product procedure. Shared learning may guide searches and questions but is never evidence and never overrides current legal sources, repository contents, accepted facts, or evidence.

There is one production path for legal preparation and one production path for assessment reasoning. Cutover is gated by the acceptance criteria in §12. There is no V1 shadow judge, feature flag, compatibility adapter, fallback pipeline, or deprecated wrapper in the target runtime. Rollback is an operational release/database restore before V2 writes; after V2 writes begin, recovery is forward-only from the preserved archive.

## 2. Agentic vs deterministic ownership

Each semantic decision has exactly one owner. A deterministic guard may reject an invalid packet but may not replace the agent’s judgment.

| Decision or operation | Sole owner | Boundary |
|---|---|---|
| Legal interpretation, including definitions, scope, cross-references, exceptions, qualifiers, and operative effect | **AGENTIC — Legal Preparation Deep Agent** | It interprets pinned corpus material and records source/context references. Validation checks reference identity and structure, not legal meaning. |
| LegalRule generation | **AGENTIC — Legal Preparation Deep Agent** | Creates the legal proposition and its context relations. |
| EngineeringRule generation | **AGENTIC — Legal Preparation Deep Agent** | Creates the assessable contract, applicability guidance, criteria, and evidence guidance. |
| Use-case discovery | **AGENTIC — Assessment Root Deep Agent** | Builds the assessed system/use-case picture from pinned repository, documents, runtime, and confirmed facts. |
| Repository investigation planning and ordering | **AGENTIC — Assessment Root Deep Agent** | Deep Agents native planning and optional `task()` delegation own adaptive sequencing. |
| Repository fact collection | **AGENTIC — Assessment Root Deep Agent**; bounded collection may be delegated to the **Repository Researcher** | Subagent findings are proposals until the Root verifies source refs and accepts evidence. |
| Applicability | **AGENTIC — Assessment Root Deep Agent** | Emits `APPLICABLE` or `NOT_APPLICABLE` for each pinned EngineeringRule. No generic deterministic predicate can exclude a rule. |
| Evidence interpretation | **AGENTIC — Assessment Root Deep Agent** | Interprets evidence in context; deterministic code validates source and evidence identity only. |
| Negative/absence reasoning | **AGENTIC — Assessment Root Deep Agent** | Decides whether authenticated, bounded search coverage justifies a negative conclusion. A guard verifies the coverage record’s authenticity and pinned scope, not sufficiency. |
| Question materiality and whether to interrupt | **AGENTIC — Assessment Root Deep Agent** | Must first investigate sources that can answer. Tool/runtime enforces allowed request shape and authorization. |
| Human question wording | **AGENTIC — Assessment Root Deep Agent** | A deterministic privacy/schema guard rejects unsafe text or malformed choices; it does not decide what to ask. |
| Criterion `MET` / `NOT_MET` decision | **AGENTIC — Assessment Root Deep Agent** | Every required criterion of an applicable rule is adjudicated and cites accepted evidence/facts. |
| Compliance `COMPLIANT` / `NON_COMPLIANT` decision | **AGENTIC — Assessment Root Deep Agent** | Must cohere with agent-authored criterion decisions; a validator checks completeness and references, not legal meaning. |
| Evidence/citation validation and acceptance | **DETERMINISTIC_GUARD — Evidence/Decision Validator** | Confirms the reference exists, is authorized, immutable, correctly scoped/versioned, and not stale. It cannot upgrade evidence or decide what it means. |
| Source/version/hash validation | **DETERMINISTIC_GUARD — source and portfolio integrity services** | Validates canonical identity, content hashes, legal status, repository commit, and version binding. |
| Tenant/RBAC/tool security | **DETERMINISTIC_GUARD — API authorization and tool boundary** | Server-authenticated assessment/tenant/thread mapping; least-privilege tools; no agent-supplied authority. |
| Assessment lifecycle transition validation | **DETERMINISTIC_GUARD — AssessmentLifecycleCoordinator** | Sole writer of the Assessment lifecycle, with expected-revision CAS and a transactionally paired event. |
| Stale revision/decision rejection | **DETERMINISTIC_GUARD — DecisionValidator and AssessmentLifecycleCoordinator** | Rejects writes based on stale case, repository, legal portfolio, or decision revision; marks affected decisions `INVALIDATED`. |
| Portfolio completeness, referential integrity, and atomic activation | **DETERMINISTIC_GUARD — LegalPortfolioIntegrityValidator/activation transaction** | Checks only mechanical completeness and trust invariants; the validator does not author or approve legal content. |
| Completion/finalization | **DETERMINISTIC_GUARD — Completion Gate, committed by AssessmentLifecycleCoordinator** | Verifies all pinned rules have final decisions, no requests/inputs remain, refs and pins are valid, and no execution failure is unresolved. It never revises judgments. |
| Token usage, invocation identity, billing and accounting | **INFRASTRUCTURE — usage/billing ledger** | One stable invocation identity per model attempt; settle idempotently from provider/runtime usage. Accounting does not determine a domain result. |
| Checkpoint, queue, lease, event delivery, retry and outbox reliability | **INFRASTRUCTURE — LangGraph/Deep Agents plus LCSP persistence boundaries** | Infrastructure controls execution, not legal/compliance meaning or assessment completion. |

Repository Researcher may make bounded agentic observations, but is not an additional decision owner. Legal Preparation is isolated from assessment/customer/repository context. Report prose is Root-authored synthesis of frozen accepted decisions; it cannot add or correct decisions.

## 3. Canonical state model

These are the only assessment/runtime decision/artifact state families. Domain facts, request status, billing status, repository-job status, and UI loading status remain resource-local and cannot write assessment lifecycle.

### 3.1 `AssessmentLifecycleState`

The value is persisted on `Assessment`. It is the only customer-facing assessment lifecycle.

| State | Meaning |
|---|---|
| `CREATED` | Assessment exists; runtime preparation has not started. |
| `PREPARING` | Pinned legal portfolio, repository snapshot, sandbox, or required runtime is being prepared. |
| `ACTIVE` | The Assessment Root is reasoning, investigating, or resolving decisions. |
| `WAITING_FOR_HUMAN` | At least one material `HumanResolutionRequest` is `OPEN`. |
| `WAITING_FOR_REQUIRED_INPUT` | A required non-decision input (document, runtime access, or restorable source/snapshot) is outstanding. |
| `PAUSED` | An explicit stop/pause has safely interrupted a resumable execution; checkpoint and domain state are retained. |
| `FINALIZING` | Completion Gate passed; the final artifact is being generated and persisted from frozen accepted state. |
| `COMPLETE` | Final artifact persisted and validated. Terminal. |
| `BLOCKED` | A required dependency is unobtainable under the assessment contract; no final artifact is permitted. |
| `FAILED` | Unrecoverable runtime/system failure; no domain verdict is implied. A governed retry may resume the same assessment. |
| `CANCELLED` | Explicit cancellation. Terminal. |

Only `AssessmentLifecycleCoordinator` writes the state. All create, runtime, HITL, input, pause, cancel, failure, retry, and finalization commands call its single transition method. It validates the transition and expected assessment revision and atomically commits the Assessment row plus its `AssessmentEvent`. Root/tools request a transition; they never write it. Completion Gate returns allow/block and does not write state. GET, SSE, and UI are read-only.

Legal transitions are exactly:

| From | Allowed destination |
|---|---|
| `CREATED` | `PREPARING`, `FAILED`, `CANCELLED` |
| `PREPARING` | `ACTIVE`, `WAITING_FOR_REQUIRED_INPUT`, `BLOCKED`, `FAILED`, `CANCELLED` |
| `ACTIVE` | `WAITING_FOR_HUMAN`, `WAITING_FOR_REQUIRED_INPUT`, `PAUSED`, `FINALIZING`, `BLOCKED`, `FAILED`, `CANCELLED` |
| `WAITING_FOR_HUMAN` | `ACTIVE`, `WAITING_FOR_REQUIRED_INPUT`, `PAUSED`, `BLOCKED`, `CANCELLED` |
| `WAITING_FOR_REQUIRED_INPUT` | `ACTIVE`, `WAITING_FOR_HUMAN`, `PAUSED`, `BLOCKED`, `CANCELLED` |
| `PAUSED` | `ACTIVE`, `WAITING_FOR_HUMAN`, `WAITING_FOR_REQUIRED_INPUT`, `CANCELLED` |
| `BLOCKED` | `ACTIVE` only after an explicit new resolvable dependency/input is accepted; otherwise `CANCELLED` |
| `FAILED` | `ACTIVE` only through a governed retry using the same assessment identity and thread; otherwise `CANCELLED` |
| `FINALIZING` | `COMPLETE` after artifact persistence, `FAILED` on unrecoverable finalization failure, or `CANCELLED` on explicit cancellation before publication |
| `COMPLETE`, `CANCELLED` | No transition |

`ACTIVE -> FINALIZING` is accepted only when the Completion Gate returns zero blockers. Resolving one of several human or required-input requests does not resume the Root until all blocking requests for the current checkpoint are resolved. An answer “I do not know” is recorded, leaves its request `OPEN`, and leaves the assessment waiting; when the Root establishes the fact cannot be obtained under the contract, the coordinator may set `BLOCKED` with `HUMAN_FACT_UNRESOLVABLE`. A later valid input may reopen that blocked assessment through the explicit input command. Stop means durable pause (`PAUSED`), Continue/Resume reuses the same thread, and Cancel is terminal. Transient model/provider errors are execution failures and may be retried; only an unrecoverable runtime boundary changes assessment lifecycle to `FAILED`.

### 3.2 `AgentExecutionState`

Shared by Legal Preparation, Assessment Root, and every subagent execution; it never implies an assessment or legal outcome.

`QUEUED`, `RUNNING`, `INTERRUPTED`, `PAUSED`, `SUCCEEDED`, `FAILED`, `CANCELLED`.

An interrupt for a human request uses `INTERRUPTED` and `WAITING_FOR_HUMAN`; a user stop uses `PAUSED` and `PAUSED`; a transient provider failure uses `FAILED` on that execution and a retry of the same Root thread. A successful child task never completes the assessment.

Execution transitions are `QUEUED -> RUNNING | FAILED | CANCELLED`; `RUNNING -> INTERRUPTED | PAUSED | SUCCEEDED | FAILED | CANCELLED`; `INTERRUPTED -> RUNNING | PAUSED | FAILED | CANCELLED`; `PAUSED -> RUNNING | FAILED | CANCELLED`. `SUCCEEDED`, `FAILED`, and `CANCELLED` are terminal for that execution ID; retry creates a new execution ID under the same assessment thread. Runtime execution infrastructure owns these transitions and emits AssessmentEvents; no agent writes execution state directly.

### 3.3 `DecisionResolutionState`

Per EngineeringRule decision-coverage record; it is not assessment lifecycle or a verdict.

`PENDING`, `INVESTIGATING`, `WAITING_FOR_INPUT`, `RESOLVED`, `INVALIDATED`.

Transitions: `PENDING -> INVESTIGATING`; `INVESTIGATING -> WAITING_FOR_INPUT | RESOLVED | INVALIDATED`; `WAITING_FOR_INPUT -> INVESTIGATING | RESOLVED | INVALIDATED`; `RESOLVED -> INVALIDATED`; `INVALIDATED -> INVESTIGATING`. `RESOLVED` requires an accepted `RuleDecision` of `NOT_APPLICABLE`, or `APPLICABLE` with all required criteria and a compliance result. No `UNKNOWN`, `PARTIAL`, `NEEDS_CONTEXT`, or `BLOCKED_UNKNOWN_FACT` value exists in this family.

### 3.4 `ArtifactLifecycleState`

Shared by portfolio and generated assessment artifacts: `BUILDING`, `ACTIVE`, `SUPERSEDED`, `INVALID`. A final report is immutable and `ACTIVE` when published; `AssessmentLifecycleState.COMPLETE` communicates completion. Do not add `FINAL` as a second publication state. An activated portfolio may be superseded; an invalid artifact cannot be used as a pin. Rollback to a previously validated portfolio changes the active portfolio pointer in one audited activation transaction and does not rewrite its contents.

Artifact transitions are `BUILDING -> ACTIVE | INVALID`; `ACTIVE -> SUPERSEDED | INVALID`; `SUPERSEDED -> ACTIVE | INVALID` only through a validated, audited portfolio-pointer rollback; `INVALID` is terminal. The artifact owner persists these transitions, and portfolio activation is the only path that can reactivate a superseded portfolio.

### 3.5 `BlockerReason`

Closed vocabulary present only on `AssessmentLifecycleState.BLOCKED`:

`HUMAN_FACT_UNRESOLVABLE`, `REQUIRED_DOCUMENT_UNAVAILABLE`, `REQUIRED_RUNTIME_INPUT_UNAVAILABLE`, `LEGAL_PORTFOLIO_UNAVAILABLE`, `REPOSITORY_SNAPSHOT_UNAVAILABLE`.

The reason is accompanied by the typed request/input/portfolio/snapshot reference. Credit, quota, credential, retry, or queue conditions remain infrastructure/billing errors and never become assessment blockers unless the required input is permanently unobtainable under the contract.

`HumanResolutionRequest.status` is request-local, with `OPEN -> RESOLVED | SUPERSEDED | CANCELLED`. A valid sufficient answer resolves it; a no-longer-material question is superseded; assessment cancellation cancels it. “I do not know” leaves it `OPEN`. Request status can authorize a lifecycle transition but is not another assessment lifecycle.

### 3.6 Current-state disposition

| Current values/family | Disposition | Target |
|---|---|---|
| `AssessmentStatus` wizard, scan, classification, review, `AI_NOT_DETECTED` values | **REPLACE** | One persisted lifecycle plus decisions; `AI_NOT_DETECTED` is not lifecycle and must be re-evaluated as per-rule applicability. |
| `INITIAL_INTERVIEW`, `BUSINESS_CONTEXT_RESOLUTION`, `CONTEXT_READY`, `CONTEXT_RESOLVED`, `WAITING_FOR_CUSTOMER`, `BLOCKED_OR_UNRESOLVED` | **DELETE** | Human-owned fact requests and canonical lifecycle. |
| `NEEDS_CONTEXT`, `WAITING_RULE`, `AI_UNKNOWN`, `BLOCKED_UNKNOWN_FACT`, final `UNKNOWN`, technical/stage `PARTIAL`, and Scanner/Interview/Planner/Investigator stage states | **DELETE** | Decision-resolution state, typed input/blocker, execution state, evidence coverage, or activity; never assessment outcomes. |
| Runtime `RUNNING/WAITING/COMPLETED/FAILED` and control `STOP_REQUESTED/RESUME_REQUESTED` | **REPLACE** | Shared execution state and explicit commands/events; lifecycle remains separate. |
| `COMPLIANT`, `NON_COMPLIANT`, `APPLICABLE`, `NOT_APPLICABLE`, criterion `MET`, `NOT_MET` | **KEEP** as decision data | Agent-authored `RuleDecision` fields, not lifecycle states. |
| Current legal `DRAFT/APPROVED/REJECTED/SUPERSEDED` statuses | **REPLACE** | `ArtifactLifecycleState`; no approval/rejection semantic or human signoff record. |
| Request, scan-job, document, billing, outbox, auth, and repository connection statuses | **KEEP** as resource-local state | Remain owned by those resources and cannot write the assessment lifecycle. |
| Pure web loading, connection, and panel states | **KEEP** as view state | UI-only values; never claim assessment lifecycle. |

## 4. Canonical event model

One persisted/streamed `AssessmentEvent` envelope is used by the Assessment Root, all task descendants, governed tools, API, and UI projection. Root/tools submit activity or domain commands through the authorized API; API derives `assessmentId`, `threadId`, actor, sequence, timestamp and lifecycle/execution payload from server state. Python never writes lifecycle or event-order fields:

```text
AssessmentEvent {
  eventId: UUID,                         // idempotency identity
  assessmentId: UUID,                    // required; server-authorized
  threadId: UUID,                        // server-owned AssessmentRuntime mapping
  sequence: integer,                     // monotonic per assessment
  timestamp: ISO-8601 UTC,
  eventType: AssessmentEventType,
  actorType: RUNTIME | ASSESSMENT_ROOT | SUBAGENT | TOOL | API,
  executionId?: UUID,
  parentExecutionId?: UUID,
  taskId?: string,
  toolCallId?: string,
  payload: typed event-specific object,
  tokenUsage?: { invocationId, promptTokens, completionTokens, totalTokens, cost?, currency? },
  technicalDetailsRef?: opaque redacted/encrypted detail reference
}
```

`eventType` is a closed event vocabulary covering `ACTIVITY_RECORDED`, `ASSESSMENT_LIFECYCLE_CHANGED`, `EXECUTION_STATE_CHANGED`, `EVIDENCE_ACCEPTED`, `DECISION_ACCEPTED`, `HUMAN_RESOLUTION_CHANGED`, and `ARTIFACT_CHANGED`. A lifecycle payload includes `fromState`, `toState`, `assessmentRevision`, and a blocker reason/reference only for `BLOCKED`. Activity payloads describe model/tool/task/domain activity and carry no implied lifecycle. Subagent events carry the same `assessmentId` and root `threadId` plus `executionId`, `parentExecutionId`, and `taskId` lineage.

`eventId` is the deduplication key. The event authority allocates `sequence` transactionally with the canonical state/domain write; duplicate delivery is idempotent. The event is not lifecycle state and does not become a second source of truth. Snapshot and SSE responses return persisted lifecycle and event history; UI projects both and never infers lifecycle from event recency, activity label, stage, or missing projection data. Raw provider input, customer facts, evidence bodies, and secrets are not copied into normal event payloads; `technicalDetailsRef` resolves only through authorized redacted tooling.

## 5. Memory and isolation

Exactly four scopes exist:

| Scope | Contents and persistence | Authority/access |
|---|---|---|
| Assessment-private episodic memory | LangGraph/Deep Agents checkpointer and assessment sandbox, keyed by `AssessmentRuntime.threadId` | Root of that assessment only. Task descendants receive bounded inherited context in the same execution lineage. No other assessment and no Legal Preparation run can query it. |
| Authoritative assessment domain state | API/PostgreSQL `AssessmentCase`, `AssessmentEvidence`, `HumanResolutionRequest`, `RuleDecision`, `SearchCoverageEvidence` payload, lifecycle and `AssessmentArtifact` metadata | Domain authority, revisioned and provenance-validated. Never inferred from conversation/checkpoint text. |
| Sanitized long-term learning memory | Deep Agents persistent Store under a versioned LCSP assessment-learning namespace; typed generic heuristics only | Read selectively by Assessment Root as `NON_AUTHORITATIVE_HEURISTIC`. Write only through a governed proposal and privacy/injection/dedup guard. No agent can write arbitrary text. |
| Procedural skills/instructions | Versioned, reviewed skills and deployed instructions | Stable policy/procedure; code-release authority, not customer memory. Legal Preparation and assessment instructions are separate. |

Hard invariants:

1. Assessment A raw context is never retrievable by assessment B, including under the same tenant, user, repository, or legal portfolio. Thread IDs are server-generated and unique; the server owns the sole `assessmentId <-> threadId` mapping.
2. Raw customer facts, answers, documents, source snippets/paths, evidence, use cases, decisions, topology, report text, credentials, and assessment-specific subagent findings stay in assessment-private checkpoint/domain storage. None is directly promoted to shared memory.
3. Subagents cannot create independent long-term customer memory or call promotion tools. They cannot access historical assessment threads.
4. A governed promotion service accepts only typed `SANITIZED_GENERIC` lessons with no customer, tenant, repository, source-path, or assessment identifiers; it records guard outcome and version. Current shared-memory entries may be quarantined or superseded.
5. Long-term memory cannot be cited as evidence, legal authority, fact, or decision provenance. Decision tools accept only typed AssessmentEvidence, LegalRule/EngineeringRule, and confirmed-fact references.
6. Current pinned legal sources, portfolio, repository snapshot, and accepted case facts always outrank learned heuristics. A memory conflict is ignored; no guard is needed to re-decide that semantic conflict.
7. Assessment deletion removes or tombstones its checkpoint, sandbox, open requests, and domain rows per retention policy. A genuinely de-identified shared heuristic survives only if it still satisfies the promotion contract. Memory telemetry contains IDs/types/counts, never raw memory bodies.

`VerifiedAgentEpisode` is currently assessment-linked and remains private historical data; it is not the target shared learning store and is not cited as evidence. The target shared store starts empty at cutover. No raw episode is bulk-promoted.

## 6. Domain authorities

| Object | Single source of truth | Persistence owner and rule |
|---|---|---|
| `LegalCorpusVersion` | Immutable acquired legal source snapshot, hierarchy, source identities, chunk hashes, and cross-reference metadata | Legal Corpus API/PostgreSQL (`LegalCorpusVersion`, source document/snapshot, chunk, and validated retrieval-index rows). Acquisition and integrity services own writes. |
| `LegalRule` | Agent-authored legal proposition and linked legal-context relations for one pinned corpus/portfolio version | Legal portfolio API/PostgreSQL. No second approved-rule catalog, chunk-derived rule factory, or artifact copy is authoritative. |
| EngineeringRule portfolio | Versioned set of EngineeringRules and their LegalRule/context references under one `LegalPortfolioVersion` | Legal portfolio API/PostgreSQL. This is the sole runtime basis. Chroma, bundles, filesystem artifacts, and assessment-time compile/recovery are removed as authorities. |
| `Assessment` | Assessment identity, tenant/owner, canonical lifecycle state, lifecycle revision, and immutable creation scope | Assessment API/PostgreSQL. Lifecycle writes pass only through `AssessmentLifecycleCoordinator`. |
| `AssessmentRuntime` | One-to-one server-owned Root `threadId`, pinned runtime/checkpointer namespace, current execution lease/identity | Assessment runtime API/PostgreSQL plus LangGraph checkpointer. Unique constraints on `assessmentId` and `threadId`; no per-rule root thread. |
| `AssessmentCase` | Accepted structured facts and use-case description at `caseRevision`, plus pinned repository and legal portfolio versions | Assessment API/PostgreSQL. Root proposes; server validates source authority and revision before accepting. |
| `AssessmentEvidence` | Accepted evidence and provenance, reusable across rules; `SEARCH_COVERAGE` is a typed evidence subtype | Assessment evidence ledger in PostgreSQL. Server mint/verify tools own acceptance; agent text cannot mint refs. |
| `HumanResolutionRequest` | Open/resolved/superseded/cancelled human-owned fact requests and accepted answers | Assessment API/PostgreSQL. Human Resolution service owns request mutation; an answer does not carry a verdict. |
| `RuleDecision` | Latest accepted decision per assessment, EngineeringRule/version, and scope, with immutable history of superseded decisions | Assessment decision ledger in PostgreSQL. Root authors; DecisionValidator mechanically accepts/rejects; no second evaluator. |
| `SearchCoverageEvidence` | Authenticated searched scopes, queries, entry points, known gaps, direct-source fallbacks, and pinned repository version | Canonical subtype of `AssessmentEvidence` in the same ledger, not a second independent evidence store. |
| `AssessmentArtifact` | Immutable report/output bytes and their accepted-state, source-pin, schema, hash, and lifecycle metadata | Assessment artifact service/PostgreSQL metadata plus one protected blob store. `DocumentRequest` remains a request resource and references the artifact; it does not duplicate report status/content. |
| Long-term learning memory | Sanitized reusable heuristic records only | Governed Deep Agents Store namespace and promotion service. Assessment-private memory remains in the assessment checkpointer and is never in this namespace. |

Every decision and artifact points to a single immutable `LegalPortfolioVersion`, repository snapshot/commit, and case revision. Existing `LegalRuleMatch`, `VerifiedProfile`, cache, bundle, and old catalog records are historical or acquisition data after migration; none is an alternative authority.

## 7. KEEP / REWRITE / DELETE / MIGRATE manifest

Disposition is for the current production path. Historical SQL migrations remain to build clean databases; they are not runtime compatibility. Each row names the target and the condition for dropping old code/data.

| Current path | Symbol/component | Current responsibility | Disposition | Target replacement | Migration dependency | Deletion condition |
|---|---|---|---|---|---|---|
| `packages/contracts/src/assessment/{statuses.ts,flow.ts,assessment-runtime.ts,assessment-runtime-control.ts}` | Assessment/status, stage, run, control, activity values | Several assessment and runtime state families | **REWRITE** | §3 constants and §4 `AssessmentEvent`; retain only resource-local execution values | W1 shared contract | Remove old exports after all API/Python/web consumers compile against W1. |
| `packages/contracts/src/evidence/assessment-interview.ts`, `assessment-post-finding-runtime.ts`, `rule-assessment.ts`, `scan/callback.ts` | Interview, post-finding, criterion, callback statuses | Lifecycle and decision meanings mixed into worker/API payloads | **REWRITE** | `HumanResolutionRequest`, `RuleDecision`, `AgentExecutionState`, canonical event payloads | W1, then W3/W4 | Delete old constants/schemas when V2 APIs and stream consumers are cut over. |
| `apps/api/prisma/schema.prisma` | `Assessment`, runtime, decision, interview, legal catalog, and approval models | V1 persistence and duplicated workflow records | **REWRITE** | Canonical ALS, `AssessmentRuntime`, `AssessmentCase`, Evidence, Request, Decision, Artifact, LegalPortfolio, LegalRule and EngineeringRule rows | W1 contracts; one serialized Prisma owner | Drop obsolete active models after archive/backfill/restart/upgrade acceptance. |
| `apps/api/src/modules/assessment/domain/entities/assessment.entity.ts`; assessment handlers/repositories | `Assessment.status` and setters | Wizard/scan/review/AI absence state | **REWRITE** | Persist ALS + revision; commands delegate to lifecycle coordinator | W1, W3 | No direct writes or legacy status guards remain. |
| `deepagents/tools/common/capabilities/agent_runtime/invocation.py`, legal recovery and assessment command registration | `AGENT_INVOCATION_BOUNDARIES` and command dispatch | Routes legal recovery, old scan/interview/per-rule and specialized boundaries | **REWRITE** | One legal preparation command and one assessment Root command; retain shared auth, outbox, callback and event infrastructure | W1, W2, W3 | Remove registrations/imports for deleted boundaries after no queue can deliver their command types. |
| `AssessmentInterviewRuntimeService`, Interview controller/routes/BFF/client and `AssessmentInterviewThread` | Interview state/questions/resume | Initial Interview lifecycle, private context and customer answer flow | **MIGRATE** | Facts to `AssessmentCase`; material open need to `HumanResolutionRequest`; answer resumes Root thread | W3 Human Resolution API and runtime interrupt | Delete service/thread/routes after safe rows are archived and exact eligible requests migrated. |
| `AssessmentRuntimeControlService`, `AssessmentPipelineContinuationService`, reconciliation workers | Stop/continue, run control, recovery | Explicit command/outbox and old-pipeline retry decisions | **REWRITE** | Pause/resume/retry commands call sole coordinator and resume same LangGraph checkpoint | W1 event/state API, W3 runtime | Remove Interview/per-rule selectors and recovery branches once V2 restart E2E passes. |
| `AssessmentRuntimeEventService.buildWorkspaceSnapshot`, `stage-lifecycle.ts`, runtime SSE/history | `AssessmentRuntimeSnapshot`, `deriveStageLifecycles` | Recomputes lifecycle from scan/interview/rule records; snapshot also fails stale scan jobs | **REWRITE** | Read persisted ALS/AES/DRS; stream canonical AssessmentEvent; timeout worker owns stale transitions | W1 event contract and W3 coordinator | Delete derived lifecycle and all write-on-read behavior after API/UI cutover. |
| `apps/web/src/features/workspace/**` runtime adapters, selectors, stream parser, status labels and workspace summaries | Workflow/stage/run/turn/control projection | Re-derives running, waiting, paused, completed and screen state | **REWRITE** | Render server ALS/AES/coverage and project AssessmentEvents only as activity | W1 contracts, W5 API response | Remove inference helpers and duplicated finished-status constants after Playwright acceptance. |
| `apps/api/src/modules/assessment/application/services/assessment-interview-runtime.service.ts` plus web interview composer/sidebar | Human answer/blocked-action lifecycle | Interview-specific question authority and exact-rule continuation | **REWRITE** | HumanResolutionRequest UI/API; only answer facts and resume same Root thread | W3; W5 UI | Delete Interview-only action states when request flow passes same-thread E2E. |
| `deepagents/agent.py::create_root_agent`, `deepagents/instructions.md`, `deepagents/FLOW.md` | Existing Deep Agent entrypoint and instructions | Root restricted to legal triage; custom Python loop owns assessment | **REWRITE** | Separate `create_legal_preparation_agent` and `create_assessment_root_agent`; Root owns assessment | W1 contracts; W2 portfolio API; W3 domain tools | Remove old root role/triage coupling and instructions after both agent verticals pass. |
| `deepagents/subagents/repository_analyst/definition.py`; `subagents/__init__.py` | `SYSTEM_PROMPT`, subagent registry | One EngineeringRule per direct-dispatch researcher task | **REWRITE** | Generic bounded Repository Researcher registered for native `task()` | W3 evidence API | Remove rule-bound task protocol/direct dispatcher after bounded lineage and evidence tests pass. |
| `deepagents/subagents/interview/definition.py`, `customer_safe_projection.py` | Interview specialist and customer-safe projection | Separate agent owns question sufficiency, interview outcomes and rule resume | **DELETE / MIGRATE** | Delete lifecycle agent; retain only independently needed safe-text validation in the `ask_human` API boundary | W3 Human Resolution API | Delete agent and module after the request boundary adopts required safety checks. |
| `deepagents/middleware/{triage_singleton.py,triage_progress.py}`, `orchestration/lifecycle.py` triage branch | Triage singleton/progress/run lifecycle | File/worker lease and progress for Triage agent | **REWRITE** | Legal Preparation execution uses common AgentExecutionState, DB lease/outbox and canonical events; remove Triage-specific progress/lifecycle | W1, W2 | Drop old singleton/progress hooks after one-run-per-portfolio lease and event delivery pass. |
| `deepagents/tools/common/capabilities/evidence/repository_analysis/{boundary.py,analyzer.py}` | `RepositoryAnalysisBoundary`, `RepositoryDeepAnalyzer` | Model-driven Scanner/AI-discovery reasoning and callback | **REWRITE** | Deterministic repository snapshot, sandbox hydration, index coverage, source-reference plumbing; Root performs discovery | W3 Root launch/evidence tools | Remove analyzer model call and AI absence backstop when Root vertical proves repository-only discovery. |
| `.../assessment/investigation/engineering_rule/interview_gated_boundary.py` | `handle`, interview gate, Scanner/PGE gate | Orders scan, mandatory Initial Interview and rule analysis | **DELETE** | Single assessment launch to Root after pinned inputs prepare | W3 Assessment Root start adapter | Delete entire lifecycle gate after root callback/event ingress works. |
| `.../assessment/investigation/engineering_rule/engineering_assessment_boundary.py` | `run_assessment`, `_assess`, per-rule loop and legal-triage dispatch | Resolves rules, decides order/applicability, dispatches rule agents and finalizes results | **DELETE** | Root tool loop plus DRS coverage ledger and Completion Gate | W3/W4 decision tools and W4 finalization | Delete after Root vertical covers every pinned EngineeringRule and migration traffic is zero. |
| `.../assessment/investigation/engineering_rule/rule_sources.py` | `resolve_engineering_rules`, `_recover`, `_prepare` | Assessment-time portfolio resolution, recovery and lazy preparation | **REWRITE** | Read one ACTIVE persisted `LegalPortfolioVersion`, then pin it | W2 active portfolio API | Remove all recovery/cache/bundle branches after portfolio acceptance; missing portfolio is preparation/blocker, never inline compilation. |
| `.../legal/corpus/engineering_rules/orchestration/service.py` | `get_or_compile`, `prepare_from_triage`, cache/artifact storage | Chroma/cache/bundle resolution and triage persistence | **REWRITE** | Preparation agent submits a full portfolio to API; assessment reads API snapshot | W2 | Delete assessment-time compile/cache methods after active DB portfolio is the only reader source. |
| `.../planning/engineering_rule/rule_applicability_gate.py`, `rule_applicability_evaluator.py` | Deterministic `requiredFacts` applicability | Excludes rules before agent reasoning | **DELETE** | Root decides APPLICABLE/NOT_APPLICABLE using pinned EngineeringRule and accepted evidence | W4 applicability tool/DecisionValidator | Delete semantic predicates when no production caller remains; mechanical fact extraction, if any, is evidence only. |
| `.../assessment/rule_assessment/run.py`, `orchestration/context.py`, `orchestration/dispatcher.py`, `orchestration/lifecycle.py` | `analyze_rule`, `LCSPRunContext`, direct specialist invocation and task lifecycle | Creates one rule/thread/attempt and reconstructs context | **DELETE** | Native Root/task execution, LangGraph checkpointer and AssessmentRuntime | W3 Root and usage middleware | Delete per-rule run/dispatcher/semantic lease once Root task and usage lineage pass. |
| `.../evaluation/engineering_rule/rule_evaluator.py`, `rule_completion_gate.py`, `claims_for_rule` | `EngineeringRuleEvaluator`, semantic rule outcomes | Deterministically turns evidence/claims into applicability/compliance/UNKNOWN | **DELETE** | Root-authored decisions; structural DecisionValidator and deterministic Completion Gate | W4 | Remove evaluator and semantic fallbacks; retain no second judge after decision eval acceptance. |
| `.../assessment/rule_assessment/validation.py`, `.../claims/evidence_claim/evidence_claim_validator.py`, evidence-ref/HMAC/citation utilities | Evidence and decision validation | Trusted evidence/source integrity with some old per-rule result semantics | **KEEP** | Reuse source/provenance/tenant/revision checks in V2 EvidenceValidator; split out only mechanical checks | W3 evidence schema | Keep only validators with V2 callers; delete legacy criterion semantics and aliases. |
| `.../assessment/rule_assessment/{absence_policy.py,values.py,neutral_text.py}` and `submit_rule_assessment` | NOT_OBSERVED, technical unresolved, business context, question/evidence submission | Per-rule uncertainty and Interview handoff | **REWRITE** | SearchCoverageEvidence, Root decision submission, `ask_human` and safe request validation | W3/W4 | Remove old values and per-rule submit tool after evidence/HITL contract cutover. |
| `.../planning/engineering_rule/{confirmed_context_pack.py,confirmed_business_context.py}` and context packing | Confirmed-context pack and legacy field normalization | Rebuilds customer facts into per-turn/per-rule prompt | **DELETE** | `AssessmentCase` reads through Root tools; Deep Agents owns working context | W3 case API | Delete pack and compatibility aliases after accepted facts backfill and no callers remain. |
| `.../workflow/recovery/{interview_boundary.py,interview_pause_boundary.py,post_guard_continuation.py}`; `orchestration/waiting_assessments.py` | Interview resume, pause, JSON waiting registry and replay | Parallel checkpoint/continuation/readiness state | **DELETE** | LangGraph interrupt/checkpoint plus server command/outbox/idempotency | W3 Root resume | Delete after crash/restart and HITL replay tests; retain generic outbox and lease infrastructure. |
| `.../evidence/repository_analysis/targeted_boundary.py`; targeted-reanalysis API/controller/BFF/web; Prisma `TargetedReanalysisRequest` and `TargetedReanalysisCheckpoint` | Scoped retry scanner, worker checkpoints and output reports | Custom targeted reanalysis state machine | **DELETE** | Root continues from same checkpoint; stale RuleDecision becomes INVALIDATED and DRS returns to investigation | W3/W4 same-thread root continuation | Delete endpoints/models/jobs after pending requests are archived and no external publisher remains. |
| `apps/api/src/modules/legal-rule-catalog/application/services/rule-catalog-version.service.ts` | `recoverApprovedRulesFromActiveCorpus`, regex LegalRule factory, draft/version operations | Creates chunk-per-rule APPROVED rows with `aiDetected=confirmed` sentinel | **DELETE** semantic factory; **REWRITE** remaining catalog service | Agent-authored LegalRule and EngineeringRule portfolio | W2 portfolio API/agent | Delete factory and human draft/approve methods after new portfolio activation vertical passes. |
| `.../legal-corpus.service.ts` | ingest, hash/chunk validation, classifier, review signoff, corpus activation | Source ingestion plus duplicated regex classification and signoff | **REWRITE** | Keep hash/source/hierarchy/retrieval checks; remove normative regex and human review branch; activate whole portfolio atomically | W2 source/portfolio contract | Remove human signoff and duplicate classifier after historical approvals are archived. |
| `.../admin-corpus-versions.service.ts`, admin controllers/routes/client/page | Prepare, publish, discard, list/detail | Manual publication gate and corpus-only preparation | **REWRITE** | Prepare triggers complete Legal Preparation; read-only version history; automatic valid activation | W2 | Delete publish/discard routes/UI once automatic portfolio route is active. |
| `.../legal-rule-catalog.controller.ts` draft/approve/recover/manual-ingest routes | LegalRule and corpus authoring endpoints | Parallel human/legal recovery entrypoints | **DELETE** those writes; **REWRITE** portfolio ingest | One worker-authenticated submit/validate/activate API; read-only history | W2 | Delete every old write route after caller inventory is zero; keep source/history reads only. |
| Python `legal_corpus_recovery_driver.py`, `legal_corpus_recovery_boundary.py`, registered `LegalChangeDetectorBoundary` | Crawl/ingest/index/recovery and source-change detection | Recovery pipeline with mechanical rule factory and assessment callbacks | **REWRITE** | One source-acquisition-to-preparation-to-validation-to-activation job; registered cron/source-change event triggers it | W2 | Delete recovery-only and assessment-resume branches after automatic portfolio pipeline is live. |
| `deepagents/schedules/legal_catalog_daily.py::LEGAL_CATALOG_MAINTENANCE_PROMPT` | Unwired/exported legacy maintenance prompt | No scheduler registration in this checkout | **DELETE** | Keep the registered deterministic change detector; have it enqueue the canonical Legal Preparation command | W2 | Delete the prompt/export and its obsolete test reference; do not count it as a current production preparation path. |
| Python `triage/legal_rule_triage/{service.py,code.py,boundary.py,contracts.py}`; `subagents/triage/definition.py`; `skills/legal-rule-triage/SKILL.md` | Legal Rule Triage work items/proposals | LLM authors EngineeringRules only after mechanical LegalRules; has NEEDS_INPUT and assessment readiness trigger | **REWRITE** | Separate Legal Preparation Deep Agent authoring both layers; one portfolio submit tool | W2 | Delete “triage” role, NEEDS_INPUT, readiness listener and old skill after legal vertical acceptance. |
| `.../engineering_rules/compilation/{compiler.py,chunk_triage.py}` and normative filters/classifiers in Python/API | Second compiler and duplicate obligation-term regex | Duplicate legal semantics/generation gate | **DELETE** LLM compiler and regex meaning; **REWRITE** structural exclusions | Legal Preparation agent interpretation; retain only deterministic heading/hash/reference mechanics | W2 | Delete all semantic regex and duplicate LLM call paths when new legal integrity validator passes. |
| Chroma `EngineeringRuleCache`, precompiled registry/overrides/export/import, checked-in bundle, Docker COPYs | Assessment-time EngineeringRule source and fallback | Parallel cache, bundle and build-time rule portfolio | **DELETE** | PostgreSQL ACTIVE portfolio is sole reader | W2 active portfolio and W3 reader cutover | Delete after DB portfolio has passed full production vertical and all image references are removed. |
| `restore-legal-corpus-artifacts.ts`, `restore_engineering_rule_artifacts.py`, `artifact_store.py` | Restore catalogs/rules from filesystem artifacts | Fabricates approved catalog or restores cache copy | **REWRITE** corpus source restore; **DELETE** rule/cache restore | Re-run preparation or restore immutable DB portfolio; source crawl artifacts remain operational | W2 | Delete rule restore when authoritative DB backup/rebuild is proven; keep only legal source acquisition artifacts as required. |
| `build_reviewed_legal_corpus.py::{parse_chunks,normalize_source_effect_status}`, `reviewed_corpus_input_boundary.py`, `reviewed_corpus_input_builder.py`, `legal_chunk_builder.py`, `legal_chunks/**` | Deterministic parse/OCR/normalization/chunk integrity | Source quality gates, plus second reviewed-input workflow | **REWRITE** | One acquisition pipeline retains normalization/chunk/hash verification; no signoff workflow | W2 | Remove duplicate boundary after single acquisition pipeline consumes same verified source records. |
| `orchestrate_reviewed_legal_corpus.py`, `normalize_vbpl_document.py`, warm/export/import/operator legal scripts, `author-law-134-baseline-catalog.ts` | Manual signoff, manual catalog, bundle import/export/warm | Unwired, obsolete, broken, or human approval operations | **DELETE** | Automatic source-change/admin prepare trigger | W2 | Delete immediately after CI/test fixtures move to portfolio API; preserve historical migrations only. |
| `packages/contracts/src/legal-rule-catalog/**`; Prisma `LegalRuleCatalogVersion`, `LegalRule`, `RuleApprovalRecord` | Approval-centric catalog/schema/contracts | No first-class persisted EngineeringRule portfolio; approval appears as authority | **REWRITE / MIGRATE** | `LegalPortfolioVersion`, versioned `LegalRule`, first-class `EngineeringRule`, activation record | W1, W2 | Drop V1 schema/models after history archive and migration upgrade acceptance. |
| `apps/web/src/features/admin/**corpus-versions**`, corpus version routes/client, i18n publish/discard keys | Admin legal version management | Person publishes/discards legal output | **REWRITE** | Read-only history and “prepare” command; customer-facing strings in i18n | W2 | Remove publish/discard actions and keys at legal UI cutover. |
| `AssessmentRuntimeEvent`, Python `agent_stream.py`, API runtime DTOs, web activity projection | Per-run/stage/tool event models | Separate event/status projections and synthesized stage events | **MIGRATE / REWRITE** | One AssessmentEvent envelope; keep event details as activity and usage references | W1 envelope, W5 projection | Drop old event columns/types after historical event archive and stream cutover. |
| `deepagents/skills/interview-context/**`; interview and triage-only docs/prompts | Procedure for mandatory Interview/legacy Triage | Encodes deleted role boundaries | **DELETE** interview package; **REWRITE** legal and assessment skills | Reviewed `human-resolution`, `legal-preparation`, and LCSP assessment procedures | W2/W3 root flows | Delete old folders and terminology after source and CI no longer reference them. |
| `apps/api/prisma/schema.prisma` `VerifiedAgentEpisode`; memory policy code | Per-assessment “verified episode” storage | Assessment-scoped raw/derived episodes | **MIGRATE** | Preserve only as assessment-private historical/checkpoint data; separate future sanitized Deep Agents Store | W3 memory isolation | Drop old shared-write/read path after retention/archive validation; never bulk-promote episodes. |
| Assessment report/document API, `DocumentRequest`, report worker/UI | Queued report generation | Report request status mixed with prior readiness/classification | **REWRITE** | Completion-gated immutable `AssessmentArtifact`; request points to artifact | W4 artifact/gate, W5 UI | Remove direct report generation bypasses after report gate integration and artifact migration. |
| API GET/readiness, `stage-lifecycle.ts`, web duplicate finished/status derivation | Assessment-level lifecycle calculation | Multiple API and browser lifecycle authorities | **DELETE** derivations; **REWRITE** reads | One persisted ALS read; DRS counts and events for display | W1 coordinator/contract, W5 | Delete old calculated states after all reads, UI controls and reconciliation use ALS. |
| `.github/workflows/test.yml`, assessment/legal legacy verticals, fixtures/seeds | V1 release evidence | Scripted Interview/per-rule path and db-push tests | **REWRITE** | Required portfolio, root, migration-upgrade, isolation, HITL/restart, completion and browser gates | W2–W6 acceptance | Remove old vertical/seed only when replacement checks are required and green. |

## 8. Production data migration

Migration is forward-only: expand schema, archive unsafe history, build and validate the V2 portfolio, backfill accepted facts/evidence, atomically cut readers/writers, then drop old active tables in a later migration. Historical SQL migrations stay. No old runtime is simultaneously authoritative. The pre-cutover database snapshot and old deployment are the rollback point; after V2 writes start, use forward repair from the preserved archive rather than a down migration or V1 fallback.

| Persisted production object(s) | Current representation -> target | Forward migration and backfill | Stale/unsafe data handling | Rollback strategy | Removal timing |
|---|---|---|---|---|---|
| `LegalCorpusVersion`, `LegalSourceDocument`, `LegalSourceSnapshot`, `LegalDocumentChunk`, `LegalRetrievalIndex`, `CorpusPreparation`, `CorpusApprovalRecord`, `CorpusDiscardReceipt` | Approval-centric immutable source rows -> immutable corpus/artifact rows plus portfolio activation record | Preserve source IDs, manifests, official-source snapshots, hierarchy, effect status, exact bytes/locators, hashes, retrieval-index validation and ingestion times. Reclassify approval rows as historical ingestion/activation audit; create a new activation record only after the generated portfolio validates. | Re-hash sources and chunks; invalid/repealed/superseded sources cannot be pinned. Keep old bytes for provenance. | Keep previous ACTIVE pointer unchanged on failed prep; before cutover restore DB snapshot; after cutover repair forward from source rows. | Keep source history by retention. Drop only duplicate approval/discard workflow tables after audit history is copied and callers removed. |
| `LegalRuleCatalogVersion`, `LegalRule`, `RuleApprovalRecord`, `LegalRuleMatch`, old classification profile links | Regex-created chunk rules and human/automatic approval rows -> LegalRule/EngineeringRule versions in one LegalPortfolioVersion | Do not promote existing `AUTO-*`, DEV, manually drafted, restored, or approved rows as agent-authored V2 legal meaning. Re-run Legal Preparation against each production source corpus required for new assessments; persist a complete portfolio and exact corpus/legal lineage. Archive V1 rows and matches with IDs and old reports. | All old semantic rule results are historical only. Any source/prompt/fingerprint mismatch is stale; no retargeting cached IDs. | Old catalog remains readable only in the pre-cutover snapshot/archive; V2 activation failure leaves prior V2 ACTIVE portfolio (or blocks new assessments if none). | Drop active V1 catalog/rule/approval/match tables only after portfolio backfill, pin audit and report-history retrieval pass. Keep source historical audit under retention. |
| EngineeringRule cache, precompiled JSON bundle, overrides, Chroma records, recovery artifacts | Multiple runtime sources -> no runtime rule data outside DB portfolio | Rebuild portfolio in PostgreSQL; export hashes/counts for reconciliation. No cache/bundle rows are copied as authority. | Quarantine cache/bundle records whose corpus/catalog identity cannot be proven; never `_retarget_cached_rules`. | Keep image/DB backup for pre-cutover restore only; no runtime fallback after V2 activation. | Remove images/files/collections after new portfolio reader is deployed and no old worker can read them. |
| `Assessment` and old `AssessmentStatus` | Wizard/scan/review/AI absence statuses -> canonical lifecycle and revision | For each non-terminal V1 assessment, preserve assessment ID, tenant/owner and scope; create canonical ALS `PREPARING`, a revisioned `AssessmentCase`, pin the validated repository snapshot and new ACTIVE portfolio, then allocate one new server-owned Root thread. Start Root only after backfill commits. Terminal V1 assessments move to immutable `LegacyAssessmentArchive`; do not invent a V2 completion from old status. | Missing/restorable repository or required inputs map to `WAITING_FOR_REQUIRED_INPUT`; irrecoverable dependency maps to `BLOCKED` with its exact reason. `UNKNOWN`, `PARTIAL`, `AI_NOT_DETECTED`, and `READY_FOR_REVIEW` do not become decisions or canonical completion. | Pre-cutover backup restores old deployment. After V2 start, repair forward; archive lets operators reconcile without reviving old runtime. | Remove old status enum/columns and terminal V1 rows from active runtime after all active records are restarted or archived and archive access is verified. |
| `AssessmentInterviewThread` and private context/revision JSON | Interview thread/question state -> AssessmentCase accepted facts and HumanResolutionRequest | Copy only explicitly accepted facts with authenticated actor, source/provenance, and consistent revision. Convert an active material question to `HumanResolutionRequest` only when its exact assessment, need, and revision validate; answer resumes the new Root thread. Keep raw thread/checkpoint in private archive until retention expires. | Stale/ambiguous/unproven facts are not promoted. Stale question becomes superseded; Root re-investigates. Never copy whole interview scratchpad into shared memory. | Restore snapshot before V2 writes; otherwise use archived record and reopen with same assessment ID through V2. | Drop Interview table/service after migrated requests/facts and privacy archive reconcile. |
| `EngineeringRuleAssessment`, criteria JSON, limitations, execution JSON; deterministic evaluator outputs | Per-rule result rows -> DRS coverage plus new RuleDecision history | Preserve V1 payload as read-only historical evidence. For active assessments, initialize each V2 rule coverage `PENDING`/`INVESTIGATING`; Root re-evaluates every pinned EngineeringRule. Do not transform old “compliant”, “unknown”, “not observed”, or `NOT_APPLICABLE` into accepted V2 decisions. | Invalidate every V1 semantic decision for live V2 finalization; no stale or evaluator-authored decision can pass Completion Gate. | Archived source allows audit; old data is not replayed into V2 judgment. | Drop active V1 model after V2 decision ledger and historical retrieval pass. |
| `RepositorySnapshot`, `RepositoryScanJob`, `TechnicalEvidenceReport`, `TechnicalProfile`, `AIUsageFlow`, `ConflictRecord` | Snapshot and Scanner/PGE outputs -> pinned repository source plus AssessmentEvidence/SearchCoverageEvidence | Keep immutable snapshot/commit, connection provenance, job IDs and safe source refs. Convert only independently verifiable source references, accepted document/runtime facts, index coverage and tool versions into typed V2 evidence; retain raw reports as acquisition history. | Revalidate hash, commit, tenant, privacy flags and accepted status. `PARTIAL` becomes explicit coverage/gap metadata, never a decision. Stale snapshots invalidate dependent V2 evidence/decisions. | Restore snapshot before cutover; after, fresh source inspection creates new evidence at a new revision. | Keep snapshot/acquisition records per repository retention. Drop Scanner output readers/writers when Root investigation no longer consumes those formats. |
| `TargetedReanalysisRequest`, `TargetedReanalysisCheckpoint` and associated scan/output records | Bespoke targeted worker workflow -> same-thread Root continuation | Archive requests and idempotency/correlation metadata. Close/cancel pending requests at quiescence. Completed output report is accepted only after normal evidence provenance validation and matching pinned snapshot; otherwise archive as stale. | Pending/stale scopes are never replayed into V2. V2 marks affected decisions `INVALIDATED` and lets Root continue. | No reverse workflow migration. Recover via Root checkpoint or forward repair. | Drop request/checkpoint tables and routes after zero pending deliveries and archive verification. |
| `AssessmentRuntimeTurn`, manual `checkpointJson`, old LangGraph checkpoints, `AssessmentRuntimeEvent` | Multiple turn/thread IDs, control/run/stage events -> one AssessmentRuntime mapping and AssessmentEvent log | Stop old workers and drain/settle outbox. Archive V1 turns/events; create exactly one new Root `threadId` for each active assessment, add unique DB constraints, and initialize canonical event sequence/revision. New LangGraph checkpoints use that server mapping. | V1 checkpoint state is not resumed because it encodes Interview/per-rule semantics. Archived event/stage labels never set V2 lifecycle. | Restore old snapshot only before V2 writes; after cutover resume only V2 namespace and use archive for historical inspection. | Delete manual checkpoint columns and V1 event columns/tables once restart/replay and archive queries pass. |
| `PipelineReconciliation`, pending old assessment outbox messages, `OutboxMessage` | Old continuation and queued command messages -> canonical commands and generic delivery reliability | Preserve generic outbox/idempotency. Drain old start/triage/interview/targeted commands; mark obsolete undelivered commands terminal with an audit record. Re-enqueue only typed V2 preparation/resume commands under canonical identity. | Never deliver a V1 command after cutover. Reconcile orphaned command refs from durable Assessment/Runtime state. | Pre-cutover restore only; after V2, use idempotent outbox replay. | Drop `PipelineReconciliation` and legacy command consumers after queue depth is zero and replay gate passes; retain generic outbox. |
| `DecisionModelDecision`, `DecisionModelEvent` | Separate decision-model/shadow output | Archive as non-authoritative history; no V2 writer or reader | Their semantic output is stale/untrusted and never imported to RuleDecision or completion. | Archive only | Drop model after archive/history path is verified; no shadow write period. |
| `VerifiedAgentEpisode`, `VerifiedProfile`, `ClassificationResult`, `ClassificationReviewRequest` | Assessment-linked episodes/profiles/classifier/review records | Preserve assessment-linked episode/profile data in private archive; only explicitly accepted and source-verifiable facts are backfilled into Case/Evidence. Target sanitized Store begins empty and receives future governed promotions only. | Never bulk-promote or cite as evidence; classifier/review conclusions do not become RuleDecision. | Archive is the recovery source; never restore into shared memory. | Drop active V1 writers/readers after private archive and retention validation. |
| `DocumentRequest`, existing generated report blobs, `ReadinessExport`, `AuditExportRequest` | Request/document status and old final/readiness files | Keep request IDs/actor/timestamps. Copy immutable old report bytes and hashes into `LegacyAssessmentArchive`; new V2 final report metadata lives only in `AssessmentArtifact`, referenced by its request. Readiness/audit exports remain their own artifact types. | Old report is explicitly historical and is not V2 final evidence. In-flight legacy generation is cancelled/drained; new report requires Completion Gate. | Restore old snapshot before V2 writes; after, historical blob archive preserves user access. | Keep general document/export requests; remove direct V1 final-report generation/status path once V2 artifact path is proven. |
| `Assessment` foreign-key resources, `AuditEvent`, billing reservations/usage ledger | Mixed old assessment references and accounting | Keep tenant and audit identity. Preserve stable `invocationId`, token/cost settlement, billing idempotency and owner links; new events/reference IDs point to V2 executions. Reconcile in-flight reservations at quiescence. | Accounting failure cannot change legal result; uncertain reservations reconcile against authoritative ledger, not UI totals. | Existing ledger remains rollback/reconciliation authority. | Retain these authorities; remove only old runtime-stage usage aggregation when event token refs are used. |
| LangGraph checkpointer/store rows and assessment sandbox/filesystem | Thread-scoped state and local workspaces | Create a single new namespace per live assessment; preserve V1 checkpoint/workspace in private archive until retention expiry; no cross-assessment key reuse. | Validate namespace ownership; delete stale, orphaned, or mismatched checkpoints; never auto-import a V1 scratchpad. | Restore only from pre-cutover DB/checkpoint backup before V2 writes; otherwise rebuild from accepted domain state and continue V2. | Delete V1 namespaces after archive and retention window; retain active V2 namespaces until assessment retention deletion. |

## 9. Legacy deletion manifest

The following architecture is absent from the final production source, runtime images, APIs, and UI. Historical migrations and explicitly labeled read-only archive data may remain; no runtime code reads them as authority.

| Legacy architecture | Final action and replacement |
|---|---|
| Model-driven Scanner/AI-discovery reasoning stage | **DELETE** analyzer model call, AI absence payload/backstop, Scanner lifecycle. Keep deterministic snapshot fetch, sandbox/index preparation, source minting, and truthful coverage facts; Assessment Root discovers use cases. |
| Mandatory Initial Interview and context-sufficiency gate | **DELETE** all modes, `CONTEXT_READY` gates, synthetic confirmations and startup questions. Root begins investigation from available inputs. |
| Interview agent lifecycle and separate Interview root/thread | **DELETE** agent, stage, thread authority, exact-rule resume and Interview-owned transitions. Replace with HumanResolutionRequest and same Root interrupt/resume. |
| `interview-context` legacy skill package | **DELETE** after human-resolution tool and skill are live. |
| One EngineeringRule equals one Repository Analyst dispatch/thread | **DELETE**. Researcher is generic, bounded, ephemeral, and delegated only by native Root `task()`. |
| Python per-rule orchestration and `EngineeringAssessmentBoundary` loop | **DELETE**. Root reasons over the pinned portfolio and shared evidence ledger; DRS records coverage only. |
| Custom targeted reanalysis workflow | **DELETE** API/web endpoints, boundary, queue types, request/checkpoint tables and scope-specific scanner run. Same-thread Root continuation and stale-decision invalidation cover follow-up. |
| Duplicate context-pack machinery and manual context reconstruction | **DELETE** Confirmed/Repository Intelligence/Planner/Investigator packs, seed windows, context snapshots, and hand-built resume reconstruction. Domain facts live in AssessmentCase; working context lives in the Root checkpoint. |
| Deterministic semantic compliance judge | **DELETE** EngineeringRuleEvaluator and all semantic fallback paths. DecisionValidator checks packet structure/provenance only; Root decides. |
| Universal deterministic applicability judge | **DELETE** requiredFacts/regex/ exact-match applicability authority. Facts may be machine-verified evidence; Root decides applicability. |
| Human LegalRule approval/signoff semantics | **DELETE** `APPROVED/REJECTED` as semantic authority, RuleApprovalRecord, reviewer signoff, draft/approve/publish/discard routes, and `humanLegalSignoffRequired`. Activation follows agent generation plus mechanical validation. |
| Duplicate normative regex classifiers | **DELETE** obligation-term/normative semantic regexes in TypeScript and Python. Retain only mechanical source parsing, hash validation, and structural hierarchy normalization. |
| Assessment-triggered legal recovery, lazy compilation, cache/bundle fallback | **DELETE** `_recover`, `get_or_compile`, triage readiness wait/reentry, Chroma authority, precompiled bundles, image copies and rule artifact restore. Assessment reads the pinned ACTIVE portfolio only. |
| `PARTIAL` final assessment/decision | **DELETE** value sets and all finalization paths. Partial acquisition is typed coverage metadata; incomplete decision coverage blocks finalization. |
| Final `UNKNOWN` assessment or rule result | **DELETE**. Work remains investigating, waits for input, is blocked, or fails; it never becomes a final verdict. |
| Duplicate API/web lifecycle derivation | **DELETE** `deriveStageLifecycles` as lifecycle authority, event-recency liveness, browser fallback state calculation, duplicate finished-status constants, and write-on-read timeout transitions. Read persisted ALS; explicit timeout worker performs durable failure transitions. |
| WaitingAssessmentRegistry/PostGuardContinuationStore and triage resume state machine | **DELETE**. LangGraph checkpoint plus API outbox/lease/idempotency is the only resume mechanism. |
| Parallel shadow evaluator, V1 runtime feature flag, compatibility aliases/adapters/fallback routes | **DELETE / DO NOT ADD**. The production cutover activates one path after acceptance; release rollback is external deployment/database restore. |

## 10. Final production flow

**A. Legal portfolio generation/update.** Official-source change detection or the explicit preparation command starts one idempotent Legal Preparation execution. Deterministic acquisition pins source bytes, legal status, hierarchy and hashes. The agent reads operative provisions with definitions, scope, exceptions and cross-references; authors the complete LegalRule/context graph and EngineeringRules; submits once. The integrity validator checks schema, coverage, IDs, links, citations, version/hash/effect status and absence of orphan references. One transaction activates the validated portfolio and supersedes the previous pointer. There is no approval. Failure leaves the previous ACTIVE portfolio unchanged.

**B. Assessment creation.** The API authorizes tenant and actor, creates `Assessment(CREATED)`, creates the one-to-one `AssessmentRuntime` with server-generated unique thread ID, pins the then-ACTIVE legal portfolio and repository snapshot, initializes case revision/evidence coverage, then transitions to `PREPARING`. Once snapshot/sandbox/required inputs are valid, the coordinator sets `ACTIVE` and enqueues the Root on that same thread. Missing restorable non-human input waits in `WAITING_FOR_REQUIRED_INPUT`.

**C. Root reasoning.** Root loads only that assessment’s case, pinned portfolio, pinned repository, accepted evidence and selected sanitized heuristics. It discovers use cases and facts, reviews every EngineeringRule, plans investigation, reuses evidence across rules, and updates DRS through governed tools.

**D. Subagent delegation.** Root calls native `task()` only for a bounded repository research question when it helps parallelize or isolate context. Researcher is read-only for assessment semantics and shared memory. Its events retain assessment/root/task lineage; it returns source refs and findings to Root. Root verifies refs through the server and remains responsible for accepting evidence and decisions.

**E. Applicability.** Root decides `APPLICABLE` or `NOT_APPLICABLE` for every pinned EngineeringRule using legal context, case facts and verified evidence. A non-applicable rule has a rationale and evidence/fact refs; compliance remains null. A missing fact triggers further investigation or a request, never automatic exclusion.

**F. HITL.** After tools and existing evidence cannot answer a material human-owned fact, Root opens a HumanResolutionRequest with decision impact and customer-safe wording. The coordinator transitions to `WAITING_FOR_HUMAN`; LangGraph interrupts. API validates answer actor, request, tenant, case revision and provenance, records fact/evidence, and resumes the exact thread when all blockers clear. “I do not know” leaves the request open; Root searches alternatives or the coordinator marks the assessment BLOCKED only when the fact is unobtainable under the contract. Humans never approve a conclusion.

**G. Compliance.** For applicable rules, Root interprets evidence and decides each required criterion `MET`/`NOT_MET`, then `COMPLIANT`/`NON_COMPLIANT`. DecisionValidator checks exact rule/version/scope, criterion completeness, accepted refs, current revisions, human fact authority and structural coherence. It does not re-evaluate meaning.

**H. Bounded absence.** Root records authenticated SearchCoverageEvidence for relevant directories, graph/index coverage, queries, inspected entrypoints and known gaps, with direct-source fallback where required. The guard confirms the coverage is genuine and matches the pinned commit. Root decides if absence is sufficiently supported. No deterministic rule equates “not found” with “not compliant.”

**I. Completion gate.** Root requests finalization. The gate verifies active pinned portfolio and repository snapshot; one resolved RuleDecision per in-scope EngineeringRule; complete applicable criteria/compliance; valid current evidence; no stale decisions, open human requests, required inputs, unresolved execution failures or pending coverage. It returns blockers or authorizes the sole coordinator transition `ACTIVE -> FINALIZING`.

**J. Report generation.** Root synthesizes only frozen accepted state into the final report and remediation narrative. Report generation cannot add evidence or alter decisions. Structural artifact validation checks references, schema, hashes and pins; semantic acceptance requires no open-question, UNKNOWN or PARTIAL outcome/language. On success, the artifact is persisted and the coordinator sets `COMPLETE`. No report endpoint or worker can bypass the gate.

**K. Pause, resume, restart, stop and cancel.** Stop/pause interrupts at a safe point and sets `PAUSED`; continue/resume reuses the exact Root thread and domain state. Crash/restart resumes from LangGraph checkpoint after validating server thread mapping and current revisions. Retry creates a new AgentExecution attempt with stable assessment/thread identity and idempotent evidence/decision writes. Cancel is terminal. Fatal unrecoverable runtime errors become `FAILED`; transient provider failures stay execution-level and retry.

**L. Legal portfolio supersession.** New assessments pin the new ACTIVE portfolio after automatic validated activation. Existing assessments remain pinned to their immutable portfolio version and report that as their as-of legal basis; activation does not silently retarget or rewrite their decisions. A source/rule/repository/case revision change to an assessment’s own pin invalidates dependent evidence and decisions and returns affected DRS to investigation. To assess a superseding legal basis, create a new assessment; no hidden rebasing or stale verdict reuse occurs.

**M. Assessment deletion and retention.** A tenant-authorized deletion command cancels execution and open requests, revokes thread/sandbox access, and applies configured retention/legal-hold policy to evidence, artifacts and audit rows. Delete or cryptographically erase the assessment checkpoint and sandbox when eligible. Shared learning remains only if it is independently sanitized and has no assessment identifiers or raw facts. Event payloads contain no raw customer content; archive access is tenant-authorized and read-only.

## 11. Implementation DAG

All implementation work begins from this freeze. No downstream worker may define or consume new lifecycle, execution, decision, artifact, blocker, or event values before W1 contract acceptance. File ownership below is exclusive for each wave; shared files are edited only by the named owner in serialized order.

### W1 — canonical contract/state foundation (first implementation wave)

1. **W1.1 Contracts owner — first and blocking task.** Add the canonical TypeScript `as const` values and derived types for ALS, AES, DRS, ALCS, BlockerReason, decision data and AssessmentEvent in `packages/contracts/src/assessment/agentic-runtime.ts`. Add the exhaustive transition table and request/event schemas. Use no TypeScript enums or hand-written literal unions. Python agents submit typed domain/activity commands only; API owns state values, transition validation and event-envelope construction, so there is no Python lifecycle mirror. Exclusive ownership: `packages/contracts/src/assessment/agentic-runtime.ts` and its export entry only.
2. **W1.2 Persistence owner — after W1.1 merges.** Add canonical lifecycle revision on Assessment, one-to-one AssessmentRuntime with unique assessment/thread constraints, AssessmentEvent persistence/outbox ordering, and required indexes/foreign keys in `apps/api/prisma/schema.prisma` and one ordered migration. Use uppercase Prisma enum members for closed persisted sets. Exclusive ownership: Prisma schema/migration tree; all other schema edits queue behind this owner.
3. **W1.3 API lifecycle owner — after W1.1/W1.2.** Implement the sole `AssessmentLifecycleCoordinator` and read service; all lifecycle mutations use revision-CAS plus same-transaction AssessmentEvent. Assessment GET and runtime snapshot return stored ALS. Read paths are pure; explicit reconciliation performs timeout transitions.
4. **W1.4 UI projection owner — after W1.1 and the W1.3 response contract.** Make workspace status, controls and screen/action availability consume ALS/AES/DRS; event projection renders activity only. Missing lifecycle data displays unavailable and never infers state.

**W1 integration gate:** shared packages/API/web typecheck; exhaustive transition tests accept only the table above; concurrent stale transitions reject; lifecycle row and event commit atomically; sequence/idempotency are monotonic; API/SSE agree; browser code cannot write or derive lifecycle; legacy values are absent from canonical contract exports. Only after this gate may W2/W3 consumers add states or write lifecycle.

### W2 — single legal portfolio path

1. Persistence owner adds `LegalPortfolioVersion`, versioned `LegalRule`, first-class `EngineeringRule`, context relations/provenance, and activation audit record; this migration follows W1’s Prisma migration and is serialized by the same schema owner.
2. API legal owner turns source acquisition/validated ingest into one `submit portfolio -> validate -> atomically activate` boundary; removes signoff/draft/publish/discard writes and approval records. Deterministic legal/source/hash/citation integrity stays.
3. Deep Agents legal owner rewrites Triage as the single Legal Preparation Deep Agent that authors both LegalRule and EngineeringRule against one pinned corpus. It has no assessment/customer repository context and no human review handoff.
4. Schedule/admin triggers call the same preparation command. Assessment path becomes read-only to the ACTIVE portfolio. CI/agent eval owner replaces current triage vertical with complete portfolio and legal context evals.

**W2 integration gate:** corpus-to-portfolio live vertical; definitions/scope/exceptions/cross-references preserved; every in-scope provision covered or agent-declared non-assessable with a reason; non-repository duty represented; fake/stale/repealed refs and duplicate/orphan IDs rejected; invalid run leaves old ACTIVE unchanged; automatic activation succeeds without human endpoint or approval row; exactly one API runtime reader.

### W3 — assessment domain and isolated Root runtime

1. Persistence owner (serialized after W2 schema) adds AssessmentCase, AssessmentEvidence, HumanResolutionRequest, RuleDecision/decision history, SearchCoverageEvidence subtype, AssessmentArtifact metadata and DRS coverage constraints.
2. API assessment owner adds authority-checked case/evidence/request/decision tools and DecisionValidator, preserving tenant, provenance, exact source pin, revision, idempotency and stale invalidation.
3. Python runtime owner makes `create_assessment_root_agent` the only assessment entrypoint, binds it to server AssessmentRuntime.threadId, and registers the bounded generic Repository Researcher using native `task()`.
4. Repository runtime owner keeps deterministic snapshot/sandbox/index/source-ref tooling; it removes model-driven Scanner and callback-based decision gates. One root run covers the entire portfolio.

**W3 integration gate:** one assessment creates exactly one unique root thread; subtask refs are descendants; researcher cannot mutate customer/domain decisions; accepted facts/evidence survive compaction/restart; concurrent tenants/assessments have disjoint namespaces; root loads one immutable ACTIVE portfolio and covers every EngineeringRule.

### W4 — agentic decisions, HITL, bounded absence, finalization

1. Root tools submit applicability, criteria and compliance with all semantic choices owned by Root. DecisionValidator checks packet/provenance only.
2. Human Resolution API persists answer/fact revision and interrupts/resumes same Root checkpoint; investigate-before-ask is part of Root instructions/evals.
3. Search coverage is accepted as authenticated evidence; Root decides sufficiency and absence meaning.
4. Completion Gate validates all decision and input invariants; Root produces frozen final report; artifact persists before COMPLETE.

**W4 integration gate:** agent evals cover applicable/not-applicable, criterion outcomes, compliant/non-compliant, material question, and bounded absence; zero deterministic semantic evaluator authority; open request/input, stale evidence, missing rule coverage, or failed execution always blocks report; one positive fully closed assessment reaches COMPLETE without UNKNOWN/PARTIAL/open-question output.

### W5 — API/web cutover and events

1. API owner removes old Interview/stage/readiness lifecycle projection and exposes canonical Assessment/Runtime/Event response. Generic outbox, authorization, billing and scan/resource-local statuses remain.
2. Web workspace owner removes local assessment lifecycle inference and consumes canonical state plus event activity; admin legal page exposes preparation/history without publish/discard.
3. i18n owner removes Scanner/Interview/approval/readiness copy and adds lifecycle/HITL/activity labels through `@lcsp/i18n`.
4. Browser acceptance owner verifies create, question/answer, stop/continue, report and terminal display in a real browser.

**W5 integration gate:** API reads, SSE, selectors, controls and report downloads agree on the persisted lifecycle; UI has no state mutation or fallback; browser flow passes against API-backed V2 records.

### W6 — production archive/backfill/cutover

1. Quiesce old workers; drain/cancel obsolete legal-recovery, Interview and targeted-reanalysis outbox messages; snapshot database, checkpoints, artifact store and images.
2. Create and validate required active legal portfolio versions; fail closed if no validated ACTIVE portfolio exists.
3. Run idempotent, restartable backfill in a production-shaped copy; archive V1 terminals; create V2 case/evidence/thread for non-terminals; never promote V1 semantic decisions.
4. Validate counts, hashes, tenant FKs, pins, unresolved requests, unique threads, artifact retrieval, billing reconciliation and replay. Then cut all API/worker/web traffic to V2 atomically. There is no dual writer or shadow evaluator.

**W6 integration gate:** clean install and V1 upgrade migration both pass; second run is idempotent; sampled records reconcile; no old outbox delivery, active old execution, unpinned V2 record or shared-memory content exists; rollback snapshot is available until first accepted V2 write.

### W7 — hard deletion and production release proof

After W2–W6 gates, delete legacy paths in §9, remove old contract exports/jobs/image assets, drop old tables in a later migration after retention/archive verification, and make the V2 suites required CI checks. Run production-shaped staging acceptance and post-deploy synthetic canary with sanitized logs.

**Parallel work:** after W1.1, legal-source acquisition refactor and assessment-domain tool design may proceed in separate owned directories; legal-agent prompt/eval work and API portfolio boundary work may proceed in separate directories once submit contract is frozen; web projection can proceed after W1 contract plus finalized API response shape. Shared Prisma files, contract state source, lifecycle service, Legal Preparation entrypoint, and Assessment Root entrypoint each have one owner and are serialized at the stated gates.

**Serialized tasks:** contract/state foundation merges first; every Prisma schema/migration change is applied by the single persistence owner in dependency order; legal portfolio activation must pass before assessments may pin it; V1 workers are quiesced before backfill; backfill checks pass before traffic switches; destructive table/image/path removal follows successful V2 traffic and archive verification.

**Release rule:** a failed gate blocks its dependent wave. No worker can invent an alias/value, introduce an old pipeline as fallback, or claim a later integration gate from unit-only or scripted-specialist evidence.

## 12. Production acceptance matrix

Every row is a required production acceptance gate, not a claim that this architecture-freeze task executed it. Use production API/PostgreSQL/outbox/checkpointer/image for integration, reviewed agent evals for semantic quality, and Playwright for browser flows. Current audits show these target verticals and migration tests do not yet exist; release status remains NOT PROVEN until all pass.

| Acceptance | Exact pass condition |
|---|---|
| Automatic legal preparation | Starting with a pinned corpus automatically produces, validates, persists and activates one complete LegalRule + EngineeringRule portfolio; failed preparation leaves prior ACTIVE intact. |
| Cross-reference, definition, exception and qualifier handling | Reviewed legal eval fixture proves context is followed and represented in LegalRule/context relations and EngineeringRule without dropping limiting language or citing another version. |
| Zero human legal approval | Production routes, workers, database writes and UI contain no legal approval/signoff requirement; valid output activates from integrity gate alone. |
| Zero mandatory Initial Interview | A repository-only assessment starts Root investigation without interview state, context-ready gate or synthetic confirmation. |
| Zero technical questions answerable by repository/tools | In source-answerable evals, Root inspects repository/document/runtime tools first and opens zero HumanResolutionRequests for facts those sources can establish. |
| Applicable vs not applicable | Root gives every pinned EngineeringRule exactly one evidenced `APPLICABLE` or `NOT_APPLICABLE`; deterministic applicability code cannot decide it. |
| Compliant vs non-compliant | For each applicable rule, Root resolves every required criterion `MET`/`NOT_MET` and gives one `COMPLIANT`/`NON_COMPLIANT` result with accepted refs; validator rejects missing/stale/fabricated refs without rejudging semantics. |
| HITL same-thread resume | Material human fact opens one request and interrupts; authorized answer updates Case/Evidence and resumes identical server `threadId`; no duplicate question or decision is created. |
| Crash/restart resume | Kill/restart worker during investigation and during HITL; the same checkpoint/thread and accepted domain state resume idempotently. |
| Stop/continue | Stop persists `PAUSED` and execution pause; Continue resumes the same Root thread, restores waiting state if blockers remain, and never starts a second root. Cancel is terminal. |
| One assessment / one Root thread | Concurrent create, resume, retry, pause and HITL for an assessment resolve to exactly one unique AssessmentRuntime thread mapping and at most one active Root lease; per-rule or per-request root threads are rejected. |
| Cross-assessment memory canary isolation | Put unique raw canary in A; under same/different users, tenants, repository and legal portfolio, B cannot retrieve, emit, cite or authorize it. |
| Shared memory cannot become evidence | Retrieve a sanitized heuristic and attempt to cite/submit it; DecisionValidator rejects it as an evidence/provenance type. |
| Stale decision invalidation | Increment Case revision or change the pinned repository/source/rule version; dependent decisions become `INVALIDATED`, cannot finalize, and Root re-investigates. |
| Legal portfolio version pinning | New activation affects only newly created assessments; existing assessments and reports retain exact immutable portfolio/corpus version; no cached rule retarget occurs. |
| Multi-tenant isolation | API/tool authorization rejects foreign assessment, case, evidence, request, event, thread and artifact access across every endpoint and task descendant. |
| Concurrent assessments | Concurrent starts produce distinct unique thread namespaces, execution leases, event sequences and sandbox paths with no cross-run data or write collision. |
| Bounded negative evidence | Root can conclude `NOT_MET` from absence only when its agent judgment uses authenticated bounded coverage; missing/partial/index-gap coverage blocks that inference and is never deterministic non-compliance. |
| No final unresolved blocker | Any open HumanResolutionRequest, required input, pending/invalidated DRS item, stale evidence/pin, active fatal execution or invalid portfolio makes finalization fail with structured blockers. |
| No final UNKNOWN/PARTIAL/open-question language | No V2 decision schema contains final UNKNOWN/PARTIAL; no report is published with unresolved request/input, open-question field, or unresolved-question placeholder. Reviewed report evals reject those phrases/outcomes. |
| Token/activity accounting | Each model attempt has one stable invocation ID; persisted usage reconciles with billing ledger; AssessmentEvent shows activity/token usage without raw provider/customer content; duplicate callbacks do not double count. |
| Legacy path absence | Production image/API/import graph has no Scanner reasoning, mandatory Interview, per-rule dispatcher, Python semantic loop, targeted-reanalysis state machine, deterministic semantic judge, legal approval, regex normative judge, lazy legal recovery/cache/bundle, duplicate lifecycle projection, or V1 fallback/flag. Historical migrations remain only for schema history. |
| Legal portfolio supersession | Activate newer portfolio during an assessment; its existing version pin and decisions remain unchanged and traceable. A new assessment pins the new version. Changed assessment-owned inputs invalidate dependent decisions before finalization. |
| Migration and rollback safety | Clean DB and populated V1 upgrade pass; migration is restartable/idempotent, old artifacts/history reconcile, no down migration is used after V2 writes, and the pre-cutover restore point is verified before traffic switch. |
| Assessment deletion and retention | Deletion revokes/deletes eligible checkpoint, sandbox, requests and domain content; retained legal-hold/audit records follow policy; shared memory contains no attributable customer payload and deletion does not affect another assessment. |

**Freeze outcome:** one legal preparation authority, one assessment reasoning authority, one lifecycle authority, one event envelope, one source of truth per domain object, and no semantic decision delegated to deterministic application code. Implementation starts with W1 and is not production-complete until every §12 acceptance row passes.
