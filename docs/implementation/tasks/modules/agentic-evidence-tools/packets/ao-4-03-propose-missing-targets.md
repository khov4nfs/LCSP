---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-4-03-propose-missing-targets
jira_issue: LCSP-188
status: DONE
---
# TASK-AO-4-03 — `propose_missing_targets`

## 1–4. Task Information, Objective, Use Case, Definition

| Item | Value |
|---|---|
| Story / exposure / mutation | AO-4 / `LLM_CALLABLE` / `READ` |
| Owner / gate | Versioned candidate projection built from verified patterns; `ASSESSMENT_VERIFY` and evidence pin |
| Objective | Return bounded, evidence-backed target candidates absent from submitted IDs; candidates are neither verified facts nor wizard writes. |
| Policy | Audit only; 3s, one transient retry. |

AO-4 proposes questions/targets for human workflow review after coverage is sufficient. It never auto-adds a target.

## 5. Input Schema

```json
{"type":"object","additionalProperties":false,"properties":{"candidateKinds":{"type":"array","items":{"enum":["PROVIDER_USAGE","DATA_FLOW","DECISION_FLOW","HUMAN_REVIEW","DEPLOYMENT"]},"minItems":1,"maxItems":5,"uniqueItems":true},"seedRefs":{"type":"array","items":{"type":"string","pattern":"^(finding|symbol|node|invocation):[A-Za-z0-9_-]{8,120}$"},"maxItems":20,"uniqueItems":true},"excludeTargetIds":{"type":"array","items":{"type":"string","pattern":"^target:[A-Za-z0-9_-]{8,120}$"},"maxItems":100,"uniqueItems":true},"maxResults":{"type":"integer","minimum":1,"maximum":25}},"required":["candidateKinds","maxResults"]}
```

## 6. Output Schema and Examples

`result={algorithmVersion,candidates:[{candidateRef,kind,attributes,score,evidenceRefs,exclusionReason?}],truncated}` sort score/ref.

```json
{"status":"READY","toolName":"propose_missing_targets","toolVersion":"1.0.0","configHash":"sha256:target-candidate-v1","correlationId":"b211bb22-3333-4444-8555-666677778888","artifactVersions":{"wizardProfileId":"wp_01J","technicalEvidenceReportId":"ter_01J"},"provenanceRef":"tool-execution:proposal_01J","coverageState":"SUFFICIENT","evidenceRefs":["invocation:iv_01J"],"limitations":[],"result":{"algorithmVersion":"target-candidate-v1","candidates":[{"candidateRef":"candidate:ca_01J","kind":"PROVIDER_USAGE","attributes":{"provider":"OPENAI"},"score":0.91,"evidenceRefs":["invocation:iv_01J"]}],"truncated":false}}
```

## 7. Errors and Typed Outcomes

Invalid kind/ref/cap=`INVALID_ARGUMENT`; pins missing=`NEEDS_INPUT`; no candidate in exhaustive scope=`READY`; insufficient pattern scope=`OUT_OF_COVERAGE`; PBAC/version=`BLOCKED`; transient failure=`FAILED` after retry.

## 8–15. Flow, Rules, Logic, LLM, Registry, Audit, Retry, Security

Validate → registry/PBAC/exact pins → subtract submitted/excluded target IDs → fixed candidate algorithm → stable cap → coverage/privacy/audit. `MissingTargetProposalTool` is `LLM_CALLABLE`, `ASSESSMENT_VERIFY`, 3s/one retry/`NONE`. Model gets ≤25 typed candidates/refs and may offer them to workflow; cannot treat candidate as truth or write wizard. Audit shared hashes/config/algo/budget/refs; prohibit source, raw answers, prompt/secret/AST/direct storage.

## 16–18. Scenario, AC, Tests

Verified OpenAI invocation not represented by a submitted provider target produces a candidate; if scope partial, no overconfident candidate. AC: declared targets excluded, stable rank, no write, PBAC/privacy/audit.

| ID | Scenario | Level |
|---|---|---|
| TC-01 | candidate/exclusion/order/limit | golden |
| TC-02 | invalid refs/extra args | contract |
| TC-03 | insufficient scope/PBAC/version | integration |
| TC-04 | no wizard mutation/candidate trace | integration |
| TC-05 | sensitive payload/retry | privacy/worker |

## 19–22. DoD, Files, Questions, Deliverables

Add contracts/registry/candidate service/normalizer/API PBAC/audit/tests. OQ-01: approve candidate score threshold (Product, OPEN, blocks yes). Deliver schema/algorithm/audit/tests.

## Source Authority

- `docs/specs/spec-agentic-evidence-orchestration/tool-catalog.md`
- `docs/implementation/tasks/modules/agentic-evidence-tools/shared-tool-contract.md`
