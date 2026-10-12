# W3 AssessmentCase / Repository Researcher interface preparation

## Preparation verdict and boundary

**Preparation PASS.** This report freezes a source-grounded draft interface and the
synthetic isolation packets in
`deepagents/tests/fixtures/assessment_researcher_isolation/scenarios.json`; the
focused test checks only fixture integrity and expected boundary violations.

All interfaces named `[DRAFT]` below are design material for the W1.1-after lane.
They are not shared contract values, API DTOs, Prisma fields, lifecycle states, or
production implementation. They remain provisional until the W1 integration gate,
W2 portfolio activation, serialized W3 schema/domain contract, and the later W3
vertical agree on the final shape.

Not proven here: live tenant/assessment isolation, native-agent semantics, provider
behavior, checkpoint/restart survival, API persistence, concurrent writes, or the
W3 production vertical. No provider, user database, namespace deletion, root
entrypoint, shared contract, API/web/i18n, Prisma/migration, lifecycle/control,
legal-preparation, existing test, or existing fixture file was changed.

The accepted W1 packet was read as the current structural precedent. In this
checkout its executable checker is
`tests/assessment-root-eval-fixtures.test.ts` and its packet is
`tests/fixtures/assessment-root/decision-cases.json`; there is no separate
`tests/fixtures/assessment-root-eval.ts` path. That checker remains untouched and
this packet does not repeat its RuleDecision/HumanResolution schema matrix.

## Source-grounded current boundaries

The following are current source facts, not claims that the future design is already
implemented.

