# W1.1 Independent Review

REQUEST_CHANGES

## Architecture Freeze conformance

Reviewed `reports/architecture-freeze-migration-manifest.md` §§1–4, 11/W1.1 and 12, plus the corresponding contract/domain details in `docs/architecture/agentic-production-implementation-plan.md` §§5.6–5.7 and 11.1. The manifest is the transition authority. The new contract matches its exact canonical state values and transitions; the earlier comparison against plan §6.1 is withdrawn and is not a finding.

### Exact value sets

- **ALS:** `CREATED, PREPARING, ACTIVE, WAITING_FOR_HUMAN, WAITING_FOR_REQUIRED_INPUT, PAUSED, FINALIZING, COMPLETE, BLOCKED, FAILED, CANCELLED`.
- **AES:** `QUEUED, RUNNING, INTERRUPTED, PAUSED, SUCCEEDED, FAILED, CANCELLED`.
- **DRS:** `PENDING, INVESTIGATING, WAITING_FOR_INPUT, RESOLVED, INVALIDATED`.
- **ALCS:** `BUILDING, ACTIVE, SUPERSEDED, INVALID`.
- **BlockerReason:** `HUMAN_FACT_UNRESOLVABLE, REQUIRED_DOCUMENT_UNAVAILABLE, REQUIRED_RUNTIME_INPUT_UNAVAILABLE, LEGAL_PORTFOLIO_UNAVAILABLE, REPOSITORY_SNAPSHOT_UNAVAILABLE`.
- **RuleDecision values:** applicability `APPLICABLE | NOT_APPLICABLE`; criteria `MET | NOT_MET`; compliance `COMPLIANT | NON_COMPLIANT`. Evidence and confirmed-fact references are canonical; finding 2 covers the missing explicit legal-context reference.
- **HumanResolutionRequest status:** `OPEN, RESOLVED, SUPERSEDED, CANCELLED`.

### Exact transition table

All destinations below match manifest §3.1–3.4, including guards requiring server authority where specified. A reviewer-run check evaluated all 227 state pairs across ALS, AES, DRS, ALCS, and HumanResolutionRequest; it reported 0 mismatches.

- **ALS:** CREATED → PREPARING/FAILED/CANCELLED; PREPARING → ACTIVE/WAITING_FOR_REQUIRED_INPUT/BLOCKED/FAILED/CANCELLED; ACTIVE → WAITING_FOR_HUMAN/WAITING_FOR_REQUIRED_INPUT/PAUSED/FINALIZING/BLOCKED/FAILED/CANCELLED; WAITING_FOR_HUMAN → ACTIVE/WAITING_FOR_REQUIRED_INPUT/PAUSED/BLOCKED/CANCELLED; WAITING_FOR_REQUIRED_INPUT → ACTIVE/WAITING_FOR_HUMAN/PAUSED/BLOCKED/CANCELLED; PAUSED → ACTIVE/WAITING_FOR_HUMAN/WAITING_FOR_REQUIRED_INPUT/CANCELLED; BLOCKED → ACTIVE/CANCELLED; FAILED → ACTIVE/CANCELLED; FINALIZING → COMPLETE/FAILED/CANCELLED; COMPLETE and CANCELLED are terminal.
- **AES:** QUEUED → RUNNING/FAILED/CANCELLED; RUNNING → INTERRUPTED/PAUSED/SUCCEEDED/FAILED/CANCELLED; INTERRUPTED → RUNNING/PAUSED/FAILED/CANCELLED; PAUSED → RUNNING/FAILED/CANCELLED; SUCCEEDED, FAILED, and CANCELLED are terminal.
- **DRS:** PENDING → INVESTIGATING; INVESTIGATING → WAITING_FOR_INPUT/RESOLVED/INVALIDATED; WAITING_FOR_INPUT → INVESTIGATING/RESOLVED/INVALIDATED; RESOLVED → INVALIDATED; INVALIDATED → INVESTIGATING.
- **ALCS:** BUILDING → ACTIVE/INVALID; ACTIVE → SUPERSEDED/INVALID; SUPERSEDED → ACTIVE/INVALID, with validated and audited rollback guards on reactivation; INVALID is terminal.
- **HumanResolutionRequest:** OPEN → RESOLVED/SUPERSEDED/CANCELLED; all other statuses are terminal.

### Event envelope and boundaries

The typed envelope matches manifest §4: UUID event/assessment/thread identity, integer sequence, ISO timestamp, closed event and actor vocabularies, optional execution/parent/task/tool lineage, typed event payloads, paired token cost/currency, and an opaque technical details reference. Subagent events require execution, parent execution, and task IDs and reject self-parenting; lifecycle/execution/evidence/decision/request/artifact events constrain actor ownership. Strict payload schemas reject raw customer text. The contract is validation only; comments preserve API ownership of authenticated lineage, ordering, pins, provenance, and transactional writes.

The public assessment export is wired through `packages/contracts/src/assessment/index.ts` and the existing root assessment export. The new module has no legacy state aliases; existing resource exports remain untouched for staged migration. No TypeScript enum or hand-written literal union was found. Codebase-memory search found no Python mirror of the new canonical ALS values. No consumer deletion or downstream lifecycle implementation was included in the owned source diff.

## Findings

### P1 — Human fact-resolution packet is structurally incomplete

**Location:** `packages/contracts/src/assessment/agentic-runtime.ts:692-705, 732-751`.

**Root cause:** The open request schema requires a question and a single text `decisionImpact`, but cannot carry the frozen `unresolvedFact`, `resolutionAttempts`, `controlType`, or `choices` from `ask_human` (§5.7 and §11.1). The persisted request shape inherits those omissions and has no `answers[]` or `resolvedFactRef`. Its RESOLVED variant accepts any `decisionReferencesSchema`, so an evidence-only reference can mark a request resolved without a confirmed fact.

**Reproduction:** The checker observed that a minimal request without unresolved-fact/control/choice data is accepted, the corresponding full frozen packet is rejected, and a RESOLVED request with only `{ type: "ASSESSMENT_EVIDENCE", evidenceId }` is accepted.

**Minimal repair scope:** Represent the frozen request, control, attempt, choice, and answer fields in the open/persisted request schemas; require a confirmed fact reference at the current case revision for RESOLVED. Keep the answer as a fact/evidence submission and never as a verdict.

### P1 — RuleDecision cannot carry legal-context references

**Location:** `packages/contracts/src/assessment/agentic-runtime.ts:590-644`.

**Root cause:** The reference union contains only assessment evidence and confirmed facts, and both strict RuleDecision variants omit `legalContextRefs[]`. A portfolio pin alone does not identify which legal context the Root used; the frozen RuleDecision shape in §5.6 requires those explicit references.

**Reproduction:** An otherwise valid decision extended with `legalContextRefs: ["legal-context-1"]` is rejected as an unknown key; a legal-context reference is not part of the reference vocabulary.

**Minimal repair scope:** Add a typed legal-context reference to the Root decision packet and validate it against the exact pinned EngineeringRule/portfolio at the API trust boundary.

## Tests and checks

