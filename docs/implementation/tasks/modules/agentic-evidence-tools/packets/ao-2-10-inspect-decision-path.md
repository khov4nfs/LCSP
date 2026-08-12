---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-2-10-inspect-decision-path
jira_issue: LCSP-186
status: READY_FOR_PLANNING
---

# TASK-AO-2-10 — `inspect_decision_path`

## 1–4. Task Information, Objective, Use Case, Definition

| Item | Value |
|---|---|
| Story / exposure / mutation | AO-2 / `LLM_CALLABLE` / `READ` |
| Owner / gate | Versioned `DecisionPathProjection`; `TECHNICAL_EVIDENCE_READ`, accepted report/version |
| Objective | Return bounded structural score/rank/recommend/approve/reject/status facts, not a legal or business conclusion. |
| Policy | Audit only; 3s timeout, one transient retry. |

AO-3 uses a symbol/finding anchor to determine whether static decision-path evidence exists; missing/dynamic evidence becomes `UNKNOWN`/`OUT_OF_COVERAGE`, never a model inference.

## 5. Input Schema

```json
{"type":"object","additionalProperties":false,"properties":{"startRef":{"type":"string","pattern":"^(symbol|finding|node):[A-Za-z0-9_-]{8,120}$"},"actionCategories":{"type":"array","items":{"enum":["SCORE","RANK","RECOMMEND","APPROVE","REJECT","STATUS_CHANGE"]},"maxItems":6,"uniqueItems":true},"maxHops":{"type":"integer","minimum":1,"maximum":20},"maxResults":{"type":"integer","minimum":1,"maximum":100}},"required":["startRef","maxHops","maxResults"]}
```

## 6. Output Schema and Examples

`result={segments:[{segmentRef,actionCategory,confidence,fromRef,toRef,relativeLocation,evidenceRefs}],terminal:{state,reason},truncated}` sorted path/ref.

```json
{"status":"READY","toolName":"inspect_decision_path","toolVersion":"1.0.0","configHash":"sha256:decision-v1","correlationId":"ac11bb22-3333-4444-8555-666677778888","artifactVersions":{"technicalEvidenceReportId":"ter_01J"},"provenanceRef":"tool-execution:decision_01J","coverageState":"SUFFICIENT","evidenceRefs":["decision:dc_01J"],"limitations":[],"result":{"segments":[{"segmentRef":"decision:dc_01J","actionCategory":"RECOMMEND","confidence":"MEDIUM","fromRef":"symbol:sym_01J","toRef":"symbol:sym_02J","relativeLocation":"apps/api/src/recommend.ts:33","evidenceRefs":["evidence:ev_01J"]}],"terminal":{"state":"RESOLVED","reason":"STATIC_BOUNDARY"},"truncated":false}}
```

## 7. Errors and Typed Outcomes

Invalid args=`INVALID_ARGUMENT`; absent accepted report=`NEEDS_INPUT`; unknown anchor=`NOT_FOUND`; dynamic/cap/limited evidence=`OUT_OF_COVERAGE`; PBAC/version/tenant=`BLOCKED`; transient timeout=`FAILED` after one retry.

## 8–15. Flow, Rules, Logic, LLM, Registry, Audit, Retry, Security

Validate → allow-list/PBAC/version → deterministic decision projection traversal → cap/terminal → normalize/privacy/audit. Registry `DecisionPathTool`, `LLM_CALLABLE`, `TECHNICAL_EVIDENCE_READ`, report ref, 3s/one retry/`NONE`. Model gets max 100 category segments and terminal, can call registered related tools, and must not call a recommendation “automated legal decision.” Audit shared safe fields/hashes/version/budget; deny source, expressions/scores, prompts, secrets, AST, absolute paths/stack traces and direct storage.

## 16–18. Scenario, AC, Tests

For a recommendation claim, returned structural `RECOMMEND` fact is evidence; a dynamic terminal must remain a stated limit. AC: deterministic structural-only output; invalid/PBAC preflight; limit distinction; privacy/audit.

| ID | Scenario | Level |
|---|---|---|
| TC-01 | action-category trace/order | unit/integration |
| TC-02 | cap/dynamic/unknown anchor | integration |
| TC-03 | extra/cross-tenant/PBAC | contract/integration |
| TC-04 | score/source expression leak | privacy |
| TC-05 | timeout/audit | worker |

## 19–22. DoD, Files, Questions, Deliverables

Add decision contracts/registry/projection handler/normalizer/API PBAC/audit/tests. OQ-01: approve action taxonomy mapping (Domain owner, OPEN, blocks yes). Deliver schema, handler, audit and test suite.

## Source Authority

- `docs/specs/spec-agentic-evidence-orchestration/tool-catalog.md`
- `docs/implementation/tasks/modules/agentic-evidence-tools/shared-tool-contract.md`