| Current source | What it proves | W3 replacement boundary |
| --- | --- | --- |
| `deepagents/agent.py:74-106`, `create_root_agent` | The current native root is `lcsp-agent`; it loads `ROOT_TOOLS`, `RuntimeRepositoryBackend`, the legal `TRIAGE_SUBAGENT`, and a general-purpose subagent. Its comment explicitly says assessment `repository-analyst`/`interview` work is dispatched by `RootSubagentDispatcher`, never native `task()`. | `[DRAFT] create_assessment_root_agent` is a separate assessment entrypoint. It owns one persisted `AssessmentRuntime.threadId`; it is not added to this file in preparation. |
| `deepagents/subagents/repository_analyst/definition.py:1-75` | The current specialist is rule-bound (“one task = one EngineeringRule”), can call graph tools, `cite_repository_source`, `submit_rule_assessment`, and `retrieve_verified_episodes`, and is told to finish with a persisted rule submission. | `[DRAFT] repository-researcher` is generic, bounded, and returns findings to Root. It has no rule-decision submitter, customer/HITL tool, verified-episode tool, or domain write. |
| `deepagents/orchestration/dispatcher.py:38-183` | `RootSubagentDispatcher.dispatch` constructs a specialist with `create_deep_agent`, the current repository backend, role tools, context schema, and optional direct checkpointing. This is a direct specialist lifecycle, not the native Root `task()` boundary. | Root calls native `task(description, subagent_type, runtime)` once a bounded research objective is useful; the native child is ephemeral and its result returns through the parent tool call. |
| `deepagents/tools/common/capabilities/platform/repository_sandbox.py:51-185,193-252` | `AssessmentRepositoryBackend` and `RuntimeRepositoryBackend` expose `ls/read/grep/glob` plus `write/edit/delete/upload_files/execute`. The runtime wrapper forwards the mutators. | Hydration remains service-only. `[DRAFT] ReadOnlyRepositoryView` must expose only bounded `ls/read/grep/glob/download` and a read-only shell policy; Researcher never receives the mutating backend. |
| `repository_sandbox.py:278-352,411-459,517-546` | `hydrate_repository` materializes an immutable snapshot, writes `.lcsp/repository.json` containing assessment/snapshot/scan/commit metadata, and path virtualization rejects `..`, `~`, and paths outside `/workspace/repository`. `ensure_repository_for_event` can rehydrate from trusted event/report pins. | Preserve hydration and path guards below the read-only view. Every read/citation must re-check the marker against the server pin; a model-supplied snapshot or absolute path is never authority. |
| `deepagents/tools/common/capabilities/platform/codebase_memory.py:41-128` | `CodebaseMemoryIndexIdentity` records project, a hash of the hydration marker, and reuse. `ensure_codebase_memory_index` reuses only when the marker matches, otherwise indexes the repository and fails on indexing error. | Researcher receives an immutable `[DRAFT] indexIdentity` `{projectId,indexStamp,reused}` for lineage/diagnostics. Graph results are navigation only; direct pinned source remains authoritative. |
| `deepagents/tools/common/codebase_memory_graph/code.py:17-194` | Graph tools call Codebase Memory through the active repository backend. `get_code_snippet` may append a current per-rule HMAC ref, but only when a rule execution context exists; graph output otherwise has no evidence authority. | Keep graph tools as Researcher navigation. Candidate locators stay untrusted until the server verifies the pinned bytes and mints AssessmentEvidence. |
| `deepagents/tools/common/capabilities/assessment/rule_assessment/evidence_refs.py:1-108` | Existing refs are `source:{commit}:{path}#Lx-Ly` plus a process-secret HMAC. The MAC binds assessment, the first rule ID, rule execution ID, and canonical ref; parsing also checks commit. `cite_verified_source` requires a one-rule execution and live source verification. | Reuse the fail-closed mechanics, but do not reuse this one-rule context as the generic W3 contract. `[DRAFT]` generic evidence minting must additionally bind tenant, root thread/execution, researcher task, snapshot, full commit, lines, and source hash. |
| `deepagents/tools/common/capabilities/assessment/claims/evidence_claim/evidence_claim_validator.py:261-342,345-370,531-636,653-758` | Paths are normalized inside the repository; required verification reads the active backend/fallback root and checks UTF-8 line bounds. Direct source claims require the pinned repository marker, bounded production source, baseline blob hash, and criterion-aligned content. | Keep mechanical path/byte/hash checks. W3 `AssessmentEvidence` acceptance adds tenant/assessment ownership, current snapshot/commit, case revision, native task lineage, HMAC, idempotency, and no semantic decision inference. |
| `deepagents/tools/common/capabilities/evidence/graph/schema/source_roles.py:19-64,86-219` | Test/spec/fixture/mock/example/generated/script paths are classified away from `PRODUCTION`; filtering removes them from the governed graph. | Preserve this role policy. Raw canaries and test fixtures are isolation probes only and can never close a legal/compliance criterion. |
| `deepagents/tools/common/submit_rule_assessment/code.py:54-150` | Current `submit_rule_assessment` validates and persists a rule result through `WorkerApiClient`; current `cite_repository_source` is a model-callable persistence-adjacent citation tool. | Remove both from the future Researcher surface. Root alone submits a final RuleDecision; server acceptance mints evidence and persists accepted domain records. |
| `deepagents/tools/common/retrieve_verified_episodes/code.py:18-97` and `deepagents/instructions.md:20-31` | Episode retrieval is read-only but currently scoped to `planner`/`investigator`; it uses exact assessment/user/runtime filters. Root instructions explicitly say memory is never authoritative evidence or authority. | Do not expose episode retrieval to Researcher. Any future heuristic/memory read is a non-evidence hint; it must not appear as an AssessmentEvidence reference. |
| `deepagents/tools/common/capabilities/agent_runtime/agent_server_client.py:63-180,670-700` | Current event dispatch derives/reuses a LangGraph thread and injects immutable context; `agent_thread_id` is deterministic from assessment or event IDs. Existing scan/workflow identity is not the W3 canonical Root identity. | W3 resolves the persisted `AssessmentRuntime.threadId` from the server-owned assessment row. Researchers never derive a thread, create a thread, or resume a second Root. |
| `deepagents/orchestration/context.py:15-84` and `middleware/runtime_context.py:14-52` | `LCSPRunContext` carries immutable IDs/pins and middleware projects a small identifier block into prompts while warning that it is not evidence. | Extend the future server-owned runtime envelope only after the domain contract is frozen; do not let model input replace assessment/tenant/actor authorization. |
| `packages/contracts/src/assessment/agentic-runtime.ts:3-7,126-168,591-703,720-813,956-1037` | Accepted schemas are structural only. `RuleDecision` carries portfolio/snapshot/commit/case pins and legal-context refs; confirmed facts carry case revision; child `SUBAGENT` events require execution, parent execution, and task IDs. Comments assign tenant/actor/lineage/pin/HMAC/revision/order authority to API/server boundaries. | Treat these fields and actor/lineage rules as the W1.1 contract floor. No new Researcher contract value is accepted by this preparation. |
| `deepagents/uv.lock:635-649` plus the installed `deepagents.middleware.subagents` API | Deep Agents is pinned to 0.7.x (resolved 0.7.17 here). Its native declarative `SubAgent` supports `name`, `description`, `tools`, `middleware`, `mode`, `permissions`, and optional response format; default mode is isolated. Native `task` receives only model `description`/`subagent_type` and returns one child result to the parent. | Use this native task surface for the future Researcher. Parent server/runtime context, task identity, and acceptance metadata are injected outside model-authored arguments. |