- `rtk pnpm --filter @lcsp/contracts build` — PASS, exit 0.
- `rtk pnpm run check:contracts` — PASS, exit 0.
- Reviewer-run `rtk pnpm exec tsx -e '<manifest transition-matrix checker>'` — PASS, exit 0; 227 state pairs, 0 transition/guard mismatches.
- Reviewer-run `rtk pnpm exec tsx -e '<schema matrix and boundary checker>'` — PASS, exit 0; 202 transition-payload pairs and 216 assertions, 0 mismatches. Its explicit probes reproduced both request-shape gaps and the missing legal-context field above.
- `rtk git diff --check` — PASS, exit 0.
- `rtk pnpm run check:contracts` plus source scans — PASS: no TypeScript enum, handwritten literal union, or legacy alias in the new module.
- Codebase-memory Python mirror search — PASS: no matching canonical lifecycle symbols in `deepagents/**/*.py`.

The implementation source remains unchanged by this review. The only repository file written by this review is this report.

## Re-review — independent fresh-Codex acceptance barrier (2026-10-05)

**Verdict: REQUEST_CHANGES. W1.1 does not pass; W1.2 remains blocked.**

The earlier review above is preserved as historical evidence. Its two original omissions have been repaired in the inspected source, but the repaired human-request refinement introduces the blocking finding below. This verdict comes from the actual checkout and newly executed checks, independently of prior worker claims. No `/tmp` handoff or prior implementation log was read or used as proof.

### Reviewed snapshot and scope

- Worktree: `/home/khovan/orca/workspaces/LCSP/agentic-prod-integration`.
- HEAD: `c6ce6d954f02a755beffe3f62df2f5cc3e8bfa24`.
- Complete authority read: `reports/architecture-freeze-migration-manifest.md`, sections **1 through 12**, all 464 lines. Its SHA-256 is `8210952261e034edcb0796b57625c2d11205e2044f647b4b6517272be7e24e01`.
- Also read the plan's exact RuleDecision/HumanResolutionRequest/tool shapes in sections 5.6–5.7 and 11.1–11.4. Freeze section 3 remains the transition authority.
- Complete current `agentic-runtime.ts` read: 1,067 added lines, SHA-256 `6e90eb035d8cd57e62f8063df314bae5eae35c43696bca7b760463cbdec8c7f6`.
- Tracked implementation diff: `assessment/index.ts` adds only `export * from "./agentic-runtime.ts";`. Current barrel SHA-256: `4d20f5b8129834713ffa07db84dc5d7c2eddb4776fb66e3e7a54e79a5e6faa87`.
- Complete current repair tests read and rerun: `tests/agentic-runtime-contracts.test.ts`, 199 added lines, SHA-256 `54be04969f0d0e246527e38ed648848ac3eb86a51d102b4ca2c073d7fd246b33`.
- Because new files are untracked, ordinary `git diff` alone omits their bodies. Both complete bodies were inspected; `git diff --no-index --numstat` against `/dev/null` confirmed their addition sizes.
- Other existing untracked documentation/audits/ledger are user/coordinator WIP and remain untouched. The reviewer writes only this report.

### Freeze conformance and ownership

| Requirement | Fresh evidence | Result |
|---|---|---|
| Sections 1–2: agents own semantics; deterministic code guards structure and integrity | Module comments at lines 3–7, 164–171, 635–638, 721–723 and 956–959 preserve server authority. Schemas receive authored decisions; they do not infer applicability from facts, select questions, judge evidence meaning, or write state. Criterion/compliance coherence is a packet consistency check. | PASS for W1.1 |
| Section 3: exact ALS/AES/DRS/ALCS/BlockerReason and resource-local request statuses | Independently compared all constant keys and values to the exact sets listed in the historical section above. No added lifecycle alias, UNKNOWN/PARTIAL decision outcome, or FINAL artifact state. | PASS |
| Section 3: exhaustive transition topology and guards | All **227** state pairs across ALS/AES/DRS/ALCS/request status match the Freeze. Independently expected guard lists match; **129** missing-guard probes reject. Terminal states have no destinations. BLOCKED reopening, same-thread retry/resume, completion gate, artifact persistence, and audited portfolio rollback require their respective obligations. | PASS |
| Section 3.5: BLOCKED reason/reference discipline | All five reasons accept only their typed references; absent/wrong references reject. Non-BLOCKED lifecycle rejects a blocker. Portfolio/snapshot absence may reference a required-input record when no version exists, with kind/ownership verification explicitly deferred to the API. | PASS |
| Section 3.5 / section 10.F: unknown answers remain unresolved while independent cancellation/supersession remains possible | An unknown answer cannot resolve a request, but the current refinement also rejects allowed later cancellation and supersession. The event/status transition table accepts those transitions while the persisted request schema rejects the resulting records. | **FAIL: P1 below** |
| Section 4: typed AssessmentEvent and lineage/privacy | All seven event types have strict payloads; ownership is API for accepted domain/lifecycle events and RUNTIME for execution transitions. SUBAGENT requires execution/parent/task lineage, rejects self-parenting, and preserves that requirement in TypeScript. UTC timestamp, UUID identity, safe integer sequence, paired cost/currency and opaque UUID details reference checks pass. Malformed payloads, unsupported actors/types, raw-body fields and invalid lineage reject. | PASS for contract structure |
| Sections 5–6: isolated memory, domain authorities, pins and revisions | Decision refs allow only accepted assessment evidence or confirmed facts; shared-memory provenance rejects. Required portfolio/snapshot/commit/case pins and typed legal-context refs exist. Facts in decisions and resolved requests must match packet case revision. Authenticated reference existence, current revision, criterion completeness against the actual portfolio, namespace ownership, privacy of question text and server metadata remain API/integration obligations, explicitly not established by UUID syntax. | PASS for W1.1 boundary; later integration NOT PROVEN |
| Sections 7–9: staged migration/deletion | Additive contract/barrel change; no production consumer is deleted, no compatibility alias or Python lifecycle mirror is added, and existing resource/legacy exports remain for the frozen staged migration. The new canonical sets do not import/incorporate legacy states. | PASS |
| Section 10: final decisions and fact requests | Valid APPLICABLE/COMPLIANT, APPLICABLE/NON_COMPLIANT and NOT_APPLICABLE/null packets pass; incoherent, empty, duplicated, stale, malformed or UNKNOWN/PARTIAL packets reject. Repaired human requests carry unresolvedFact, decisionImpact[], resolutionAttempts[], controlType, choices[], answers[] and resolvedFactRef; only a confirmed fact at the request revision can resolve them. Cancellation after unknown remains broken. | PARTIAL |
| Section 11: W1.1 exclusive implementation boundary | Source change is the new contract and its assessment barrel; review changes only this report. Four repair tests exercise the prior omissions; independent checks exercise the full matrix. W1.1 acceptance fails, so this review does not authorize W1.2 or downstream consumers. | **REQUEST_CHANGES** |
| Section 12: production acceptance matrix | No production API/PostgreSQL/outbox/checkpointer/image, semantic agent eval, concurrent CAS/atomic-event test or browser proof is claimed. Those are later gates and cannot be inferred from contract tests. | NOT PROVEN, outside this review's W1.1 scope |

### Discovery and exports

Codebase-memory MCP `search_graph`, `get_code_snippet`, `trace_path`, `search_code` and `query_graph` were used for symbols, callers and import patterns; the project was already indexed. MCP found the new schema symbols but returned no inbound calls and did not include the newly added test in the caller/file results. A bounded live `rg` fallback over `packages apps deepagents tests`, excluding dist/node_modules, therefore verified the actual consumer set: contract definitions, the assessment barrel, and the repair test, with no current application/Python adoption. This is a foundation contract, not an already integrated lifecycle.

