---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-6-09-build-legal-retrieval-index
status: READY_FOR_PLANNING
---
# TASK-AO-6-09 — `build_legal_retrieval_index`

## Objective and tool definition

Build a version-scoped, structure-first ChromaDB index from a validated chunk set. It is `SYSTEM_ONLY`, idempotent mutation with PBAC `LEGAL_CORPUS_INDEX_BUILD`; no dense embeddings or cross-version collection reuse.

## Input

| Parameter | Required | Rule |
|---|---:|---|
| `chunkSetRef` | yes | immutable chunk set |
| `integrityManifestRef` | yes | passing integrity decision |
| `indexProfile` | yes | `CHROMA_STRUCTURE_V1` |

```json
{"type":"object","additionalProperties":false,"properties":{"chunkSetRef":{"type":"string","pattern":"^chunk-set:[A-Za-z0-9_-]{3,128}$"},"integrityManifestRef":{"type":"string","pattern":"^integrity-manifest:[A-Za-z0-9_-]{3,128}$"},"indexProfile":{"const":"CHROMA_STRUCTURE_V1"}},"required":["chunkSetRef","integrityManifestRef","indexProfile"]}
```

## Output and real example

```json
{"status":"READY","toolName":"build_legal_retrieval_index","toolVersion":"1.0.0","configHash":"sha256:chroma-structure-v1","correlationId":"8d06f9c3-96c7-4f20-aa65-c73bc4b63bfa","artifactVersions":{"chunkSetId":"chunks_01JQB","indexId":"index_01JQC"},"provenanceRef":"prov:index-build:01","coverageState":"SUFFICIENT","evidenceRefs":["legal-index:index_01JQC:sha256:fd5a"],"limitations":[],"result":{"indexRef":"legal-index:index_01JQC","collectionName":"legal_chunks_chunks_01JQB","indexChecksum":"sha256:fd5a","indexedChunkCount":126,"profile":"CHROMA_STRUCTURE_V1"}}
```

## Execution, registry, and LLM context

Verify passing integrity for same chunks → create isolated candidate collection → write deterministic metadata/index → checksum/count verify → persist immutable index ref → audit. `LegalRetrievalIndexBuilder`, `SYSTEM_ONLY`, mutation, 60 s timeout, replay idempotency key. LLM has no index endpoint and only later receives validated retrieval projections.

## Errors, tests, files, and open questions

Failing/mismatched integrity `BLOCKED`; partial write `FAILED` with cleanup/quarantine; checksum mismatch `CONFLICT`. Test rerun idempotence, collection isolation, partial rollback, no dense-vector profile, safe audit. Files: Chroma indexer/repository, profile contracts, integration fixtures. OQ-01: approve collection retention/quarantine schedule.

## Acceptance criteria

1. Index is isolated, checksummed, version-pinned and reproducible.
2. Partial or invalid indexes are never marked usable.
3. Only passing integrity manifests may enter indexing.

## Source authority

`shared-tool-contract.md`; `legal-corpus-source-spec.md`; `tool-catalog.md`.
