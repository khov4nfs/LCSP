---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-6-03-extract-official-text
jira_issue: LCSP-201
status: DONE
---
# TASK-AO-6-03 — `extract_official_text`

## Objective and tool definition

Deterministically extract normalized text, page/span hashes, identity/effect-status candidates from an immutable HTML/DOCX snapshot. Worker `SYSTEM_ONLY` mutation, RBAC `LEGAL_CORPUS_EXTRACT`; canonical extraction is preferred and no full document is exposed to LLMs.

## Input

| Parameter | Required | Rule |
|---|---:|---|
| `snapshotRef` | yes | immutable snapshot ref |
| `extractorProfile` | yes | `HTML_OFFICIAL_V1` or `DOCX_OFFICIAL_V1` |
| `maxPages` | yes | 1–2,000; server cap wins |

```json
{"type":"object","additionalProperties":false,"properties":{"snapshotRef":{"type":"string","pattern":"^snapshot:[A-Za-z0-9_-]{3,128}$"},"extractorProfile":{"enum":["HTML_OFFICIAL_V1","DOCX_OFFICIAL_V1"]},"maxPages":{"type":"integer","minimum":1,"maximum":2000}},"required":["snapshotRef","extractorProfile","maxPages"]}
```

## Output and real example

```json
{"status":"READY","toolName":"extract_official_text","toolVersion":"1.0.0","configHash":"sha256:html-extractor-v1","correlationId":"a8de3334-172d-4187-a006-205ceadfcd8a","artifactVersions":{"snapshotId":"snapshot_01JQ7","extractionId":"extract_01JQ8"},"provenanceRef":"prov:extract:01","coverageState":"SUFFICIENT","evidenceRefs":["span:extract_01JQ8:p1:s01"],"limitations":[],"result":{"extractionRef":"extraction:extract_01JQ8","format":"HTML","pageCount":12,"spanCount":94,"identityCandidate":{"documentNumber":"13/2023/NĐ-CP","sourceEffectStatus":"CON_HIEU_LUC"},"spanManifestSha256":"sha256:41aa","canonicalExtractionAvailable":true}}
```

## Execution, registry, and LLM context

Verify snapshot/type → select profile → sanitize/normalize markup → emit immutable page/span records with locator and hash → extract identity/date/effect candidates → audit. `OfficialTextExtractionTool`, `SYSTEM_ONLY`, idempotent mutation, 30 s timeout, one transient retry. LLM gets only bounded validated span references after downstream quality approval.

## Errors, tests, files, and open questions

Unsupported/malformed type `BLOCKED`; missing identity `NEEDS_INPUT`; hash or identity conflict `CONFLICT`; parser crash `FAILED`. Test HTML/DOCX fixtures, script/style removal, locator/hash stability, malformed file, no raw payload leak. Files: extractor profiles, extraction manifest models/repository, contract and privacy tests. OQ-01: approve extraction profile versioning/deprecation policy.

## Acceptance criteria

1. HTML/DOCX extraction is deterministic and hash/locator traceable.
2. Extraction creates a limitation rather than silently invoking OCR.
3. Result contains no unbounded text or binary content.

## Source authority

`shared-tool-contract.md`; `legal-corpus-source-spec.md`; `tool-catalog.md`.
