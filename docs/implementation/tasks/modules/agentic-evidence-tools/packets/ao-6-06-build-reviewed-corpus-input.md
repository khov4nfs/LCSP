---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-6-06-build-reviewed-corpus-input
jira_issue: LCSP-201
status: DONE
---
# TASK-AO-6-06 — `build_reviewed_corpus_input`

## Objective and tool definition

Build an immutable normalized corpus input from passing extraction/OCR quality artifacts and deterministic correction policy. No human or LLM source approval occurs: admin catalog membership plus automated gates is authority. `SYSTEM_ONLY` mutation, RBAC `LEGAL_CORPUS_BUILD`.

## Input

| Parameter | Required | Rule |
|---|---:|---|
| `extractionRef` | yes | accepted extraction/OCR manifest |
| `qualityManifestRef` | yes | passing immutable quality manifest |
| `correctionProfile` | yes | `DETERMINISTIC_V1` only |

```json
{"type":"object","additionalProperties":false,"properties":{"extractionRef":{"type":"string","pattern":"^(extraction|ocr):[A-Za-z0-9_-]{3,128}$"},"qualityManifestRef":{"type":"string","pattern":"^quality-manifest:[A-Za-z0-9_-]{3,128}$"},"correctionProfile":{"const":"DETERMINISTIC_V1"}},"required":["extractionRef","qualityManifestRef","correctionProfile"]}
```

## Output and real example

```json
{"status":"READY","toolName":"build_reviewed_corpus_input","toolVersion":"1.0.0","configHash":"sha256:normalizer-v1","correlationId":"95f1c036-8889-4e3b-af80-753f23d2a6b2","artifactVersions":{"reviewedInputId":"reviewed_01JQA"},"provenanceRef":"prov:reviewed-input:01","coverageState":"SUFFICIENT","evidenceRefs":["reviewed-input:reviewed_01JQA:sha256:5d2e"],"limitations":[],"result":{"reviewedInputRef":"reviewed-input:reviewed_01JQA","contentSha256":"sha256:5d2e","correctionProfile":"DETERMINISTIC_V1","qualityDecision":"PASS","manualApprovalRequired":false}}
```

## Execution, registry, and LLM context

Verify same snapshot/hash and passing gate → apply declared deterministic normalization only → persist immutable input/transform manifest → audit. `ReviewedCorpusInputBuilder`, `SYSTEM_ONLY`, mutation, 30 s timeout, replay by pinned refs. LLM sees safe ref and decision only; it cannot submit corrections.

## Errors, tests, files, and open questions

Non-passing quality `BLOCKED`; hash mismatch `CONFLICT`; missing input `NEEDS_INPUT`; builder crash `FAILED`. Tests: same input reproducibility, unsupported transformation reject, no manual-approval state, hash binding/privacy. Files: normalizer/correction profile, contracts/repository, integration tests. OQ-01: maintain versioned deterministic correction rule catalog.

## Acceptance criteria

1. Output is immutable, repeatable and traceable to passing quality evidence.
2. Manual source approval is neither requested nor representable.
3. Unsupported correction blocks the candidate.

## Source authority

`shared-tool-contract.md`; `legal-corpus-source-spec.md`; `tool-catalog.md`.
