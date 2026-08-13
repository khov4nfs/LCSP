---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-2-12-inspect-deployment-context
jira_issue: LCSP-184
status: DONE
---
# TASK-AO-2-12 — `inspect_deployment_context`

## 1–4. Task Information, Objective, Use Case, Definition

| Item | Value |
|---|---|
| Story / exposure / mutation | AO-2 / `LLM_CALLABLE` / `READ` |
| Owner / gate | Immutable sanitized `DeploymentProjection`; `TECHNICAL_EVIDENCE_READ`, report/version pin |
| Objective | Return approved deployment categories and evidence refs, never manifest/config key/value or secrets. |
| Policy | Audit only; 2s, one transient retry. |

AO-3 uses it as supporting technical context; it cannot be used to retrieve arbitrary config or certify runtime deployment.

## 5. Input Schema

```json
{"type":"object","additionalProperties":false,"properties":{"pathPrefixes":{"type":"array","items":{"type":"string","pattern":"^(?!/|.*\\.\\.)[A-Za-z0-9._/-]+/$"},"maxItems":20,"uniqueItems":true},"manifestKinds":{"type":"array","items":{"enum":["CONTAINER","KUBERNETES","CI_CD","INFRASTRUCTURE","RUNTIME_METADATA"]},"maxItems":5,"uniqueItems":true},"environments":{"type":"array","items":{"enum":["DEVELOPMENT","TEST","STAGING","PRODUCTION","UNKNOWN"]},"maxItems":5,"uniqueItems":true},"cursor":{"type":"string","maxLength":512},"maxResults":{"type":"integer","minimum":1,"maximum":100}},"required":["maxResults"]}
```

## 6. Output Schema and Examples

`result={contexts:[{contextRef,manifestKind,environment,relativeLocation,categories,evidenceRefs}],nextCursor,truncated}` sorted relative path/ref.

```json
{"status":"READY","toolName":"inspect_deployment_context","toolVersion":"1.0.0","configHash":"sha256:deployment-v1","correlationId":"ae11bb22-3333-4444-8555-666677778888","artifactVersions":{"technicalEvidenceReportId":"ter_01J"},"provenanceRef":"tool-execution:deploy_01J","coverageState":"SUFFICIENT","evidenceRefs":["deployment:dp_01J"],"limitations":[],"result":{"contexts":[{"contextRef":"deployment:dp_01J","manifestKind":"KUBERNETES","environment":"PRODUCTION","relativeLocation":"deploy/api.yaml","categories":["NETWORK_EGRESS","WORKLOAD"],"evidenceRefs":["evidence:ev_01J"]}],"nextCursor":null,"truncated":false}}
```

## 7. Errors and Typed Outcomes

Bad enum/path/cursor/cap=`INVALID_ARGUMENT`; no report=`NEEDS_INPUT`; exhaustive empty=`READY`; limited scope=`OUT_OF_COVERAGE`; PBAC/version/tenant=`BLOCKED`; timeout=`FAILED` after one retry.

## 8–15. Flow, Rules, Logic, LLM, Registry, Audit, Retry, Security

Validate → allow-list/PBAC/version → bounded projection page → stable sort/cap → coverage/privacy/audit. Registry `DeploymentContextTool`, `LLM_CALLABLE`, `TECHNICAL_EVIDENCE_READ`, 2s/one retry/`NONE`. Model sees ≤100 categories/refs and may not ask for keys, values, secret names, manifests or runtime access. Audit shared safe hashes/versions/budget/refs; deep deny forbidden keys/values/source/prompts/secrets/AST/absolute paths.

## 16–18. Scenario, AC, Tests

For “is there production deployment context?”, a category-only K8s record is supporting evidence; limited manifests require limitation. AC: page is stable, invalid/PBAC reject pre-read, empty/limited differ, privacy/audit hold.

| ID | Scenario | Level |
|---|---|---|
| TC-01 | manifest/env page cursor | integration |
| TC-02 | secret/config arbitrary lookup | contract/privacy |
| TC-03 | limited/cross-tenant/PBAC | integration |
| TC-04 | nested secret output | privacy |
| TC-05 | timeout/audit | worker |

## 19–22. DoD, Files, Questions, Deliverables

Build contract/registry/projection handler/normalizer/API PBAC/audit/tests. OQ-01: ratify deployment category allow-list (Platform, OPEN, blocks yes). Deliver strict schema, mapper/audit and tests.

## Source Authority

- `docs/specs/spec-agentic-evidence-orchestration/tool-catalog.md`
- `docs/implementation/tasks/modules/agentic-evidence-tools/shared-tool-contract.md`