## `[DRAFT]` authority split

The names and payloads below are deliberately draft interface notation, not an
instruction to add code now.

### Assessment Root (one server-owned thread)

Root receives an authenticated, server-built context and can call:

```text
get_assessment_case() -> current AssessmentCase + caseRevision + current repository/legal pins
get_accepted_evidence() -> accepted AssessmentEvidence only for this assessment
get_engineering_rule_portfolio() -> one immutable ACTIVE portfolio selected by the server
record_case_fact(fact, expectedCaseRevision, idempotencyKey)
record_use_case(useCase, expectedCaseRevision, idempotencyKey)
accept_researcher_findings(taskId, resultDigest, candidateFindings, expectedCaseRevision, idempotencyKey)
submit_rule_decision(ruleDecision, expectedCaseRevision, idempotencyKey)
ask_human(question packet, expectedCaseRevision, idempotencyKey)
get_completion_status()
request_finalization()
```

Rules for every Root write:

1. The server derives `tenantScope`, `assessmentId`, authenticated actor, Root
   `threadId`, current `executionId`, and event actor. The model cannot provide or
   override those identity fields.
2. The server checks tenant/PBAC/RBAC/HMAC/citation/source ownership, current
   repository snapshot+commit, current `caseRevision`, portfolio version, and
   idempotency before mutation. Expected revision is a CAS input, not an authority
   assertion.
3. Evidence acceptance is a mechanical/provenance operation. It does not infer
   applicability, criterion outcome, compliance, risk, or absence. Those semantic
   choices remain Root-owned and are checked only for structural coherence by the
   accepted W1.1 schemas and later W3/W4 `DecisionValidator`.
4. Accepted evidence/facts/decisions and the corresponding server event/outbox
   record commit atomically. A stale, unauthorized, forged, or lineage-mismatched
   request produces no domain mutation and no accepted event.

`submit_rule_decision` above is intentionally the only final-decision writer. A
Researcher result is not a RuleDecision and cannot be submitted directly as one.

### Bounded Repository Researcher (ephemeral native task)

The future native declaration is conceptually:

```python
REPOSITORY_RESEARCHER = {
    "name": "repository-researcher",
    "description": "Inspect the pinned repository for one bounded research objective and return source-grounded findings and limitations.",
    "mode": "isolated",
    "tools": [
        "ls", "read_file", "glob", "grep",       # read-only filesystem
        "execute_read_only",                       # allowlisted read-only shell
        "search_code_graph", "trace_call_path",
        "get_code_snippet", "search_code_text",
        "get_repository_architecture",
    ],
    "middleware": ["runtime-context", "model-governance", "usage", "budget", "read-only-guard"],
}
```

This is a design sketch, not executable source. The current Deep Agents filesystem
middleware cannot permission-scope `execute` on a backend that supports execution;
therefore merely hiding `write_file`/`delete` from the tool list is insufficient.
The eventual boundary needs either a backend whose `execute` is read-only or a
server-owned shell policy that rejects mutating commands before execution. The
current `AllowedToolsMiddleware` (`deepagents/middleware/tool_scope.py:17-52`)
is useful as an advertisement/call guard but is not a substitute for backend
enforcement.

