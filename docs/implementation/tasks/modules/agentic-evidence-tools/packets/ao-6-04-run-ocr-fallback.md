---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-6-04-run-ocr-fallback
status: READY_FOR_PLANNING
---
# TASK-AO-6-04 — `run_ocr_fallback`

## Objective and tool definition

Create page/span-hash OCR output only when canonical extraction proved unavailable or insufficient. `SYSTEM_ONLY` mutation, PBAC `LEGAL_CORPUS_OCR`, idempotent on snapshot + selected pages + profile. It is never a silent alternate parser and LLMs do not receive OCR text.

## Input

| Parameter | Required | Rule |
|---|---:|---|
| `snapshotRef` | yes | immutable official snapshot |
| `fallbackProofRef` | yes | failed/limited extraction provenance ref |
| `pageNumbers` | yes | unique 1–2,000 page numbers, max 200/request |
| `ocrProfile` | yes | `VI_OFFICIAL_V1` |

```json
{"type":"object","additionalProperties":false,"properties":{"snapshotRef":{"type":"string","pattern":"^snapshot:[A-Za-z0-9_-]{3,128}$"},"fallbackProofRef":{"type":"string","pattern":"^prov:extract:[A-Za-z0-9_-]{3,128}$"},"pageNumbers":{"type":"array","items":{"type":"integer","minimum":1,"maximum":2000},"minItems":1,"maxItems":200,"uniqueItems":true},"ocrProfile":{"const":"VI_OFFICIAL_V1"}},"required":["snapshotRef","fallbackProofRef","pageNumbers","ocrProfile"]}
```

## Output and real example

```json
{"status":"READY","toolName":"run_ocr_fallback","toolVersion":"1.0.0","configHash":"sha256:ocr-vi-v1","correlationId":"cc27bc3c-2d1a-430f-9093-fd899372eb08","artifactVersions":{"snapshotId":"snapshot_01JQ7","ocrId":"ocr_01JQ9"},"provenanceRef":"prov:ocr:01","coverageState":"PARTIAL","evidenceRefs":["ocr-page:ocr_01JQ9:3"],"limitations":[{"code":"OCR_REQUIRED","affectedScopeRef":"snapshot:snapshot_01JQ7","reason":"CANONICAL_EXTRACTION_UNAVAILABLE","retryable":false}],"result":{"ocrRef":"ocr:ocr_01JQ9","pages":[{"page":3,"pageImageSha256":"sha256:9be1","spanManifestRef":"ocr-span-manifest:3","meanConfidence":0.97}],"profile":"VI_OFFICIAL_V1"}}
```

## Execution, registry, and LLM context

Validate proof against same snapshot → render bounded selected pages → OCR in order → persist immutable page/span manifests → audit. Register `OcrFallbackTool`, `SYSTEM_ONLY`, mutation, 90 s timeout, no automatic retry after OCR starts (idempotency replay only). LLM sees refs/confidence/limitations, never image/text.

## Errors, tests, files, and open questions

Canonical success or mismatched proof `BLOCKED`; missing page `NEEDS_INPUT`; OCR timeout `FAILED`; page hash mismatch `CONFLICT`. Tests prove fallback gate, subset/page ordering, profile deny, timeout/replay, no image/text leak. Files: OCR worker/profile, manifest repository, contracts/audit tests. OQ-01: approve per-page OCR compute quota.

## Acceptance criteria

1. OCR cannot run without immutable fallback proof.
2. Every OCR page is hash-bound and ordered.
3. Failure remains explicit and candidate corpus inactive.

## Source authority

`shared-tool-contract.md`; `legal-corpus-source-spec.md`; `tool-catalog.md`.
