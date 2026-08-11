---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-6-02-fetch-official-source-snapshot
status: READY_FOR_PLANNING
---
# TASK-AO-6-02 — `fetch_official_source_snapshot`

## Objective and tool definition

Fetch one catalog-authorized official document and persist an immutable, hash-addressed snapshot. `SYSTEM_ONLY`, worker-owned mutation, PBAC `LEGAL_CORPUS_FETCH`, idempotent by catalog ref + expected identity + catalog version; no LLM sees bytes or final URL.

## Input

| Parameter | Required | Rule |
|---|---:|---|
| `catalogSourceRef` | yes | result from `get_admin_source_catalog` |
| `expectedIdentity` | yes | exact normalized catalog identity |
| `maxBytes` | yes | 1–25,000,000; server cap wins |

```json
{"type":"object","additionalProperties":false,"properties":{"catalogSourceRef":{"type":"string","pattern":"^catalog-source:[a-z0-9:_-]{3,160}$"},"expectedIdentity":{"type":"object","additionalProperties":false,"properties":{"documentNumber":{"type":"string","maxLength":64},"issueDate":{"type":"string","format":"date"}},"required":["documentNumber","issueDate"]},"maxBytes":{"type":"integer","minimum":1,"maximum":25000000}},"required":["catalogSourceRef","expectedIdentity","maxBytes"]}
```

## Output and real example

```json
{"status":"READY","toolName":"fetch_official_source_snapshot","toolVersion":"1.0.0","configHash":"sha256:fetch-v1","correlationId":"9ed4a349-da55-4e38-96ca-7a2e1a59bb62","artifactVersions":{"adminCatalogVersion":"catalog_v2026_08","snapshotId":"snapshot_01JQ7"},"provenanceRef":"prov:fetch:01","coverageState":"SUFFICIENT","evidenceRefs":["snapshot:snapshot_01JQ7:sha256:5a9c"],"limitations":[],"result":{"snapshotRef":"snapshot:snapshot_01JQ7","contentSha256":"sha256:5a9cf3e1","contentType":"text/html","byteLength":184220,"retrievedAt":"2026-08-11T08:00:00Z","documentIdentityVerified":true}}
```

## Execution, registry, and LLM context

Resolve catalog policy → HTTPS fetch → revalidate host/DNS/IP on every redirect → enforce redirect/type/byte/time budgets → immutable object write → SHA-256/identity metadata → audit. Register `OfficialSnapshotFetchTool`, `SYSTEM_ONLY`, `MUTATION`, timeout 15 s, retry once only for network transient, idempotency key mandatory. LLM receives only snapshot ref/hash/type, never content or URL.

## Errors, tests, files, and open questions

Private IP/host drift/redirect/type/size/hash mismatch returns `BLOCKED`; timeout/source unavailable `FAILED` with safe limitation; identity mismatch `CONFLICT`. Tests cover DNS rebinding, redirect escape, HTML/DOCX accept, oversized binary reject, duplicate replay, immutable write. Files: contracts, `legal_corpus/fetcher.py`, snapshot repository, API audit/outbox tests. OQ-01: approve official content-type allow-list.

## Acceptance criteria

1. Every fetched object is immutable and hash-bound to a catalog policy.
2. SSRF and redirect escape are denied before persistence.
3. No raw document reaches persistence projections or LLM context.

## Source authority

`shared-tool-contract.md`; `legal-corpus-source-spec.md`; `tool-catalog.md`.