Native task invocation is Root-only:

```text
task(
  description = bounded goal + output requirements,
  subagent_type = "repository-researcher",
)
```

The model may choose the description but not the identity envelope. The runtime
creates a task lineage record before invoking native `task`:

```text
[DRAFT ResearcherTaskEnvelope]
  taskId
  assessmentId                 # server-derived; not model input
  tenantScope                  # server-only authorization context
  rootThreadId                 # persisted AssessmentRuntime.threadId
  parentExecutionId
  executionId
  researcherTaskId             # same as taskId; unique per attempt
  repositorySnapshotId
  repositoryCommit
  caseRevisionObserved
  codebaseMemoryProjectId
  codebaseMemoryIndexStamp
  purpose / bounded scope
  idempotencyKey
```

The task result is wrapped outside the model:

```text
[DRAFT ResearcherResultEnvelope]
  taskId
  parentExecutionId
  rootThreadId
  repositorySnapshotId
  repositoryCommit
  caseRevisionObserved
  indexIdentity
  findings[]
  limitations[]
  resultDigest
  status = returned | failed | stale
```

`findings[]` may contain observations, bounded limitations, and **candidate source
locators**. It must not contain a server-issued evidence ID, HMAC, accepted fact,
RuleDecision, compliance outcome, HITL request, lifecycle transition, or shared
memory write. The parent Root can ask the server to accept the result; the server
re-reads and verifies every candidate before minting AssessmentEvidence.

### Read/write surface by owner

| Surface | Root | Researcher | Server/API boundary |
| --- | --- | --- | --- |
| AssessmentCase read | Yes, current assessment only | No by default; no customer/business context | Authenticates tenant and returns current revision |
| AssessmentCase fact/use-case write | Yes via server-owned tools | No | Validates actor, tenant, CAS, provenance, idempotency, event/outbox |
| Repository snapshot read | Yes through the same pinned read view | Yes, bounded and read-only | Hydrates and pins snapshot; verifies marker/hash |
| Codebase Memory | Yes for navigation | Yes for navigation | Ensures project/index identity; graph is not evidence authority |
| Evidence read | Accepted current-assessment evidence only | No accepted ledger; only its own candidate locators | Applies ownership/revision/source/HMAC checks |
| Evidence write | Root asks `accept_researcher_findings` | No | Mints/persists accepted evidence and emits API-owned event |
| Human request | Yes after investigation | No | Validates safe packet, current revision and same Root thread |
| RuleDecision/finalization | Yes | No | DecisionValidator/completion/persistence authority |
| Shared memory | No direct authority; may receive non-authoritative hints if later approved | No | Store policy and exact tenant/assessment scope |
| Filesystem write/edit/delete/upload | No assessment need; keep hydration/service-only | No | Backend guard, not prompt policy |
| Shell | Read-only diagnostics only if needed | Read-only allowlist only | Rejects mutation, network, secret access, and namespace escape |

## Exact pin, revision, provenance, and lineage requirements

### 1. Namespace and authority

The server must bind every Root/Researcher operation to the authenticated tenant,
assessment, and persisted Root runtime. UUID shape is not ownership. A candidate
result with another tenant/assessment, another Root thread, or another sandbox is
rejected as `NAMESPACE_MISMATCH` (a fixture boundary label, not a new contract
constant). No fallback can silently reinterpret a foreign ID as the current one.

### 2. Repository source pin

Every accepted repository source reference contains, or is server-associated with:

```text
repositorySnapshotId      # exact immutable snapshot row
repositoryCommit          # full 40/64-character commit
path                     # normalized repository-relative POSIX path
startLine, endLine        # inclusive, bounded range
symbol                    # optional graph/source symbol locator
sourceHash                # hash of exact UTF-8 bytes read from the pinned view
  sourceRole                # server-verified source role; governed production source is policy-eligible
scanJobId                 # if required by the hydration marker
codebaseMemoryProjectId
codebaseMemoryIndexStamp  # navigation provenance only
```

