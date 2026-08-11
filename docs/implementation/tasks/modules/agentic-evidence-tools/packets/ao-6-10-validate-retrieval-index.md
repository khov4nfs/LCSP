---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-6-10-validate-retrieval-index
status: READY_FOR_PLANNING
---
# TASK-AO-6-10 — `validate_retrieval_index`

## Objective and tool definition

Validate that a candidate index returns exact stable chunk IDs plus required parent and one-hop cross-reference context while respecting effect-status filters. `SYSTEM_ONLY` validation read, PBAC `LEGAL_CORPUS_VALIDATE`; no LLM calls the candidate index directly.

## Input

| Parameter | Required | Rule |
|---|---:|---|
| `indexRef` | yes | candidate immutable index |
| `chunkSetRef` | yes | matching source chunks |
| `probeSetVersion` | yes | approved `LEGAL_RETRIEVAL_PROBES_V1` |

```json
{"type":"object","additionalProperties":false,"properties":{"indexRef":{"type":"string","pattern":"^legal-index:[A-Za-z0-9_-]{3,128}$"},"chunkSetRef":{"type":"string","pattern":"^chunk-set:[A-Za-z0-9_-]{3,128}$"},"probeSetVersion":{"const":"LEGAL_RETRIEVAL_PROBES_V1"}},"required":["indexRef","chunkSetRef","probeSetVersion"]}
```

## Output and real example

```json
{"status":"READY","toolName":"validate_retrieval_index","toolVersion":"1.0.0","configHash":"sha256:retrieval-validation-v1","correlationId":"ad8359ec-6abe-4e95-a4bd-2c79db6b9709","artifactVersions":{"indexId":"index_01JQC","retrievalValidationId":"rv_01"},"provenanceRef":"prov:index-validate:01","coverageState":"SUFFICIENT","evidenceRefs":["retrieval-validation:rv_01"],"limitations":[],"result":{"validationManifestRef":"retrieval-validation:rv_01","decision":"PASS","probeSummary":{"exactId":18,"parentContext":18,"xrefContext":7,"effectFilter":9},"findingRefs":[]}}
```

## Execution, registry, and LLM context

Verify index/chunk binding → execute immutable approved probes → compare expected IDs/context/status filters → write validation manifest → audit. `RetrievalIndexValidator`, `SYSTEM_ONLY`, `READ`, 30 s timeout, one transient backend retry. The LLM receives only PASS/FAIL and evidence refs.

## Errors, tests, files, and open questions

Missing parent/xref or repealed leakage is `CONFLICT`; wrong index/chunk binding `BLOCKED`; missing probes `NEEDS_INPUT`; backend failure `FAILED`. Test exact ID, parent, one hop xref, future effective date, suspended/expired exclusion, wrong collection. Files: probe harness, manifest contracts/repository, integration tests. OQ-01: steward the approved deterministic probe corpus.

## Acceptance criteria

1. Required context roles and legal-status filters are proven before activation.
2. Failed probe manifest prevents activation.
3. Test output does not expose legal body content.

## Source authority

`shared-tool-contract.md`; `legal-corpus-source-spec.md`; `tool-catalog.md`.