The existing root barrel exports the assessment barrel. The independent runtime checker imported **both** `@lcsp/contracts/assessment` and `@lcsp/contracts` and verified canonical constant identity through both. MCP Python search for `ASSESSMENT_LIFECYCLE_STATES|WAITING_FOR_REQUIRED_INPUT|HUMAN_FACT_UNRESOLVABLE` returned zero matches under `deepagents/**/*.py`; the live bounded scan agrees. TypeScript AST inspection found no enum declaration or handwritten string-literal union in the new module. No graph rebuild or source mutation was performed.

### Prior findings disposition

1. **Original P1 incomplete human fact packet: repaired.** Current lines 705–813 represent the missing packet and answer fields, require a typed confirmed fact, reject evidence-only resolution and reject mismatched fact revision. The fresh tests independently verify this repair. The new P1 is a separate error in the unknown-answer guard.
2. **Original P1 missing legal-context references: repaired.** Current lines 617–631 add a strict legal-context reference and require at least one reference in both decision variants. The fresh tests accept the full packet and reject empty/malformed legal-context arrays. Actual lookup against the pinned portfolio remains the W3 DecisionValidator's authority.

### Blocking finding — P1: unknown-answer history prevents cancellation and supersession

**Location:** `packages/contracts/src/assessment/agentic-runtime.ts:802–810`, especially the status condition at line 804.

**Root cause:** The persisted-request refinement treats “the latest answer is unknown” as a permanent requirement that the resource status be OPEN. That is broader than “the unknown answer must not resolve the fact.” Freeze section 3.5 explicitly permits OPEN → SUPERSEDED when a question is no longer material and OPEN → CANCELLED when the assessment is cancelled; section 10.F preserves an unknown answer without resolving it. Both operations must retain answer history, yet the schema rejects their resulting records whenever that history ends in `doesNotKnow: true`. The transition table allows both operations, producing a contradictory canonical contract.

**Reproduction:** Create a valid OPEN request with complete question fields and `answers: [{ doesNotKnow: true, answeredAt: timestamp }]`. It parses while OPEN. Change only its status to SUPERSEDED or CANCELLED; both `safeParse` calls return false with `An unknown answer leaves the request open`. The reviewer-run acceptance checker below asserts that those later resource transitions are valid and exits **1**, reporting exactly these two failures.

**Fix / minimal repair scope:** Limit the unknown-answer rejection to RESOLVED (or equivalently require a sufficient known fact answer only for RESOLVED). Preserve the strict confirmed-fact/revision guards. Add focused regressions showing that unknown → RESOLVED rejects while subsequent authorized SUPERSEDED and CANCELLED records retain the unknown answer and parse. This needs only the request refinement and its regressions; do not change lifecycle values, transition tables, agent authority or cancellation semantics. No fix was applied by this reviewer.

### Commands actually executed

All commands ran from the worktree root. The fenced independent checks below are the complete scripts actually run via stdin; no transient source/check files were created.

| Command | Exit | Exact outcome |
|---|---:|---|
| `rtk proxy pnpm exec tsc -p packages/contracts/tsconfig.json --noEmit --incremental false --composite false` | 0 | Contract typecheck passed, no output and no build files emitted. |
| `rtk proxy pnpm exec tsx --test tests/agentic-runtime-contracts.test.ts` | 0 | 4 tests, 4 passed, 0 failed/skipped/cancelled. |
| `rtk proxy pnpm run check:contracts` | 0 | `Contract literal policy passed.` |
| `rtk proxy pnpm exec tsx <<'W11_CHECK'` with full acceptance script below | **1** | 770 assertions: 768 passed, **2 failed**; 227 transition pairs, 202 transition-payload pairs, 129 missing-guard probes. Only failures: unknown answer then supersede/cancel. |
| `rtk proxy pnpm exec tsx <<'W11_TYPE_CHECK'` with strict virtual fixture below | 0 | Strict TypeScript narrowing/negative assertions and AST enum/literal-union checks passed; no files emitted. |
| `rtk proxy git diff --check` | 0 | No whitespace errors in tracked diff. |
| `rtk proxy git diff -- packages/contracts/src/assessment/index.ts` | 0 | One added canonical export. |
| `rtk proxy git diff --no-index --numstat -- /dev/null packages/contracts/src/assessment/agentic-runtime.ts` | 1 | Expected diff-present result: 1,067 added lines, 0 deletions. This exit is not a test failure. |
| `rtk proxy git diff --no-index --numstat -- /dev/null tests/agentic-runtime-contracts.test.ts` | 1 | Expected diff-present result: 199 added lines, 0 deletions. |
| `rtk proxy graphify query 'W1.1 agentic runtime contracts lifecycle transitions event schema exports' --budget 1800` | 0 | Navigation only; live source/diff and Freeze determined the verdict. |

The prior report's opaque inline check commands and build claims were not treated as fresh proof. Required checks were rerun directly. A contracts build that emits repository artifacts was intentionally replaced by the explicit no-emit typecheck to honor read-only source ownership.

### Runnable independent acceptance check

Run this exact block from the worktree root. It currently exits 1 for the two blocking cases, and should exit 0 once the contract is repaired.

