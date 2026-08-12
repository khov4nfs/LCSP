---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-2-11-inspect-human-review-path
jira_issue: LCSP-183
status: READY_FOR_PLANNING
---

# TASK-AO-2-11 — `inspect_human_review_path`

## 1–4. Task Information, Objective, Use Case, Definition

| Item | Value |
|---|---|
| Story / exposure / mutation | AO-2 / `LLM_CALLABLE` / `READ` |
| Owner / gate | Immutable `HumanReviewProjection`; `TECHNICAL_EVIDENCE_READ`, pinned report |
| Objective | Return queue/assignment/approval/state-gate structural evidence and `PRESENT`/`ABSENT`/`UNKNOWN`; no claim from a generic `review()` name. |
| Policy | Audit only; 3s, one transient retry. |

AO-3 determines whether defined static scope contains a review path. `ABSENT` is legal only for sufficient defined scope; dynamic evidence is `UNKNOWN`/`OUT_OF_COVERAGE`.

## 5. Input Schema

```json
{"type":"object","additionalProperties":false,"properties":{"startRef":{"type":"string","pattern":"^(symbol|finding|node):[A-Za-z0-9_-]{8,120}$"},"reviewKinds":{"type":"array","items":{"enum":["QUEUE","ASSIGNMENT","APPROVAL","STATE_GATE","ESCALATION"]},"maxItems":5,"uniqueItems":true},"maxHops":{"type":"integer","minimum":1,"maximum":20}},"required":["startRef","maxHops"]}
```

## 6. Output Schema and Examples

`result={reviewState:"PRESENT"|"ABSENT"|"UNKNOWN",segments:[{segmentRef,reviewKind,relativeLocation,evidenceRefs}],terminal:{state,reason},truncated}`.

```json
{"status":"READY","toolName":"inspect_human_review_path","toolVersion":"1.0.0","configHash":"sha256:review-v1","correlationId":"ad11bb22-3333-4444-8555-666677778888","artifactVersions":{"technicalEvidenceReportId":"ter_01J"},"provenanceRef":"tool-execution:review_01J","coverageState":"SUFFICIENT","evidenceRefs":["review:hr_01J"],"limitations":[],"result":{"reviewState":"PRESENT","segments":[{"segmentRef":"review:hr_01J","reviewKind":"APPROVAL","relativeLocation":"apps/api/src/review/approve.ts:21","evidenceRefs":["evidence:ev_01J"]}],"terminal":{"state":"RESOLVED","reason":"STATIC_BOUNDARY"},"truncated":false}}
```

## 7. Errors and Typed Outcomes

Invalid fields=`INVALID_ARGUMENT`; absent report=`NEEDS_INPUT`; unknown anchor=`NOT_FOUND`; dynamic/limited/cap=`OUT_OF_COVERAGE` and state `UNKNOWN`; PBAC/version=`BLOCKED`; transient timeout=`FAILED` after retry.

## 8–15. Flow, Rules, Logic, LLM, Registry, Audit, Retry, Security

Strict parse → registry/PBAC/version → review-only normalized traversal → derive state (never generic-name heuristic) → cap/privacy/audit. Registry `HumanReviewPathTool`, `LLM_CALLABLE`, `TECHNICAL_EVIDENCE_READ`, 3s/one retry/`NONE`. Model gets ≤20 safe segments/state and must not call `ABSENT` a compliance conclusion. Audit shared hashes/versions/refs; no source, workflow payload, reviewer identities, prompts, secrets, AST or direct storage access.

## 16–18. Scenario, AC, Tests

An approval state-gate returns `PRESENT`; a dynamic queue integration returns `UNKNOWN` with limitation. AC: state derivation is scope-aware, strict/PBAC/tenant checks hold, output safe/audited.

| ID | Scenario | Level |
|---|---|---|
| TC-01 | approval/assignment path | golden integration |
| TC-02 | generic review false positive | golden |
| TC-03 | dynamic/cap and insufficient scope | integration |
| TC-04 | extra/PBAC/tenant | contract/integration |
| TC-05 | reviewer/source leak and retry | privacy/worker |

## 19–22. DoD, Files, Questions, Deliverables

Implement contracts/registry/projection handler/normalizer/API audit/PBAC/tests. OQ-01: ratify required evidence for `PRESENT` (Policy owner, OPEN, blocks yes). Deliver strict schema/handler/audit/tests.

## Source Authority

- `docs/specs/spec-agentic-evidence-orchestration/tool-catalog.md`
- `docs/implementation/tasks/modules/agentic-evidence-tools/shared-tool-contract.md`