The server, not the model, supplies the snapshot/commit/scan/index identity and
mints the HMAC/evidence ID. It verifies `.lcsp/repository.json`, normalizes the
path, checks line bounds, reads exact bytes from the assessment sandbox, computes
the source hash, and rejects any mismatch. A graph node, memory item, raw canary,
or model-written `source:{commit}:...` string is only a locator/candidate until
that process completes.

### 3. Case revision

The task envelope records `caseRevisionObserved` from the server at launch. Root
acceptance supplies an expected revision; the API re-reads current `AssessmentCase`
under its authoritative transaction/lock and rejects a mismatch as stale. A source
pin can be byte-correct and still stale if its observed case revision, repository
snapshot, legal portfolio, or Root execution no longer matches current state.

No stale result may update the case, evidence ledger, decision history, lifecycle,
or outbox. Retrying requires a fresh server envelope and a new idempotency identity
or an exact replay of the same accepted result.

### 4. Evidence/provenance lineage

For accepted repository evidence, the server records the evidence's assessment and
tenant owner, source type, source pin/hash, observed case revision, producing
Researcher task, parent Root execution, Root thread, tool/citation policy version,
and creation metadata. It must preserve the distinction between:

- `SUBAGENT` activity lineage (`executionId`, `parentExecutionId`, `taskId`) in the
  accepted event contract;
- API-owned `EVIDENCE_ACCEPTED` event/persistence authority; and
- Root-authored semantic references in a later `RuleDecision`.

The Researcher cannot claim that its own output is accepted evidence. Root may use
the accepted evidence ID only after the API returns it. Raw source bodies, secrets,
provider prompts, and customer data are not copied into the task result or activity
event; bounded source locators and hashes are sufficient for re-verification.

### 5. Memory and heuristics

`Memory is never authoritative evidence` remains a hard rule. A retrieved episode,
summary, graph ranking, prior Root narrative, or Researcher memory can be a
non-authoritative lead/limitation only. It cannot satisfy a source pin, produce an
AssessmentEvidence ID, or be placed in a RuleDecision `ASSESSMENT_EVIDENCE` ref.
The `memory-as-evidence` fixture intentionally contains a trusted-looking memory
record with no source refs and expects rejection.

## Stale/error behavior (draft boundary matrix)

| Condition | Required result | Mutation/event behavior |
| --- | --- | --- |
| Foreign tenant/assessment/thread/task | `NAMESPACE_MISMATCH` | Reject before source lookup; no case/evidence/decision/event/outbox write |
| Same path, wrong snapshot/commit | `STALE_REPOSITORY_PIN` | Reject; preserve previous accepted state |
| Same path/hash, changed bytes | `SOURCE_HASH_MISMATCH` | Reject; do not trust graph/canary or re-read another namespace |
| Line range invalid, path escapes, reserved `.git/.lcsp`, non-UTF-8 | typed source-validation failure | Reject; no fallback to host path |
| Model supplies canonical ref without server MAC | `FORGED_SOURCE_REF` | Reject; model cannot mint or repair its own evidence ref |
| Candidate source role is test/spec/fixture/example/generated/script | source-role rejection | Keep as investigation limitation only; never legal/compliance evidence |
| Case revision or legal/repository pin changed | `STALE_CASE_REVISION` / `STALE_REPOSITORY_PIN` | Reject before CAS/write; retry from current Root checkpoint |
| Result lacks task/parent/root lineage or digest changes under same key | lineage/idempotency conflict | Reject; exact prior accepted replay may return prior result |
| Memory/episode/graph ranking presented as evidence | `MEMORY_NOT_EVIDENCE` | Reject evidence acceptance; retain only as non-authoritative hint/limitation |
| Researcher calls case/evidence/decision/HITL/shared-memory write | `RESEARCHER_WRITE_FORBIDDEN` / `ROOT_AUTHORITY_REQUIRED` | Tool unavailable or server-denied; no partial mutation |
| Read-only shell attempts write/delete/network/secret access | read-only guard failure | Reject command before execution; no repository mutation |
| Provider/task failure before a result | bounded task failure | Root checkpoint remains authoritative; no accepted evidence; no semantic failure fabricated |

