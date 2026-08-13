---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-2-09-inspect-data-path
jira_issue: LCSP-182
status: DONE
---
# TASK-AO-2-09 — `inspect_data_path`

## 1–4. Task Information, Objective, Use Case, Definition

| Item | Value |
|---|---|
| Story / exposure / mutation | AO-2 / `LLM_CALLABLE` / `READ` |
| Owner / gate | Sanitized `DataPathProjection`; `TECHNICAL_EVIDENCE_READ`, pinned report |
| Objective | Follow category-only ingress/schema/field roles without values, schemas, defaults or prompts. |
| Policy | Audit only; 3s; one transient retry. |

AO-3 asks whether declared categories reach a provider/action; dynamic stop remains uncertain, never filled by model.

## 5. Input Schema

```json
{"type":"object","additionalProperties":false,"properties":{"startRef":{"type":"string","pattern":"^(symbol|finding|node):[A-Za-z0-9_-]{8,120}$"},"direction":{"enum":["FORWARD","BACKWARD"]},"dataCategories":{"type":"array","items":{"enum":["IDENTIFIER","CONTACT","FINANCIAL","HEALTH","LEGAL","CONTENT","UNKNOWN"]},"maxItems":7,"uniqueItems":true},"maxHops":{"type":"integer","minimum":1,"maximum":20},"maxResults":{"type":"integer","minimum":1,"maximum":100}},"required":["startRef","direction","maxHops","maxResults"]}
```

## 6. Output Schema and Examples

`result={segments:[{segmentRef,role,categories,fromRef,toRef,relativeLocation,evidenceRefs}],terminal:{state,reason},truncated}`.

```json
{"status":"READY","toolName":"inspect_data_path","toolVersion":"1.0.0","configHash":"sha256:data-path-v1","correlationId":"ab11bb22-3333-4444-8555-666677778888","artifactVersions":{"technicalEvidenceReportId":"ter_01J"},"provenanceRef":"tool-execution:data_01J","coverageState":"SUFFICIENT","evidenceRefs":["data:dp_01J"],"limitations":[],"result":{"segments":[{"segmentRef":"data:dp_01J","role":"INGRESS","categories":["IDENTIFIER"],"fromRef":"symbol:sym_01J","toRef":"symbol:sym_02J","relativeLocation":"apps/api/src/input.ts:19","evidenceRefs":["evidence:ev_01J"]}],"terminal":{"state":"RESOLVED","reason":"STATIC_BOUNDARY"},"truncated":false}}
```

## 7. Errors and Typed Outcomes

Invalid input=`INVALID_ARGUMENT`; no report=`NEEDS_INPUT`; unknown start=`NOT_FOUND`; dynamic/limited/cap path=`OUT_OF_COVERAGE`; PBAC/version=`BLOCKED`; timeout=`FAILED` after one retry.

## 8–15. Flow, Rules, Logic, LLM, Registry, Audit, Retry, Security

Validate → allow-list/PBAC/version → category projection traversal → stable cap/terminal → coverage + deep privacy check → audit. Registry `DataPathTool`, `LLM_CALLABLE`, `TECHNICAL_EVIDENCE_READ`, 3s/one retry/`NONE`. Model receives categories/roles/ref only and may inspect returned reference; forbidden: actual values, raw schemas, default values, source, prompt, secrets, AST or DB access. Audit shared fields/hashes/budget/refs.

## 16–18. Scenario, AC, Tests

Model inspects a provider-adjacent symbol; `IDENTIFIER` category appears at ingress but dynamic terminal means it reports partial structural evidence. AC: cap/terminal explicit, categories only, strict/PBAC/audit/privacy.

| ID | Scenario | Level |
|---|---|---|
| TC-01 | ingress-to-provider category trace | integration |
| TC-02 | category/cap/extra input | contract |
| TC-03 | dynamic/tenant/PBAC | integration |
| TC-04 | PII value/schema leak | privacy |
| TC-05 | timeout/audit | worker |

## 19–22. DoD, Files, Questions, Deliverables

Implement contracts/registry/projection handler/normalizer/API audit/PBAC/tests. OQ-01: ratify category taxonomy ownership (Data governance, OPEN, blocks yes). Deliver definition/schema, mapper, audit/tests.

## Source Authority

- `docs/specs/spec-agentic-evidence-orchestration/tool-catalog.md`
- `docs/implementation/tasks/modules/agentic-evidence-tools/shared-tool-contract.md`