```bash
rtk proxy pnpm exec tsx <<'W11_CHECK'
import assert from "node:assert/strict";
import * as c from "./packages/contracts/src/assessment/agentic-runtime.ts";
import * as publicAssessment from "@lcsp/contracts/assessment";
import * as publicRoot from "@lcsp/contracts";
import fs from "node:fs";
const failures=[];
let assertions=0, pairs=0, payloadPairs=0, guardProbes=0;
function check(label,actual,expected=true){ assertions++; if(actual!==expected) failures.push({label,actual,expected}); }
const valueSets={
 ASSESSMENT_LIFECYCLE_STATES:"CREATED PREPARING ACTIVE WAITING_FOR_HUMAN WAITING_FOR_REQUIRED_INPUT PAUSED FINALIZING COMPLETE BLOCKED FAILED CANCELLED",
 AGENT_EXECUTION_STATES:"QUEUED RUNNING INTERRUPTED PAUSED SUCCEEDED FAILED CANCELLED",
 DECISION_RESOLUTION_STATES:"PENDING INVESTIGATING WAITING_FOR_INPUT RESOLVED INVALIDATED",
 ARTIFACT_LIFECYCLE_STATES:"BUILDING ACTIVE SUPERSEDED INVALID",
 BLOCKER_REASONS:"HUMAN_FACT_UNRESOLVABLE REQUIRED_DOCUMENT_UNAVAILABLE REQUIRED_RUNTIME_INPUT_UNAVAILABLE LEGAL_PORTFOLIO_UNAVAILABLE REPOSITORY_SNAPSHOT_UNAVAILABLE",
 RULE_DECISION_APPLICABILITIES:"APPLICABLE NOT_APPLICABLE",
 RULE_DECISION_CRITERION_OUTCOMES:"MET NOT_MET",
 RULE_DECISION_COMPLIANCE_OUTCOMES:"COMPLIANT NON_COMPLIANT",
 HUMAN_RESOLUTION_REQUEST_STATUSES:"OPEN RESOLVED SUPERSEDED CANCELLED",
 AGENTIC_ASSESSMENT_EVENT_TYPES:"ACTIVITY_RECORDED ASSESSMENT_LIFECYCLE_CHANGED EXECUTION_STATE_CHANGED EVIDENCE_ACCEPTED DECISION_ACCEPTED HUMAN_RESOLUTION_CHANGED ARTIFACT_CHANGED",
 ASSESSMENT_EVENT_ACTOR_TYPES:"RUNTIME ASSESSMENT_ROOT SUBAGENT TOOL API"
};
for(const [name,values] of Object.entries(valueSets)){
 const expected=values.split(" ").sort();
 check(name+" exact values",JSON.stringify(Object.values(c[name]).sort()),JSON.stringify(expected));
 check(name+" keys match values",Object.entries(c[name]).every(([k,v])=>k===v));
 check(name+" assessment export",publicAssessment[name]===c[name]);
 check(name+" root export",publicRoot[name]===c[name]);
}
const manifest={
 ASSESSMENT_LIFECYCLE_TRANSITIONS:{
 CREATED:"PREPARING FAILED CANCELLED",PREPARING:"ACTIVE WAITING_FOR_REQUIRED_INPUT BLOCKED FAILED CANCELLED",
 ACTIVE:"WAITING_FOR_HUMAN WAITING_FOR_REQUIRED_INPUT PAUSED FINALIZING BLOCKED FAILED CANCELLED",
 WAITING_FOR_HUMAN:"ACTIVE WAITING_FOR_REQUIRED_INPUT PAUSED BLOCKED CANCELLED",
 WAITING_FOR_REQUIRED_INPUT:"ACTIVE WAITING_FOR_HUMAN PAUSED BLOCKED CANCELLED",
 PAUSED:"ACTIVE WAITING_FOR_HUMAN WAITING_FOR_REQUIRED_INPUT CANCELLED",
 FINALIZING:"COMPLETE FAILED CANCELLED", COMPLETE:"",BLOCKED:"ACTIVE CANCELLED",FAILED:"ACTIVE CANCELLED",CANCELLED:""
 },
 AGENT_EXECUTION_TRANSITIONS:{QUEUED:"RUNNING FAILED CANCELLED",RUNNING:"INTERRUPTED PAUSED SUCCEEDED FAILED CANCELLED",INTERRUPTED:"RUNNING PAUSED FAILED CANCELLED",PAUSED:"RUNNING FAILED CANCELLED",SUCCEEDED:"",FAILED:"",CANCELLED:""},
 DECISION_RESOLUTION_TRANSITIONS:{PENDING:"INVESTIGATING",INVESTIGATING:"WAITING_FOR_INPUT RESOLVED INVALIDATED",WAITING_FOR_INPUT:"INVESTIGATING RESOLVED INVALIDATED",RESOLVED:"INVALIDATED",INVALIDATED:"INVESTIGATING"},
 ARTIFACT_LIFECYCLE_TRANSITIONS:{BUILDING:"ACTIVE INVALID",ACTIVE:"SUPERSEDED INVALID",SUPERSEDED:"ACTIVE INVALID",INVALID:""},
 HUMAN_RESOLUTION_REQUEST_TRANSITIONS:{OPEN:"RESOLVED SUPERSEDED CANCELLED",RESOLVED:"",SUPERSEDED:"",CANCELLED:""}
};
const authorities={
 ASSESSMENT_LIFECYCLE_TRANSITIONS:"AUTHORIZED_REVISION_CAS_AND_ATOMIC_EVENT",
 AGENT_EXECUTION_TRANSITIONS:"RUNTIME_EXECUTION_AUTHORITY",
 DECISION_RESOLUTION_TRANSITIONS:"DECISION_COVERAGE_AUTHORITY",
 ARTIFACT_LIFECYCLE_TRANSITIONS:"ARTIFACT_OWNER_AUTHORITY",
 HUMAN_RESOLUTION_REQUEST_TRANSITIONS:"HUMAN_RESOLUTION_AUTHORITY"
};
function expectedGuards(name,from,to){
 const g=[authorities[name]];
 if(name==="ASSESSMENT_LIFECYCLE_TRANSITIONS"){
  if(to==="ACTIVE") g.push("PINNED_RUNTIME_INPUTS_READY","ALL_CHECKPOINT_BLOCKERS_RESOLVED","SAME_ASSESSMENT_ROOT_THREAD");
  if(to==="WAITING_FOR_HUMAN") g.push("OPEN_MATERIAL_HUMAN_REQUEST");
  if(to==="WAITING_FOR_REQUIRED_INPUT") g.push("OUTSTANDING_REQUIRED_INPUT");
  if(from==="PAUSED" && to.startsWith("WAITING_")) g.push("SAME_ASSESSMENT_ROOT_THREAD");
  if(to==="PAUSED") g.push("EXPLICIT_SAFE_PAUSE");
  if(to==="FINALIZING") g.push("COMPLETION_GATE_ZERO_BLOCKERS");
  if(to==="COMPLETE") g.push("ARTIFACT_PERSISTED_AND_VALIDATED");
  if(to==="BLOCKED") g.push("DEPENDENCY_PERMANENTLY_UNOBTAINABLE");
  if(from==="BLOCKED" && to==="ACTIVE") g.push("EXPLICIT_NEW_RESOLVABLE_INPUT_ACCEPTED");
  if(from==="FAILED" && to==="ACTIVE") g.push("GOVERNED_RETRY");
  if(to==="FAILED") g.push("UNRECOVERABLE_RUNTIME_FAILURE");
  if(to==="CANCELLED") g.push("EXPLICIT_CANCELLATION_BEFORE_PUBLICATION");
 }
 if(name==="DECISION_RESOLUTION_TRANSITIONS" && to==="RESOLVED") g.push("ACCEPTED_COMPLETE_RULE_DECISION");
 if(name==="ARTIFACT_LIFECYCLE_TRANSITIONS"){
  if(to==="ACTIVE") g.push("VALIDATED_ARTIFACT");
  if(from==="SUPERSEDED") g.push("VALIDATED_AUDITED_PORTFOLIO_ROLLBACK");
 }
 if(name==="HUMAN_RESOLUTION_REQUEST_TRANSITIONS") g.push({RESOLVED:"VALID_SUFFICIENT_FACT_ANSWER",SUPERSEDED:"QUESTION_NO_LONGER_MATERIAL",CANCELLED:"ASSESSMENT_CANCELLED"}[to]);
 return g;
}
const allGuards=Object.values(c.AGENTIC_RUNTIME_TRANSITION_GUARDS);
for(const [name,rows] of Object.entries(manifest)){
 const table=c[name],states=Object.keys(rows);
 check(name+" exhaustive keys",JSON.stringify(Object.keys(table).sort()),JSON.stringify(states.sort()));
 for(const from of states) for(const to of states){
  pairs++;
  const allowed=rows[from].split(" ").filter(Boolean).includes(to);
  check(name+" "+from+" -> "+to,c.isAgenticRuntimeTransitionAllowed(table,from,to,allGuards),allowed);
  if(allowed){
   const expected=expectedGuards(name,from,to);
   check(name+" exact guards "+from+" -> "+to,JSON.stringify([...table[from][to]].sort()),JSON.stringify(expected.sort()));
   for(const missing of expected){
    guardProbes++;
    check(name+" missing "+missing+" "+from+" -> "+to,c.isAgenticRuntimeTransitionAllowed(table,from,to,allGuards.filter(g=>g!==missing)),false);
   }
  }
 }
}
const ids=Array.from({length:9},(_,i)=>String(i+1).repeat(8)+"-"+String(i+1).repeat(4)+"-4"+String(i+1).repeat(3)+"-8"+String(i+1).repeat(3)+"-"+String(i+1).repeat(12));
const [assessmentId,threadId,requestId,factId,evidenceId,portfolioId,snapshotId,eventId,executionId]=ids;
const timestamp="2026-10-05T10:00:00.000Z",caseRevision=12;
const blockerRefs={
 HUMAN_FACT_UNRESOLVABLE:{humanResolutionRequestId:requestId},
 REQUIRED_DOCUMENT_UNAVAILABLE:{documentRequestId:requestId},
 REQUIRED_RUNTIME_INPUT_UNAVAILABLE:{requiredInputId:requestId},
 LEGAL_PORTFOLIO_UNAVAILABLE:{legalPortfolioVersionId:portfolioId},
 REPOSITORY_SNAPSHOT_UNAVAILABLE:{repositorySnapshotId:snapshotId}
};
const humanBlocker={reason:"HUMAN_FACT_UNRESOLVABLE",reference:blockerRefs.HUMAN_FACT_UNRESOLVABLE};
for(const [reason,reference] of Object.entries(blockerRefs)){
 check("blocker valid "+reason,c.assessmentBlockerSchema.safeParse({reason,reference}).success);
 check("blocker missing ref "+reason,c.assessmentBlockerSchema.safeParse({reason}).success,false);
 check("blocker wrong ref "+reason,c.assessmentBlockerSchema.safeParse({reason,reference:{unrelatedId:requestId}}).success,false);
 check("blocked lifecycle "+reason,c.assessmentLifecycleSchema.safeParse({state:"BLOCKED",assessmentRevision:1,blocker:{reason,reference}}).success);
 check("nonblocked has blocker "+reason,c.assessmentLifecycleSchema.safeParse({state:"ACTIVE",assessmentRevision:1,blocker:{reason,reference}}).success,false);
}
check("blocked missing reason",c.assessmentLifecycleSchema.safeParse({state:"BLOCKED",assessmentRevision:1}).success,false);
for(const [name,schema] of [
 ["ASSESSMENT_LIFECYCLE_TRANSITIONS",c.assessmentLifecycleChangedPayloadSchema],
 ["AGENT_EXECUTION_TRANSITIONS",c.executionStateChangedPayloadSchema],
 ["ARTIFACT_LIFECYCLE_TRANSITIONS",c.artifactChangedPayloadSchema],
 ["HUMAN_RESOLUTION_REQUEST_TRANSITIONS",c.humanResolutionChangedPayloadSchema]
]){
 const rows=manifest[name];
 for(const from of Object.keys(rows)) for(const to of Object.keys(rows)){
  payloadPairs++;
  const allowed=rows[from].split(" ").filter(Boolean).includes(to);
  let payload;
  if(name==="ASSESSMENT_LIFECYCLE_TRANSITIONS") payload={fromState:from,toState:to,assessmentRevision:1,...(to==="BLOCKED"?{blocker:humanBlocker}:{})};
  if(name==="AGENT_EXECUTION_TRANSITIONS") payload={fromState:from,toState:to};
  if(name==="ARTIFACT_LIFECYCLE_TRANSITIONS") payload={artifactId:eventId,fromState:from,toState:to};
  if(name==="HUMAN_RESOLUTION_REQUEST_TRANSITIONS") payload={requestId,fromStatus:from,toStatus:to,caseRevision};
  check(name+" payload "+from+" -> "+to,schema.safeParse(payload).success,allowed);
 }
}
const envelope={eventId,assessmentId,threadId,sequence:1,timestamp};
const activity={...envelope,eventType:"ACTIVITY_RECORDED",actorType:"SUBAGENT",executionId,parentExecutionId:requestId,taskId:"task-1",payload:{kind:"TASK",labelKey:"assessment.activity.research"}};
check("valid subagent event",c.assessmentEventSchema.safeParse(activity).success);
for(const key of ["executionId","parentExecutionId","taskId"]){
 const bad={...activity};delete bad[key];
 check("subagent missing "+key,c.assessmentEventSchema.safeParse(bad).success,false);
}
check("self parent",c.assessmentEventSchema.safeParse({...activity,parentExecutionId:executionId}).success,false);
for(const key of ["rawProviderInput","customerFacts","evidenceBody","secret"]){
 check("private payload field "+key,c.assessmentEventSchema.safeParse({...activity,payload:{...activity.payload,[key]:"private"}}).success,false);
}
for(const [key,value] of [["sequence",-1],["sequence",0.5],["sequence",Number.MAX_SAFE_INTEGER+1],["timestamp","2026-10-05T10:00:00+07:00"],["eventType","UNKNOWN_EVENT"],["actorType","RESEARCHER"],["assessmentId","bad"],["technicalDetailsRef","https://unsafe.example"]]){
 check("malformed envelope "+key+"="+value,c.assessmentEventSchema.safeParse({...activity,[key]:value}).success,false);
}
const eventCases=[
 ["ASSESSMENT_LIFECYCLE_CHANGED","API",{fromState:"ACTIVE",toState:"FINALIZING",assessmentRevision:2}],
 ["EXECUTION_STATE_CHANGED","RUNTIME",{fromState:"RUNNING",toState:"SUCCEEDED"}],
 ["EVIDENCE_ACCEPTED","API",{evidenceId,caseRevision}],
 ["DECISION_ACCEPTED","API",{decisionId:eventId,engineeringRuleId:"ER-1",decisionRevision:1}],
 ["HUMAN_RESOLUTION_CHANGED","API",{requestId,fromStatus:null,toStatus:"OPEN",caseRevision}],
 ["ARTIFACT_CHANGED","API",{artifactId:eventId,fromState:null,toState:"BUILDING"}]
];
for(const [eventType,actorType,payload] of eventCases){
 const event={...envelope,eventType,actorType,payload,...(eventType==="EXECUTION_STATE_CHANGED"?{executionId}:{})};
 check("event valid "+eventType,c.assessmentEventSchema.safeParse(event).success);
 check("event wrong owner "+eventType,c.assessmentEventSchema.safeParse({...event,actorType:"ASSESSMENT_ROOT"}).success,false);
 check("event malformed payload "+eventType,c.assessmentEventSchema.safeParse({...event,payload:{}}).success,false);
}
const usage={invocationId:"inv-1",promptTokens:5,completionTokens:7,totalTokens:12};
check("valid usage",c.assessmentEventTokenUsageSchema.safeParse(usage).success);
check("paired cost",c.assessmentEventTokenUsageSchema.safeParse({...usage,cost:0.01,currency:"USD"}).success);
check("unpaired cost",c.assessmentEventTokenUsageSchema.safeParse({...usage,cost:0.01}).success,false);
check("negative usage",c.assessmentEventTokenUsageSchema.safeParse({...usage,totalTokens:-1}).success,false);
const ref={type:"ASSESSMENT_EVIDENCE",evidenceId};
const fact={type:"CONFIRMED_FACT",factId,caseRevision};
const criterion={criterionId:"CR-1",outcome:"MET",rationale:"Root explanation",references:[ref,fact]};
const decision={engineeringRuleId:"ER-1",engineeringRuleVersion:"v1",scopeId:"scope-1",legalPortfolioVersionId:portfolioId,repositorySnapshotId:snapshotId,repositoryCommit:"a".repeat(40),caseRevision,legalContextRefs:[{legalContextId:"CTX-1"}],applicability:"APPLICABLE",rationale:"Root explanation",references:[ref],criteria:[criterion],compliance:"COMPLIANT"};
check("final applicable compliant",c.ruleDecisionSchema.safeParse(decision).success);
check("final noncompliant",c.ruleDecisionSchema.safeParse({...decision,criteria:[{...criterion,outcome:"NOT_MET"}],compliance:"NON_COMPLIANT"}).success);
check("final not applicable",c.ruleDecisionSchema.safeParse({...decision,applicability:"NOT_APPLICABLE",criteria:[],compliance:null}).success);
for(const [key,value] of [["applicability","UNKNOWN"],["compliance","PARTIAL"],["criteria",[]],["legalContextRefs",[]],["legalContextRefs",[{legalContextId:"CTX-1",evidenceId}]],["references",[{type:"SHARED_MEMORY",memoryId:factId}]],["criteria",[{...criterion,references:[{...fact,caseRevision:13}]}]],["criteria",[criterion,criterion]],["compliance","NON_COMPLIANT"]]){
 check("malformed final decision "+key+"="+JSON.stringify(value),c.ruleDecisionSchema.safeParse({...decision,[key]:value}).success,false);
}
const question={engineeringRuleId:"ER-1",criterionIds:["CR-1"],question:"What is your retention period?",unresolvedFact:"The organization controls the period.",decisionImpact:["Changes criterion outcome."],resolutionAttempts:["Inspected repository and documents."],controlType:"SINGLE_CHOICE",choices:[{value:"30-days",label:"30 days"}]};
check("complete open command",c.openHumanResolutionRequestSchema.safeParse({...question,expectedCaseRevision:caseRevision}).success);
for(const key of ["unresolvedFact","resolutionAttempts","controlType","choices","decisionImpact"]){
 const bad={...question,expectedCaseRevision:caseRevision};delete bad[key];
 check("incomplete question "+key,c.openHumanResolutionRequestSchema.safeParse(bad).success,false);
}
const open={...question,requestId,assessmentId,threadId,caseRevision,status:"OPEN",answers:[],createdAt:timestamp};
check("open request",c.humanResolutionRequestSchema.safeParse(open).success);
const resolved={...open,status:"RESOLVED",answers:[{doesNotKnow:false,answer:"30 days",answeredAt:timestamp}],resolvedFactRef:fact,resolvedAt:timestamp};
check("resolved fact request",c.humanResolutionRequestSchema.safeParse(resolved).success);
check("evidence-only resolution",c.humanResolutionRequestSchema.safeParse({...resolved,resolvedFactRef:ref}).success,false);
check("stale fact resolution",c.humanResolutionRequestSchema.safeParse({...resolved,resolvedFactRef:{...fact,caseRevision:13}}).success,false);
check("answer cannot approve",c.answerHumanResolutionRequestSchema.safeParse({expectedCaseRevision:caseRevision,doesNotKnow:true,approved:true}).success,false);
const unknown={...open,answers:[{doesNotKnow:true,answeredAt:timestamp}]};
check("unknown remains open",c.humanResolutionRequestSchema.safeParse(unknown).success);
check("unknown cannot resolve",c.humanResolutionRequestSchema.safeParse({...resolved,answers:unknown.answers}).success,false);
// Freeze 3.5: no-longer-material questions supersede; assessment cancellation cancels.
// The fact remains unresolved by the unknown answer; a later resource command is independent.
check("unknown answer then supersede",c.humanResolutionRequestSchema.safeParse({...unknown,status:"SUPERSEDED"}).success);
check("unknown answer then cancel",c.humanResolutionRequestSchema.safeParse({...unknown,status:"CANCELLED"}).success);
const source=fs.readFileSync("packages/contracts/src/assessment/agentic-runtime.ts","utf8");
check("no TypeScript enum declaration",!/(?:export\s+)?(?:const\s+)?enum\s+[A-Za-z_$]/.test(source));
check("no handwritten literal union",!/(?:=|\|)\s*["'][^"'\n]+["']\s*\|/.test(source));
console.log(JSON.stringify({assertions,pairs,payloadPairs,guardProbes,failures},null,2));
assert.equal(failures.length,0,"Frozen W1.1 acceptance failures");
W11_CHECK
```

