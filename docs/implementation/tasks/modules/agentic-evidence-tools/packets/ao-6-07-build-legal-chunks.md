---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-6-07-build-legal-chunks
jira_issue: LCSP-209
status: READY_FOR_PLANNING
---
# TASK-AO-6-07 — `build_legal_chunks`

## Objective and tool definition

Create versioned Article/Clause/Point chunks with stable hierarchical IDs, locators, citation, parent and one-hop cross-reference metadata. Clause is the base unit; it must not split inside a sentence merely for token size. `SYSTEM_ONLY` mutation, PBAC `LEGAL_CORPUS_BUILD`.

## Input

| Parameter | Required | Rule |
|---|---:|---|
| `reviewedInputRef` | yes | immutable reviewed input |
| `documentIdentityRef` | yes | catalog-resolved identity |
| `chunkSchemaVersion` | yes | `LEGAL_CHUNK_V1` |

```json
{"type":"object","additionalProperties":false,"properties":{"reviewedInputRef":{"type":"string","pattern":"^reviewed-input:[A-Za-z0-9_-]{3,128}$"},"documentIdentityRef":{"type":"string","pattern":"^catalog-source:[a-z0-9:_-]{3,160}$"},"chunkSchemaVersion":{"const":"LEGAL_CHUNK_V1"}},"required":["reviewedInputRef","documentIdentityRef","chunkSchemaVersion"]}
```

## Output and real example

```json
{"status":"READY","toolName":"build_legal_chunks","toolVersion":"1.0.0","configHash":"sha256:chunk-v1","correlationId":"4e9a41d7-a5b3-4dc7-9846-b4a4180367c9","artifactVersions":{"chunkSetId":"chunks_01JQB"},"provenanceRef":"prov:chunks:01","coverageState":"SUFFICIENT","evidenceRefs":["legal-chunk:DECREE-13-2023-ND-CP:art-1:cl-1"],"limitations":[],"result":{"chunkSetRef":"chunk-set:chunks_01JQB","chunkCount":126,"chunkManifestSha256":"sha256:2dd0","schemaVersion":"LEGAL_CHUNK_V1","sample":{"chunkId":"DECREE-13-2023-ND-CP:art-1:cl-1","locator":"art-1::cl-1","parentChunkId":"DECREE-13-2023-ND-CP:art-1","legalStatus":"ACTIVE"}}}
```

## Execution, registry, and LLM context

Parse normalized hierarchy → assign stable IDs/locators → preserve clause text boundaries → extract xrefs and repeal mappings → hash/persist manifest → audit. `LegalChunkBuilder`, `SYSTEM_ONLY`, mutation, 45 s timeout, idempotent by reviewed input/schema. LLM sees IDs/metadata and later bounded retrieval results, not raw corpus content.

## Errors, tests, files, and open questions

Missing parent/duplicate locator `CONFLICT`; unresolved required repeal target `BLOCKED`; malformed hierarchy `NEEDS_INPUT`; crash `FAILED`. Test stable rerun IDs, point parent context, no intra-clause split, xref/repeal mapping, privacy. Files: chunker/models/repository, schema contracts, fixtures. OQ-01: define treatment of annex/table locators.

## Acceptance criteria

1. Every chunk has stable ID, hierarchy, locator/hash and legal-status metadata.
2. Relationship failures are explicit and block downstream activation.
3. Output is version-pinned and deterministic.

## Source authority

`shared-tool-contract.md`; `legal-corpus-source-spec.md`; `tool-catalog.md`.
