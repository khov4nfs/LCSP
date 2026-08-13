---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-6-08-validate-chunk-integrity
jira_issue: LCSP-201
status: DONE
---
# TASK-AO-6-08 — `validate_chunk_integrity`

## Objective and tool definition

Fail-closed deterministic gate for chunk hashes, hierarchy, locators, xrefs, duplicates, effect status and locator-level repeal consistency. `SYSTEM_ONLY` validation read; PBAC `LEGAL_CORPUS_VALIDATE`; a passing manifest is required before indexing/activation.

## Input

| Parameter | Required | Rule |
|---|---:|---|
| `chunkSetRef` | yes | immutable candidate chunk set |
| `relationshipManifestRef` | yes | pinned relationship/repeal manifest |
| `validationProfile` | yes | `LEGAL_INTEGRITY_V1` |

```json
{"type":"object","additionalProperties":false,"properties":{"chunkSetRef":{"type":"string","pattern":"^chunk-set:[A-Za-z0-9_-]{3,128}$"},"relationshipManifestRef":{"type":"string","pattern":"^relationship-manifest:[A-Za-z0-9_-]{3,128}$"},"validationProfile":{"const":"LEGAL_INTEGRITY_V1"}},"required":["chunkSetRef","relationshipManifestRef","validationProfile"]}
```

## Output and real example

```json
{"status":"READY","toolName":"validate_chunk_integrity","toolVersion":"1.0.0","configHash":"sha256:integrity-v1","correlationId":"f8fb7a52-69fb-4c4e-b3b9-0a7a419af265","artifactVersions":{"chunkSetId":"chunks_01JQB","integrityManifestId":"integrity_01"},"provenanceRef":"prov:integrity:01","coverageState":"SUFFICIENT","evidenceRefs":["integrity-manifest:integrity_01"],"limitations":[],"result":{"validationManifestRef":"integrity-manifest:integrity_01","decision":"PASS","checkedRules":["HASHES","HIERARCHY","LOCATORS","XREFS","EFFECT_STATUS","REPEAL_MAPPING"],"findingRefs":[]}}
```

## Execution, registry, and LLM context

Load pinned manifests → recompute/verifies hashes and graph invariants → persist decision/finding manifest → audit. `ChunkIntegrityValidator`, `SYSTEM_ONLY`, `READ`, 20 s timeout, one transient read retry. LLM can cite manifest decision only and cannot suppress findings.

## Errors, tests, files, and open questions

Any invariant breach returns `CONFLICT` with safe finding refs; unavailable relation input `NEEDS_INPUT`; effect conflict `BLOCKED`; worker failure `FAILED`. Test duplicate IDs, orphan parent, bad locator/hash, missing xref, expired/repeal disagreement. Files: integrity validator, manifest contract/repository, fixtures. OQ-01: ratify invariant severity mapping.

## Acceptance criteria

1. Each integrity rule is hash-bound and independently testable.
2. Any failed invariant prevents index validation and activation.
3. Findings expose IDs/locators only, never chunk bodies.

## Source authority

`shared-tool-contract.md`; `legal-corpus-source-spec.md`; `tool-catalog.md`.