### Runnable strict type and AST check

The TypeScript fixture exists only in the compiler host's memory. It checks required SUBAGENT lineage, discriminated decision narrowing, exclusion of legacy/UNKNOWN values, and the prohibited declaration forms.

```bash
rtk proxy pnpm exec tsx <<'W11_TYPE_CHECK'
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
const virtualPath=path.join(process.cwd(),"tests/__w11_reviewer_virtual.ts");
const fixture=[
 'import type { AssessmentEvent, AssessmentLifecycleState, RuleDecision } from "../packages/contracts/src/assessment/agentic-runtime.ts";',
 'declare const event: AssessmentEvent;',
 'if (event.actorType === "SUBAGENT") { const a: string = event.executionId; const b: string = event.parentExecutionId; const c: string = event.taskId; }',
 'const base = { eventId:"id", assessmentId:"id", threadId:"id", sequence:1, timestamp:"date", actorType:"SUBAGENT" as const, eventType:"ACTIVITY_RECORDED" as const, payload:{kind:"TASK" as const,labelKey:"activity.research"} };',
 '// @ts-expect-error SUBAGENT requires execution/task/parent lineage',
 'const badEvent: AssessmentEvent = base;',
 '// @ts-expect-error legacy lifecycle is excluded',
 'const badState: AssessmentLifecycleState = "CONTEXT_READY";',
 'declare const decision: RuleDecision;',
 'if (decision.applicability === "NOT_APPLICABLE") { const result: null = decision.compliance; }',
 '// @ts-expect-error canonical final decision has no UNKNOWN outcome',
 'const badCompliance: RuleDecision["compliance"] = "UNKNOWN";'
].join("\n");
const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,strict:true,noEmit:true,allowImportingTsExtensions:true,skipLibCheck:true,types:["node"]};
const host=ts.createCompilerHost(options);
const get=host.getSourceFile.bind(host), exists=host.fileExists.bind(host), read=host.readFile.bind(host);
host.fileExists=p=>p===virtualPath||exists(p);
host.readFile=p=>p===virtualPath?fixture:read(p);
host.getSourceFile=(p,version,...args)=>p===virtualPath?ts.createSourceFile(p,fixture,version,true):get(p,version,...args);
const program=ts.createProgram([virtualPath],options,host);
const diagnostics=ts.getPreEmitDiagnostics(program);
console.log(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:()=>process.cwd(),getNewLine:()=>"\n",getCanonicalFileName:p=>p}));
assert.equal(diagnostics.length,0);
const sourcePath="packages/contracts/src/assessment/agentic-runtime.ts";
const ast=ts.createSourceFile(sourcePath,fs.readFileSync(sourcePath,"utf8"),ts.ScriptTarget.Latest,true);
const forbidden=[];
function visit(node){
 if(ts.isEnumDeclaration(node)) forbidden.push("TypeScript enum");
 if(ts.isUnionTypeNode(node)&&node.types.some(t=>ts.isLiteralTypeNode(t)&&ts.isStringLiteral(t.literal))) forbidden.push("handwritten string literal union");
 ts.forEachChild(node,visit);
}
visit(ast);
assert.deepEqual(forbidden,[]);
console.log("PASS: strict virtual type fixture and AST enum/literal-union checks; no files emitted");
W11_TYPE_CHECK
```