Typed labels in this table are preparation vocabulary only. They must be mapped to
the frozen problem/error contract by the API owner after W1/W3 contract freeze;
this task intentionally adds no such values.

## Replacement boundaries after W3 authorization

| Current candidate | Future action | Boundary |
| --- | --- | --- |
| `repository_sandbox.py` hydration, archive sanitization, marker, path virtualization | **KEEP**, then expose a read-only assessment view | Hydration/service owns writes; Root/Researcher read the exact pinned snapshot only |
| `codebase_memory.py` and `tools/common/codebase_memory_graph/code.py` | **KEEP**, adapt identity into W3 runtime envelope | Navigation/coverage metadata only; no evidence or semantic authority |
| `evidence_refs.py`, `EvidenceClaimValidator`, `source_roles.py` | **KEEP mechanics / REWRITE caller contract** | Add generic task/thread/snapshot/hash/revision lineage at the server boundary; do not weaken HMAC or source-role checks |
| `subagents/repository_analyst/definition.py` | **REWRITE** into generic Repository Researcher | Remove one-rule language, `submit_rule_assessment`, and episode retrieval; use native isolated `task()` |
| `RootSubagentDispatcher.dispatch` and per-rule `engineering_assessment_boundary.py` | **REWRITE/DELETE after vertical proof** | Root owns sequencing; native task is the only Researcher delegation; no direct specialist lifecycle or semantic Python loop |
| `repository_analysis/analyzer.py` and callback-driven Scanner path | **DELETE after W3 production proof** | Deterministic snapshot/sandbox/index/source plumbing stays; model-driven Scanner/callback decision gate does not |
| `deepagents/agent.py`, `instructions.md`, subagent registry | **DO NOT TOUCH in this preparation** | W3 implementation owner changes the sole assessment Root entrypoint only after serialized gate |
| W1.1 packet/test and existing fixtures | **KEEP** | Reuse accepted structural precedent; do not duplicate or change its checker |

No compatibility alias, fallback writer, dual writer, new lifecycle value, or
semantic deterministic decision is part of this preparation.

## Synthetic adversarial assets

`scenarios.json` contains two disjoint tenant/assessment namespaces and six reusable
future W3 vertical packets:

| Scenario | Boundary exercised | Expected violation |
| --- | --- | --- |
| `disjoint-namespace` | Alpha case receives Beta assessment/tenant and Beta source pin | `NAMESPACE_MISMATCH` |
| `canary-overlap` | Both repositories intentionally use `src/canary.txt`; hashes/content markers differ | `SOURCE_HASH_MISMATCH` |
| `forged-ref` | Model supplies a canonical-looking source ref with no server MAC | `FORGED_SOURCE_REF` |
| `stale-pin` | Result observes old snapshot/commit and case revision 12 while current state is revision 13 | `STALE_REPOSITORY_PIN`, `STALE_CASE_REVISION` |
| `memory-as-evidence` | Trusted-looking prior episode has no source refs but is submitted as evidence | `MEMORY_NOT_EVIDENCE` |
| `researcher-unauthorized-write` | Researcher attempts case/use-case/decision/HITL/repository/shared-write operations | `RESEARCHER_WRITE_FORBIDDEN`, `ROOT_AUTHORITY_REQUIRED` |

The canaries are synthetic, assessment-private, and deliberately not source
evidence. The fixture encodes no expected semantic answer and no agent PASS.

## Verification

Focused command:

```text
rtk uv run --project deepagents pytest -q deepagents/tests/test_assessment_researcher_isolation_fixtures.py
```

Expected/recorded scope for this preparation: one stdlib-only fixture-integrity
test; no provider calls, user database, namespace deletion, or production-agent
execution. The final worker handoff records the actual exit/result. Live isolation,
native task semantics, API persistence, and production W3 acceptance remain
**NOT PROVEN**.
