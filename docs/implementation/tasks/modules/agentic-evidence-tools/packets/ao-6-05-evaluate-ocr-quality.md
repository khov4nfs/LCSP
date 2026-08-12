---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-6-05-evaluate-ocr-quality
jira_issue: LCSP-208
status: READY_FOR_PLANNING
---
# TASK-AO-6-05 — `evaluate_ocr_quality`

## Objective and tool definition

Run deterministic quality gates over canonical extraction/OCR manifests: page continuity, confidence, numbering, document identity, hierarchy markers and hashes. `SYSTEM_ONLY` read/validation tool; PBAC `LEGAL_CORPUS_VALIDATE`; LLM sees only manifest findings.

## Input

| Parameter | Required | Rule |
|---|---:|---|
| `extractionRef` | yes | immutable extraction or OCR extraction ref |
| `expectedIdentityRef` | yes | catalog identity ref |
| `qualityProfile` | yes | `VI_LEGAL_V1` |

```json
{"type":"object","additionalProperties":false,"properties":{"extractionRef":{"type":"string","pattern":"^(extraction|ocr):[A-Za-z0-9_-]{3,128}$"},"expectedIdentityRef":{"type":"string","pattern":"^catalog-source:[a-z0-9:_-]{3,160}$"},"qualityProfile":{"const":"VI_LEGAL_V1"}},"required":["extractionRef","expectedIdentityRef","qualityProfile"]}
```

## Output and real example

```json
{"status":"READY","toolName":"evaluate_ocr_quality","toolVersion":"1.0.0","configHash":"sha256:quality-v1","correlationId":"66a3c9ca-0ab6-4456-b606-1a87e2cc1a0d","artifactVersions":{"extractionId":"extract_01JQ8"},"provenanceRef":"prov:quality:01","coverageState":"SUFFICIENT","evidenceRefs":["quality-manifest:quality_01"],"limitations":[],"result":{"qualityManifestRef":"quality-manifest:quality_01","decision":"PASS","checked":{"pageContinuity":true,"identity":true,"numbering":true,"hierarchy":true},"minimumConfidence":0.94,"findingRefs":[]}}
```

## Execution, registry, and LLM context

Load pinned manifests → validate immutable hashes → run profile rules → create immutable finding/decision manifest → audit. `OcrQualityValidationTool`, `SYSTEM_ONLY`, `READ`, 10 s timeout, one transient store retry. LLM cannot waive a finding or use unapproved spans.

## Errors, tests, files, and open questions

Low confidence/missing/reordered page gives `OUT_OF_COVERAGE`; identity mismatch `CONFLICT`; absent manifest `NEEDS_INPUT`; validator failure `FAILED`. Test each rule, threshold boundary, fail-closed profile, audit safety. Files: validator/profile, manifest contracts/repository, validation tests. OQ-01: ratify quality thresholds by document class.

## Acceptance criteria

1. All failures have typed finding refs and prevent activation.
2. Quality decision is repeatable for pinned inputs/profile.
3. No OCR/full extracted text appears in result.

## Source authority

`shared-tool-contract.md`; `legal-corpus-source-spec.md`; `tool-catalog.md`.