## Re-review 2 — fresh independent acceptance after focused repair (2026-10-05)

**Verdict: PASS for W1.1. No remaining blocking findings.** This section supersedes the earlier REQUEST_CHANGES verdicts for the source snapshot below; all earlier findings and reproduction scripts are preserved. The independent W1.1 review barrier is satisfied, and the coordinator may advance W1.2 according to the Freeze's merge/dependency ordering. This is not the full W1 integration gate or a production release approval.

### Authority, snapshot and review ownership

Read the entire authoritative `reports/architecture-freeze-migration-manifest.md`, sections 1 through 12 (464 lines), and the plan's detailed sections 5.6–5.7 and 11.1–11.5. Inspected the complete current contract (1,067 lines), assessment/root barrels, package exports, complete repair tests (214 lines), and tracked/untracked implementation additions. Freeze section 3 controls transitions where the longer plan differs. The current coordinator directive explicitly supersedes the original `/tmp` handoff/output requirement; no ephemeral implementation handoff or implementation claims were used as acceptance proof.

HEAD remains `c6ce6d954f02a755beffe3f62df2f5cc3e8bfa24`. SHA-256 values verified unchanged across the review:

| File | SHA-256 |
|---|---|
| `reports/architecture-freeze-migration-manifest.md` | `8210952261e034edcb0796b57625c2d11205e2044f647b4b6517272be7e24e01` |
| `packages/contracts/src/assessment/agentic-runtime.ts` | `73902a023efb3436a85b3da6a57dd6cf21f3b18548483a1b7f8eaf80a429eafb` |
| `packages/contracts/src/assessment/index.ts` | `4d20f5b8129834713ffa07db84dc5d7c2eddb4776fb66e3e7a54e79a5e6faa87` |
| `tests/agentic-runtime-contracts.test.ts` | `347c7b73e857aa93e609307a34ca1b6ef20bed2686bbeba8ba92b6f78473aaab` |

