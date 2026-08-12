---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-2-07-find-similar-symbols
jira_issue: LCSP-178
status: READY_FOR_PLANNING
---

# TASK-AO-2-07 — `find_similar_symbols`

## 1–4. Task Information, Objective, Use Case, Definition

| Item | Value |
|---|---|
| Story / exposure / mutation | AO-2 / `LLM_CALLABLE` / `READ` |
| Owner / gate | Versioned `SymbolFingerprintProjection`; `TECHNICAL_EVIDENCE_READ`, accepted report/version |
| Objective | Return bounded reproducible structural candidates, explicitly not verification verdicts. |
| Operation | Audit only; 2s timeout; one retry only for transient index failure. |

AO-3 calls this from a returned `symbol:` ref to discover similarly-shaped code. Missing fingerprint is `NOT_FOUND`; limited search is `OUT_OF_COVERAGE`; candidate similarity never supports a claim by itself.

## 5. Input Schema

```json
{"type":"object","additionalProperties":false,"properties":{"seedSymbolRef":{"type":"string","pattern":"^symbol:[A-Za-z0-9_-]{8,120}$"},"dimensions":{"type":"array","items":{"enum":["CALL_GRAPH","IMPORTS","DECORATORS","CATEGORIES","DATA_FLOW"]},"minItems":1,"maxItems":5,"uniqueItems":true},"pathPrefixes":{"type":"array","items":{"type":"string","pattern":"^(?!/|.*\\.\\.)[A-Za-z0-9._/-]+/$"},"maxItems":20,"uniqueItems":true},"maxResults":{"type":"integer","minimum":1,"maximum":50}},"required":["seedSymbolRef","dimensions","maxResults"]}
```

## 6. Output Schema and Examples

`result={algorithmVersion,candidates:[{symbolRef,score,matchedDimensions,relativeLocation,evidenceRefs}],excluded:{seed,limitedScope},truncated}` sorted score desc/ref; score is structural, not semantic certainty.

```json
{"status":"READY","toolName":"find_similar_symbols","toolVersion":"1.0.0","configHash":"sha256:fingerprint-v1","correlationId":"ee11bb22-3333-4444-8555-666677778888","artifactVersions":{"technicalEvidenceReportId":"ter_01J"},"provenanceRef":"tool-execution:similar_01J","coverageState":"SUFFICIENT","evidenceRefs":["symbol:sym_02J"],"limitations":[],"result":{"algorithmVersion":"fingerprint-v1","candidates":[{"symbolRef":"symbol:sym_02J","score":0.83,"matchedDimensions":["CALL_GRAPH","CATEGORIES"],"relativeLocation":"apps/api/src/ai/secondary.ts:17","evidenceRefs":["evidence:ev_02J"]}],"excluded":{"seed":"symbol:sym_01J","limitedScope":false},"truncated":false}}
```

## 7. Errors and Typed Outcomes

Invalid/extra dimension/path/cap=`INVALID_ARGUMENT`; missing report=`NEEDS_INPUT`; missing seed=`NOT_FOUND`; incomplete fingerprint scope=`OUT_OF_COVERAGE`; PBAC/tenant/version=`BLOCKED`; transient index timeout=`FAILED` after one retry.

## 8–15. Flow, Rules, Logic, LLM, Registry, Audit, Retry, Security

Validate → allow-list → PBAC/version → load fixed algorithm config → compute/query normalized fingerprints → remove seed → stable rank/cap → limitations/privacy/audit. Registry: `SimilarSymbolsTool`, `LLM_CALLABLE`, `TECHNICAL_EVIDENCE_READ`, report required, 2s/one retry/`NONE`. Model sees ≤50 candidates and may inspect returned refs; it may not equate score with verified use. Audit shared IDs, config/algorithm/output hashes and budget; deny raw body/source/prompt/secret/AST/absolute path. No direct index/storage access.

## 16–18. Scenario, AC, Tests

For a verified provider adapter, find candidates and pass one ref to evidence query; an empty exhaustive set is `READY`, not absence of providers. AC: deterministic algorithm/config rank, self exclusion, strict schema/PBAC/privacy, explicit limited state/audit.

| ID | Scenario | Level |
|---|---|---|
| TC-01 | reproducible score/tie/self exclusion | unit |
| TC-02 | path/cap/extra field | contract |
| TC-03 | incomplete scope and cross-tenant | integration |
| TC-04 | forbidden content in projection | privacy |
| TC-05 | timeout/retry/audit | worker |

## 19–22. DoD, Files, Questions, Deliverables

Add contracts/registry, fingerprint projection/index/handler/normalizer, PBAC/audit and tests under AO-2 seams. OQ-01: ratify fingerprint weights/version ownership (Architecture, OPEN, blocks yes). Deliver definition/schema, fixed algorithm, audit and tests.

## Source Authority

- `docs/specs/spec-agentic-evidence-orchestration/tool-catalog.md`
- `docs/implementation/tasks/modules/agentic-evidence-tools/shared-tool-contract.md`
