---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-4-04-get-artifact-chain
jira_issue: LCSP-185
status: DONE
---
# TASK-AO-4-04 — `get_artifact_chain`

## 1–4. Task Information, Objective, Use Case, Definition

| Item | Value |
|---|---|
| Story / exposure / mutation | AO-4 / `LLM_CALLABLE` / `READ` |
| Owner / gate | Immutable artifact lineage projection; `ASSESSMENT_READ`, assessment pin |
| Objective | Resolve ref/version/provenance chain only; never hydrate artifact payloads. |
| Policy | Audit only; 1s, one transient retry. |

AO-4 reads EvidenceReport→profile→flow→conflict→verified profile and pins downstream calls. Missing/stale links are explicit limitations.

## 5. Input Schema

```json
{"type":"object","additionalProperties":false,"properties":{"anchor":{"type":"object","additionalProperties":false,"properties":{"assessmentId":{"type":"string","pattern":"^assessment:[A-Za-z0-9_-]{8,120}$"},"artifactRef":{"type":"string","pattern":"^(ter|flow|conflict|verified):_[A-Za-z0-9_-]{8,120}$"}},"minProperties":1,"maxProperties":1},"requiredStages":{"type":"array","items":{"enum":["TECHNICAL_EVIDENCE","WIZARD_PROFILE","AI_USAGE_FLOW","CONFLICT","VERIFIED_PROFILE"]},"maxItems":5,"uniqueItems":true},"exactVersions":{"type":"boolean"}},"required":["anchor"]}
```

## 6. Output Schema and Examples

`result={links:[{stage,artifactRef,version,status,provenanceRef}],missingStages:[{stage,reason}],integrity:"VALID"|"LIMITED"}`.

```json
{"status":"READY","toolName":"get_artifact_chain","toolVersion":"1.0.0","configHash":"sha256:lineage-v1","correlationId":"b311bb22-3333-4444-8555-666677778888","artifactVersions":{"assessmentId":"assessment:as_01J"},"provenanceRef":"tool-execution:chain_01J","coverageState":"SUFFICIENT","evidenceRefs":["artifact:ter_01J"],"limitations":[],"result":{"links":[{"stage":"TECHNICAL_EVIDENCE","artifactRef":"ter_01J","version":"3","status":"ACCEPTED","provenanceRef":"prov:ter_01J"},{"stage":"WIZARD_PROFILE","artifactRef":"wp_01J","version":"7","status":"SUBMITTED","provenanceRef":"prov:wp_01J"}],"missingStages":[],"integrity":"VALID"}}
```

## 7. Errors and Typed Outcomes

Bad anchor/stage=`INVALID_ARGUMENT`; missing anchor pin=`NEEDS_INPUT`; unknown anchor=`NOT_FOUND`; missing/stale lineage=`OUT_OF_COVERAGE`; PBAC/tenant=`BLOCKED`; transient error=`FAILED` after retry.

## 8–15. Flow, Rules, Logic, LLM, Registry, Audit, Retry, Security

Validate → allow-list/PBAC → immutable relation lookup → ordered stage checks → integrity/limitations → privacy/audit. `ArtifactChainTool`, `LLM_CALLABLE`, `ASSESSMENT_READ`, 1s/one retry/`NONE`. Model gets refs/status/version only and may pin them in allowed tools; it cannot fetch payload or substitute latest version. Audit shared metadata/hashes/ref chain only; deny artifact bodies/source/prompt/secret/AST/direct storage.

## 16–18. Scenario, AC, Tests

Verifier finds accepted evidence and submitted profile; missing verified stage is reported, not invented. AC: ordered immutable links, strict/tenant/PBAC/version integrity, safe audit output.

| ID | Scenario | Level |
|---|---|---|
| TC-01 | valid ordered chain | integration |
| TC-02 | missing/stale stage | integration |
| TC-03 | extra/anchor tenant/PBAC | contract/integration |
| TC-04 | payload leak | privacy |
| TC-05 | retry/audit | worker/API |

## 19–22. DoD, Files, Questions, Deliverables

Implement lineage contracts/registry/repository/handler/API PBAC/audit/tests. OQ-01: approve immutable link status vocabulary (Architecture, OPEN, blocks yes). Deliver strict schema and lineage tests.

## Source Authority

- `docs/specs/spec-agentic-evidence-orchestration/tool-catalog.md`
- `docs/implementation/tasks/modules/agentic-evidence-tools/shared-tool-contract.md`