The tracked implementation diff adds only the assessment barrel export. Both untracked implementation/test bodies were read directly; they are omitted from ordinary `git diff`, so treating that diff alone as the implementation would be incomplete. This reviewer changed only this report and created its own runnable check copies/snapshot under `/tmp`; no application source, tests, graph, coordinator ledger, commits, or remote state were changed, and no workers were created.

### Prior findings and the focused repair

**Root cause (previous re-review P1):** The previous unknown-answer refinement forced every request whose latest answer was unknown to remain OPEN, also rejecting authorized supersession and assessment cancellation while preserving answer history. That contradicted Freeze section 3.5 and its request transition table.

**Fix verified:** Current `agentic-runtime.ts:802–810` rejects an unknown latest answer only when status is RESOLVED. The unknown-answer history remains valid for OPEN, SUPERSEDED and CANCELLED. The confirmed-fact discriminator and revision check at lines 774–801 remain intact. The new regression at `tests/agentic-runtime-contracts.test.ts:157–170` verifies that supersession and cancellation retain the unknown-answer record exactly. No repair was made by this reviewer.

All prior findings are now closed on the inspected snapshot:

- Complete human-fact packet: lines 705–815 include unresolvedFact, decisionImpact[], resolutionAttempts[], controlType, choices[], answers[], and a confirmed resolvedFactRef with request revision. Evidence-only resolution, stale fact revision, malformed answers and approval/verdict fields reject.
- Legal-context references: lines 617–632 require typed legalContextRefs in both final decision variants. Empty and malformed legal-context references reject.
- Unknown-answer cancellation/supersession: the focused status guard and the independent 770-assertion checker now pass both previously failing cases while still rejecting unknown → RESOLVED.

### Fresh Freeze conformance

| Freeze requirement | Current evidence and independent verification | Result |
|---|---|---|
| Sections 1–2: agent semantics and deterministic integrity | The module accepts Root-authored semantic choices; it does not derive applicability, evidence meaning, question materiality or compliance from source facts. Criterion/compliance coherence checks the authored packet. Comments preserve API authorization, lineage, provenance, pin/revision and persistence authority. | PASS for W1.1 |
| Section 3: exact closed vocabularies | ALS (11), AES (7), DRS (5), ALCS (4), BlockerReason (5), request statuses (4), applicability (2), criterion outcomes (2) and compliance outcomes (2) exactly match the Freeze. Constant keys equal their SCREAMING_SNAKE_CASE values; TypeScript types derive from constants or schemas. No legacy alias, UNKNOWN/PARTIAL result, FINAL artifact state, TypeScript enum or handwritten literal union. | PASS |
| Section 3: exact transitions and guards | All 227 state pairs across ALS/AES/DRS/ALCS/request status match. Exact guard lists match and all 129 missing-guard probes reject. COMPLETE/CANCELLED lifecycle and terminal executions have no exits; BLOCKED reopening, governed retry, same-thread resume, completion gate, artifact persistence and audited portfolio rollback retain their required obligations. | PASS |
| Section 3.5: blockers and fact requests | All five BLOCKED reasons require their corresponding typed references; malformed/missing/ambiguous refs reject and non-BLOCKED state cannot carry a blocker. Unavailable portfolio/snapshot may name the required-input resource before a pin exists. Unknown answers cannot resolve facts but do not prevent later cancellation/supersession. | PASS |
| Section 4: AssessmentEvent | Exact seven event types and five actor types; strict event-specific payloads; API-owned lifecycle/accepted-domain events and runtime-owned execution events. UUID identity, safe nonnegative integer sequence, UTC timestamp, token fields/paired cost-currency and opaque detail reference validate. All 202 transition-payload pairs match; malformed payloads and raw-content fields reject. | PASS for contract structure |
| Section 4: child lineage | SUBAGENT requires executionId, parentExecutionId and taskId in runtime validation and strict TypeScript narrowing. Partial child lineage rejects for TOOL/RUNTIME/API as well; self-parenting rejects. Actual assessment/root-thread ownership is explicitly server-validated rather than inferred from UUID syntax. | PASS for W1.1 |
| Sections 5–6: memory, authority, pins and decisions | Shared-memory provenance is excluded from decision refs. Portfolio/snapshot/commit/case pins and explicit legal-context refs exist; confirmed facts must match packet revision. All three final dispositions parse; inconsistent, empty, duplicate, stale and UNKNOWN/PARTIAL packets reject. Authority/existence lookup and full criterion coverage against the real pinned portfolio remain DecisionValidator responsibilities. | PASS for W1.1 boundary |
| Sections 7–9: migration and legacy boundaries | Additive foundation/export; no consumer deletion, compatibility alias or new Python lifecycle mirror. Existing legacy/resource exports are retained for the frozen consumer migration, while new canonical sets incorporate no legacy values. | PASS |
| Sections 10–11: full fact-resolution packet and W1.1 ownership | Complete open/persisted request data and fact-only answer command; known answer after unknown can resolve against a confirmed fact, while unauthorized status/identity/verdict fields reject. Only contract foundation/barrel plus focused regression tests are in the reviewed implementation; review ownership is report-only. | PASS |
| Section 12 and later W1 gates | Production API/PostgreSQL/outbox/checkpointer/image behavior, CAS concurrency, row/event atomicity, sequence delivery, semantic agent evals, namespace isolation and browser flows are not established by these unit/type checks. This review claims W1.1 acceptance only. | NOT PROVEN; later gates |

### MCP discovery and actual consumers

