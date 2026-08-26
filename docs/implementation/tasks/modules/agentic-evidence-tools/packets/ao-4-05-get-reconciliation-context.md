---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-4-05-get-reconciliation-context
jira_issue: LCSP-192
status: DONE
---
# TASK-AO-4-05 — `get_reconciliation_context`

## 1–4. Task Information, Objective, Use Case, Definition

| Item | Value |
|---|---|
| Story / exposure / mutation | AO-4 / `LLM_CALLABLE` / `READ` |
| Owner / gate | Scoped `ConflictRecordProjection`; `ASSESSMENT_VERIFY`, accepted flow/version |
| Objective | Return bounded conflict evidence and policy-permitted resolution paths; model cannot resolve a material conflict. |
| Policy | Audit only; 2s, one transient retry. |

AO-4 uses this after comparison detects contradiction. Missing/open conflict blocks verification rather than exposing reviewer notes.

## 5. Input Schema

```json
{"type":"object","additionalProperties":false,"properties":{"flowRef":{"type":"string","pattern":"^flow:[A-Za-z0-9_-]{8,120}$"},"conflictIds":{"type":"array","items":{"type":"string","pattern":"^conflict:[A-Za-z0-9_-]{8,120}$"},"maxItems":50,"uniqueItems":true},"statuses":{"type":"array","items":{"enum":["OPEN","ESCALATED","RESOLVED","DISMISSED"]},"maxItems":4,"uniqueItems":true},"cursor":{"type":"string","maxLength":512},"maxResults":{"type":"integer","minimum":1,"maximum":50}},"minProperties":1,"required":["maxResults"]}
```

## 6. Output Schema and Examples

`result={conflicts:[{conflictRef,type,status,score,summaryKey,evidenceRefs}],permittedResolutionPaths:[{pathId,requiredActor,requiredState}],nextCursor,truncated}`.

```json
{"status":"READY","toolName":"get_reconciliation_context","toolVersion":"1.0.0","configHash":"sha256:conflict-v1","correlationId":"b411bb22-3333-4444-8555-666677778888","artifactVersions":{"aiUsageFlowId":"flow_01J"},"provenanceRef":"tool-execution:conflict_01J","coverageState":"SUFFICIENT","evidenceRefs":["conflict:cf_01J"],"limitations":[],"result":{"conflicts":[{"conflictRef":"conflict:cf_01J","type":"CLAIM_EVIDENCE_MISMATCH","status":"OPEN","score":0.92,"summaryKey":"CONFLICT_PROVIDER_DECLARATION","evidenceRefs":["invocation:iv_01J"]}],"permittedResolutionPaths":[{"pathId":"HUMAN_RECONCILE","requiredActor":"ASSESSMENT_REVIEWER","requiredState":"OPEN"}],"nextCursor":null,"truncated":false}}
```

## 7. Errors and Typed Outcomes

Bad selector/cap=`INVALID_ARGUMENT`; missing flow/version=`NEEDS_INPUT`; unknown scoped conflict=`NOT_FOUND`; incomplete record scope=`OUT_OF_COVERAGE`; RBAC/tenant/state=`BLOCKED`; transient timeout=`FAILED` after retry.

## 8–15. Flow, Rules, Logic, LLM, Registry, Audit, Retry, Security

Validate → registry/RBAC/version → scoped conflict query → status/path policy filter → stable page → privacy/audit. `ReconciliationContextTool`, `LLM_CALLABLE`, `ASSESSMENT_VERIFY`, 2s/one retry/`NONE`. Model sees max 50 typed summaries/paths, may emit `CONFLICT` or route allowed path, never resolve/update a conflict. Audit shared hashes/refs/status; never notes, identities, source, prompt/secrets/AST/direct storage.

## 16–18. Scenario, AC, Tests

Open provider conflict returns `HUMAN_RECONCILE`; model reports conflict and does not call verified profile. AC: conflict isolation/status filtering/path enforcement, strict/RBAC/privacy/audit.

| ID | Scenario | Level |
|---|---|---|
| TC-01 | scoped conflict/page/path policy | integration |
| TC-02 | open conflict blocks downstream | integration |
| TC-03 | invalid/tenant/RBAC | contract/integration |
| TC-04 | reviewer note/identity leak | privacy |
| TC-05 | retry/audit | worker/API |

## 19–22. DoD, Files, Questions, Deliverables

Build contracts/registry/conflict projection handler/API RBAC/audit/tests. OQ-01: approve resolution-path policy source (Governance, OPEN, blocks yes). Deliver strict schema and tests.

## Source Authority

- `docs/specs/spec-agentic-evidence-orchestration/tool-catalog.md`
- `docs/implementation/tasks/modules/agentic-evidence-tools/shared-tool-contract.md`
