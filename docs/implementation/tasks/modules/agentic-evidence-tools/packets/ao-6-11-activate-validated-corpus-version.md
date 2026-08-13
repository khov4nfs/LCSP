---
template: agentic-tool-implementation-task
template_version: 2.0.0
task_id: TASK-AO-6-11-activate-validated-corpus-version
jira_issue: LCSP-215
status: DONE
---
# TASK-AO-6-11 — `activate_validated_corpus_version`

## Objective and tool definition

Atomically activate a `DRAFT` immutable corpus candidate once every hash-bound automated validation passes. This is `SYSTEM_ONLY`, never LLM-callable, mutation PBAC `LEGAL_CORPUS_ACTIVATE`; catalog membership removes manual source approval only, not any validation gate.

## Input

| Parameter | Required | Rule |
|---|---:|---|
| `corpusVersionRef` | yes | `DRAFT` immutable candidate |
| `integrityManifestRef` | yes | passing manifest for candidate |
| `retrievalValidationRef` | yes | passing manifest for candidate |
| `idempotencyKey` | yes | UUID; same value replays prior terminal result |

```json
{"type":"object","additionalProperties":false,"properties":{"corpusVersionRef":{"type":"string","pattern":"^corpus-version:[A-Za-z0-9_-]{3,128}$"},"integrityManifestRef":{"type":"string","pattern":"^integrity-manifest:[A-Za-z0-9_-]{3,128}$"},"retrievalValidationRef":{"type":"string","pattern":"^retrieval-validation:[A-Za-z0-9_-]{3,128}$"},"idempotencyKey":{"type":"string","format":"uuid"}},"required":["corpusVersionRef","integrityManifestRef","retrievalValidationRef","idempotencyKey"]}
```

## Output and real example

```json
{"status":"READY","toolName":"activate_validated_corpus_version","toolVersion":"1.0.0","configHash":"sha256:activation-v1","correlationId":"8f3f191d-aadc-4ea4-9dd8-a2fd95a272d5","artifactVersions":{"corpusVersionId":"corpus_01JQD"},"provenanceRef":"prov:activation:01","coverageState":"SUFFICIENT","evidenceRefs":["corpus-approval:corpus_01JQD","outbox:corpus-activated:01"],"limitations":[],"result":{"activeCorpusVersionRef":"corpus-version:corpus_01JQD","lifecycleStatus":"APPROVED","activationRecordRef":"corpus-approval:corpus_01JQD","outboxEventRef":"outbox:corpus-activated:01","systemActor":"legal-corpus-activation-service","manualApprovalRequired":false}}
```

## Execution, registry, and LLM context

Reserve/replay idempotency → transactionally lock DRAFT candidate → verify catalog membership, all candidate-bound passing manifests/index checksum → mark `APPROVED`/supersede per policy → write audit and outbox in same transaction → commit. `CorpusActivationTool`, `SYSTEM_ONLY`, 10 s timeout; retry only transaction serialization failure. LLM receives activation event only, cannot request activation.

## Errors, tests, files, and open questions

Missing/failing/mismatched gate `BLOCKED`; status transition conflict `CONFLICT`; duplicate key replays `READY`; transaction/outbox failure `FAILED` with no partial approval. Test atomic rollback, outbox/audit, competing activation, idempotent replay, no manual approval field. Files: API transaction service/outbox, corpus repository/contracts, integration tests. OQ-01: define supersession policy for simultaneous candidates.

## Acceptance criteria

1. `DRAFT -> APPROVED` occurs only in one atomic validated transaction.
2. Every approved version has system audit/outbox evidence; no signature workflow exists.
3. Any failure leaves candidate inactive.

## Source authority

`shared-tool-contract.md`; `legal-corpus-source-spec.md`; `tool-catalog.md`.