Used codebase-memory MCP `search_graph`, `search_code`, `get_code_snippet`, `trace_path` and `query_graph` before source fallback; the correct project was already indexed. The import query confirms root barrel → assessment barrel → agentic-runtime. Inbound traces for the transition helper and request schema returned no callers; those graph results omitted the live new regression test, and the module snippet ended at line 1007 while the actual file has 1067 lines. A bounded live `rg` fallback therefore reconciled definitions/imports against current `packages`, `apps`, `deepagents` and `tests`, excluding generated dependencies/builds: only the new module, assessment export and contract test currently consume these symbols. MCP and live Python searches found no canonical lifecycle mirror. The acceptance checker also imports both public package entries and confirms canonical constant identity.

Graphify query was used for navigation; its truncated subgraph was not treated as exhaustive evidence. No graph refresh was needed because this review changed no code.

### Exact checks executed in this review

All commands ran from the integration worktree root. The 770-assertion and strict fixture shell blocks above were extracted verbatim from this durable report into reviewer-owned scripts, then executed with no modifications to their checks. Coordinator-reported successes were treated as context only; every required result below was independently observed.

| Exact command | Exit | Observed result |
|---|---:|---|
| `rtk proxy pnpm exec tsc -p packages/contracts/tsconfig.json --noEmit --incremental false --composite false` | 0 | Contract typecheck passes; no output/build files emitted. |
| `rtk proxy pnpm exec tsx --test tests/agentic-runtime-contracts.test.ts` | 0 | 5 tests passed; 0 failed/skipped/cancelled. |
| `rtk proxy bash /tmp/lcsp-w11-fresh-w11_check.sh` | 0 | 770 assertions; 227 transition pairs; 202 payload pairs; 129 missing-guard probes; `failures: []`. |
| `rtk proxy bash /tmp/lcsp-w11-fresh-w11_type_check.sh` | 0 | Strict virtual type fixture and AST enum/literal-union checks pass; no files emitted. |
| `rtk proxy pnpm run check:contracts` | 0 | `Contract literal policy passed.` |
| `rtk proxy pnpm exec prettier --check packages/contracts/src/assessment/agentic-runtime.ts packages/contracts/src/assessment/index.ts tests/agentic-runtime-contracts.test.ts` | 0 | All matched files use Prettier code style. |
| `rtk proxy git diff --check` | 0 | No tracked whitespace errors. |
| `rtk proxy git diff -- packages/contracts/src/assessment/index.ts` | 0 | Exactly one canonical export added. |
| `rtk proxy git diff --no-index --numstat -- /dev/null packages/contracts/src/assessment/agentic-runtime.ts` | 1 | Expected diff-present result: 1067 additions, 0 deletions. |
| `rtk proxy git diff --no-index --numstat -- /dev/null tests/agentic-runtime-contracts.test.ts` | 1 | Expected diff-present result: 214 additions, 0 deletions. |
| `rtk proxy graphify query 'Canonical agentic assessment runtime contracts exports transitions RuleDecision HumanResolutionRequest event envelope'` | 0 | Navigation succeeds; output is truncated and supplies no acceptance proof. |
| `rtk proxy pnpm exec tsx <<'FRESH_BOUNDARY_CHECK'` with the additional check below | 0 | 33 additional envelope/lineage/blocker/answer-history checks pass. |

The no-emit contract check intentionally avoids a build's repository artifacts while checking the actual current package. No API/web/full-repository test suite, remote CI, live provider or browser result is claimed.

### Additional independently authored boundary check

Run from the worktree root; this is the exact supplemental check executed in this review.

```bash
rtk proxy pnpm exec tsx <<'FRESH_BOUNDARY_CHECK'
import assert from 'node:assert/strict';
import * as c from './packages/contracts/src/assessment/agentic-runtime.ts';
let checks=0;
function expect(schema, value, success, label) { checks++; assert.equal(schema.safeParse(value).success,success,label); }
const ids=Array.from({length:7},(_,i)=>String(i+1).repeat(8)+'-'+String(i+1).repeat(4)+'-4'+String(i+1).repeat(3)+'-8'+String(i+1).repeat(3)+'-'+String(i+1).repeat(12));
const [assessmentId,threadId,requestId,factId,eventId,executionId,parentExecutionId]=ids;
const timestamp='2026-10-05T10:00:00.000Z';
const event={eventId,assessmentId,threadId,sequence:1,timestamp,eventType:'ACTIVITY_RECORDED',actorType:'ASSESSMENT_ROOT',executionId,payload:{kind:'MODEL',labelKey:'assessment.activity.reasoning'}};
for(const key of ['eventId','assessmentId','threadId','sequence','timestamp','eventType','actorType','payload']){const missing={...event};delete missing[key];expect(c.assessmentEventSchema,missing,false,'missing event '+key);}
for(const actorType of ['TOOL','RUNTIME','API']){
 expect(c.assessmentEventSchema,{...event,actorType,parentExecutionId},false,actorType+' incomplete child lineage');
 expect(c.assessmentEventSchema,{...event,actorType,parentExecutionId,taskId:'task-1'},true,actorType+' complete child lineage');
}
for(const field of ['assessmentLifecycleState','decision','customerFacts','rawProviderInput']) expect(c.assessmentEventSchema,{...event,[field]:'private'},false,'forbidden envelope '+field);
const blocked={reason:'LEGAL_PORTFOLIO_UNAVAILABLE',reference:{requiredInputId:requestId}};
expect(c.assessmentBlockerSchema,blocked,true,'missing portfolio references required input');
expect(c.assessmentBlockerSchema,{...blocked,reason:'REPOSITORY_SNAPSHOT_UNAVAILABLE'},true,'missing snapshot references required input');
expect(c.assessmentBlockerSchema,{...blocked,reference:{requiredInputId:requestId,legalPortfolioVersionId:factId}},false,'ambiguous blocker reference');
const request={engineeringRuleId:'ER-1',criterionIds:[],question:'Who owns the data?',unresolvedFact:'Ownership is not established.',decisionImpact:['Determines applicability.'],resolutionAttempts:['Inspected accepted evidence.'],controlType:'FREE_TEXT',choices:[],requestId,assessmentId,threadId,caseRevision:2,createdAt:timestamp,status:'OPEN',answers:[{doesNotKnow:true,answeredAt:timestamp},{doesNotKnow:false,answer:'Our organization.',answeredAt:timestamp}]};
expect(c.humanResolutionRequestSchema,{...request,status:'RESOLVED',resolvedFactRef:{type:'CONFIRMED_FACT',factId,caseRevision:2},resolvedAt:timestamp},true,'known answer after unknown resolves');
for(const answers of [[],[{doesNotKnow:false,answeredAt:timestamp}],[{doesNotKnow:true,answer:'invented',answeredAt:timestamp}]]) expect(c.humanResolutionRequestSchema,{...request,status:'RESOLVED',answers,resolvedFactRef:{type:'CONFIRMED_FACT',factId,caseRevision:2},resolvedAt:timestamp},false,'malformed resolution history');
for(const status of ['OPEN','SUPERSEDED','CANCELLED']) expect(c.humanResolutionRequestSchema,{...request,status,resolvedFactRef:{type:'CONFIRMED_FACT',factId,caseRevision:2}},false,'unresolved request cannot carry resolvedFactRef');
for(const field of ['assessmentId','threadId','status','approved','compliance']) expect(c.answerHumanResolutionRequestSchema,{expectedCaseRevision:2,doesNotKnow:false,answer:'Our organization.',[field]:'forged'},false,'answer cannot supply '+field);
console.log('PASS: '+checks+' additional malformed-envelope, child-lineage, blocker-reference and answer-history checks');
FRESH_BOUNDARY_CHECK
```
