---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-6-01-get-admin-source-catalog
status: READY_FOR_PLANNING
---
# TASK-AO-6-01 — `get_admin_source_catalog`

## Objective and tool definition

Resolve a legal document only through the Admin-managed official catalog. This is a `SYSTEM_ONLY` read tool owned by the legal-corpus worker; the LLM may receive the returned `catalogSourceRef` but cannot provide or see a URL. It has no mutation and requires PBAC action `LEGAL_CORPUS_CATALOG_READ`.

## Input

| Parameter | Required | Rule |
|---|---:|---|
| `documentIdentity` | yes | `{documentType,documentNumber,issuingAuthority,issueDate}`; trimmed, bounded identifiers |
| `catalogId` | no | stable admin catalog ID; mutually exclusive with identity |

```json
{"type":"object","additionalProperties":false,"properties":{"catalogId":{"type":"string","pattern":"^catalog_[A-Za-z0-9_-]{1,64}$"},"documentIdentity":{"type":"object","additionalProperties":false,"properties":{"documentType":{"enum":["LAW","DECREE","CIRCULAR","DECISION","RESOLUTION"]},"documentNumber":{"type":"string","maxLength":64},"issuingAuthority":{"type":"string","maxLength":160},"issueDate":{"type":"string","format":"date"}},"required":["documentType","documentNumber","issuingAuthority","issueDate"]}},"oneOf":[{"required":["catalogId"]},{"required":["documentIdentity"]}]}
```

## Output and real example

Result is a safe catalog projection: `catalogSourceRef`, `documentIdentity`, `allowedHost`, `pathPolicy`, `sourceHierarchy`, and `catalogVersion`. It never contains arbitrary URLs, credentials, or catalog administration fields.

```json
{"status":"READY","toolName":"get_admin_source_catalog","toolVersion":"1.0.0","configHash":"sha256:catalog-v1","correlationId":"a3f1d25c-6625-4901-a22b-f0b8812f4082","artifactVersions":{"adminCatalogVersion":"catalog_v2026_08"},"provenanceRef":"prov:catalog:01","coverageState":"SUFFICIENT","evidenceRefs":["catalog-source:vbpl:law-13-2023-nd-cp"],"limitations":[],"result":{"catalogSourceRef":"catalog-source:vbpl:law-13-2023-nd-cp","documentIdentity":{"documentType":"DECREE","documentNumber":"13/2023/NĐ-CP","issuingAuthority":"Chính phủ","issueDate":"2023-04-17"},"allowedHost":"vbpl.vn","pathPolicy":"OFFICIAL_DOCUMENT","sourceHierarchy":"PRIMARY","catalogVersion":"catalog_v2026_08"}}
```

## Execution, registry, and LLM context

Strict parse → tenant/PBAC/catalog-version check → exact identity lookup → return allow-listed host/path policy → safe audit. Register `CatalogLookupTool`, `SYSTEM_ONLY`, `READ`, 1 s timeout, one retry only for catalog-store outage. AO-3 can use its safe ref as resolver output; LLM context is the shared envelope only and must never synthesize a fetch URL.

## Errors, tests, files, and open questions

Unknown identity returns `NEEDS_INPUT`; ambiguous identity `CONFLICT`; cross-tenant/PBAC denial `BLOCKED`; store failure `FAILED`. Tests: exact lookup, unknown/ambiguous, URL/extra-field rejection, PBAC, audit redaction. Build contracts in `packages/contracts/src/legal-corpus`, catalog projection/handler in `lcsp-python-workers/src/lcsp_workers/legal_corpus`, and API PBAC/audit adapter in `apps/api/src/modules/legal-corpus`. OQ-01: ratify catalog refresh/cache TTL; it must not allow stale catalog use after revocation.

## Acceptance criteria

1. Only admin-catalog identity resolves; arbitrary endpoint input is impossible.
2. Output pins catalog version and contains fetch policy, provenance, coverage, and evidence refs.
3. Denials and ambiguity fail closed and are auditable.

## Source authority

`shared-tool-contract.md`; `legal-corpus-source-spec.md`; `tool-catalog.md`.
