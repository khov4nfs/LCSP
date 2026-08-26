# Persistence Implementation

## Status

AUTHORITATIVE IMPLEMENTATION DOCUMENT — A-TO-Z RUNNABLE MVP

## Purpose

Define PostgreSQL/Prisma ownership, physical model requirements, ChromaDB legal index references, object-storage metadata, transactions, retention, configuration, and recovery. This is a build specification, not implemented schema code.

## Active References

- `docs/specs/domain-model.md`
- `docs/specs/domain-state-machines.md`
- `docs/specs/event-catalog.md`
- `docs/implementation/queue-implementation.md`
- `docs/implementation/scanner-implementation.md`
- `docs/implementation/legal-corpus-ingestion-implementation.md`
- `docs/implementation/chromadb-vectorless-legal-retriever-implementation.md`
- `docs/implementation/llm-gateway-implementation.md`

## Boundaries

- PostgreSQL is authoritative for domain/workflow/evidence/legal/result/audit metadata.
- S3-compatible object storage holds legal source snapshots and generated document artifacts.
- ChromaDB holds the structure-first vectorless legal retrieval index for approved corpus versions.
- Raw repository source, full AST bodies, secrets, raw provider tokens, and full prompts are never persistent records.
- Queue payloads and audit metadata are reference-only/redacted.
- Approved LegalCorpusVersion and historical assessment artifacts are immutable.
- Every assessment-scoped query enforces tenant scope and RBAC server-side.

## Required PostgreSQL Extensions

No PostgreSQL pgvector extension is required for legal retrieval in Phase 5.2L. PostgreSQL remains authoritative for relational metadata, audit, outbox and corpus approval state. ChromaDB owns legal retrieval records and metadata index.

## Model Groups

### Identity and Access

- `User`
- `OAuthIdentity`
- `UserMfaMethod`
- `Session`
- `Organization`
- `OrganizationMembership`
- `Policy`
- `PolicyVersion`
- `AuthorizationDecision`
- scoped Developer task/policy records

Required constraints:

- unique normalized user identity;
- unique OAuth provider+subject;
- no plaintext MFA secret or session token;
- organization membership, subject labels, policy scope and policy version;
- revocation and audit timestamps.
- authorization decisions record actor/service identity, organization, resource, action, policy ID/version, decision, safe context refs and correlation ID.

### Assessment and Repository

- `Assessment`
- `WizardProfile`
- `RepositoryConnection`
- `TrustedScanTrigger`
- `ScanMappingResolution`
- `RepositorySnapshot`
- `RepositoryScanJob`

`RepositoryScanJob` includes:

```text
id, assessmentId, repositorySnapshotId, trustedScanTriggerId, status,
workerRuntime=PYTHON, idempotencyKey,
scannerVersion, scannerToolchainVersion, scannerConfigHash, rulesetVersion,
requestedBy, startedAt, completedAt,
cleanupVerifiedAt, failureCode, failureMessage,
createdAt, updatedAt
```

Constraints:

- idempotency key unique for repository+commit+scanner/toolchain/config/ruleset and trusted trigger policy;
- `COMPLETED` requires `cleanupVerifiedAt` and accepted report;
- failed/completed jobs are not mutated into a new run;
- rerun creates a new job and artifact chain.

### Scanner Evidence

- `SourceFile`
- `CodeGraphNode`
- `CodeGraphEdge`
- `EvidenceReference`
- `TechnicalFinding`
- `TechnicalEvidenceReport`

Persist only path/symbol/line/hash/version/confidence/coverage metadata. Evidence paths live in `TechnicalFinding.metadata.evidencePath`; no separate graph database is required.

`TechnicalEvidenceReport` includes immutable report hash, scanner/ruleset/schema versions, coverage summary, privacy flags, quality status, and scan linkage.

### Intelligence and Reconciliation

- `TechnicalProfile`
- `AIUsageFlow`
- `AIUsageFlowClaim`
- `AIUsageFlowClaimEvidenceReference`
- `StructuredTechnicalAttestation` (`SUPERSEDED_FOR_ACTIVE_MVP`; no active table/migration unless preserving historical data)
- `ReconciliationConflict`
- `VerifiedProfile`

Rules:

- material AIUsageFlow claims use many-to-many evidence references;
- structured attestation is not an active MVP persistence dependency;
- Manager resolution is stored separately and audited;
- open conflict blocks VerifiedProfile/classification;
- versions are immutable snapshots.

### Legal Corpus and Retrieval

- `LegalSource`
- `LegalDocument`
- `LegalCorpusVersion`
- `LegalCorpusItem`
- `LegalDocumentChunk`
- `CorpusApprovalRecord`
- `RetrievalAuditLog`
- `LegalRuleMatch`

#### LegalSource

Required fields:

```text
id, name, authority, baseUrl, sourceTier,
validationStatus, validatedBy, validatedAt,
createdAt, updatedAt
```

Only `VALIDATED` sources are eligible for approved corpus ingestion.

#### LegalDocument

Required fields:

```text
id, sourceId, documentNumber, documentType,
issuingAuthority, title, issueDate,
effectiveStartDate, effectiveEndDate,
status, sourceUrl, snapshotRef, retrievedAt,
contentHash, supersedes, supersededBy, amends,
createdAt, updatedAt
```

SnapshotRef points to immutable S3-compatible storage object metadata. Content hash change creates a new staged document/version; it does not mutate approved corpus history.

#### LegalCorpusVersion

Required fields:

```text
id, version, status(DRAFT|APPROVED|SUPERSEDED),
sourceRefs, indexStatus, indexVersion,
createdAt, approvedAt, supersededAt
```

Approved versions are immutable. Existing assessments retain pinned corpus version even after supersession.

#### LegalCorpusItem

Links one approved/staged document hierarchy unit to a corpus version:

```text
id, corpusVersionId, documentId,
sectionIdentifier, article, clause, point, appendix,
normalizedContent, contentHash, createdAt
```

#### LegalDocumentChunk

```text
id, corpusItemId, chunkIndex,
content, contentHash,
hierarchicalPath,
docId, articleId, clauseId, pointId,
articleNumber, clauseNumber, pointCode,
effectiveFrom, effectiveTo, legalStatus,
sourceChecksum, chunkChecksum,
outgoingRefIds, incomingRefIds,
supersedesChunkId,
chromaCollectionId, chromaRecordId,
createdAt
```

Legal retrieval index records are written to ChromaDB after corpus approval. PostgreSQL stores stable IDs, hierarchy metadata, checksums, cross-reference IDs and ChromaDB record references for reproducibility.

#### CorpusApprovalRecord

```text
id, corpusVersionId, decidedBy,
decision(APPROVED|REJECTED),
scopeDescription, comments, decidedAt, createdAt
```

The actor is an Internal Legal Operator through internal API/CLI for MVP.

#### RetrievalAuditLog

Store only sanitized retrieval metadata:

```text
id, assessmentId, corpusVersionId,
queryHash, normalizedQueryFacets,
filtersApplied, resultCount,
resultRefsAndScores, correlationId, createdAt
```

Do not persist arbitrary raw `queryText`, raw source, full prompt, secrets, or unnecessary customer free text.

#### LegalRuleMatch

Includes assessment, VerifiedProfile, approved corpus version, rule ID, complete citation refs, structured rationale, deterministic confidence, coverage, status, retrieval audit reference, and timestamps.

### Classification, Reporting, and Model Metadata

- `RiskClassification`
- `RiskClassificationLegalRuleMatch`
- `GapAnalysis`
- `GeneratedDocument`
- `ModelRunMetadata`

`ModelRunMetadata` includes:

```text
id, assessmentId, workflowRunId, nodeName,
provider, model, promptVersion,
inputReference, outputHash, status,
inputTokens, outputTokens, estimatedCost,
corpusVersionId, retrievalAuditRefs,
correlationId, createdAt
```

It never stores raw prompts, raw source, credentials, or provider tokens.

`GeneratedDocument` stores metadata/hash/storageRef; binary artifact lives in S3-compatible storage. Readiness-only documents may omit classification/gap links but must be explicitly typed and contain no risk level.

### Messaging and Audit

- `OutboxEvent`
- `AuditEvent`

Outbox fields include event type, exchange, routing key, schema version, reference-only payload, status, attempts, lock, next attempt, published time, correlation/causation, aggregate ref, and redacted error.

AuditEvent is append-oriented and includes actor/action/object/time/outcome, correlation/causation, safe before/after state, version/evidence refs, and redacted metadata.

## Canonical Transaction Boundaries

### API State Change

```text
validate DTO and actor
-> validate state guard
-> transaction:
   write domain row
   write AuditEvent
   write OutboxEvent when async work follows
-> commit
```

### Python Scan Completion

```text
persist staged evidence/report
-> run gates
-> delete and verify workspace
-> transaction:
   mark ScanJob COMPLETED
   record cleanupVerifiedAt
   write AuditEvent
   write event.scan.completed.v1 OutboxEvent
```

Cleanup failure uses a separate terminal transaction marking FAILED and staging `event.scan.failed.v1`. Completed event is forbidden before cleanup verification.

### Corpus Approval

```text
validate Internal Legal Operator
-> verify all source/document/hash/review requirements
-> transaction:
   create CorpusApprovalRecord
   mark corpus APPROVED
   write AuditEvent
   write command.legal-index-build.requested.v1 OutboxEvent
```

Approved corpus content is immutable after commit.

### Document Generation

Artifact upload and metadata registration must avoid orphaned states. Use staged object upload plus transactionally persisted metadata/status; cleanup failed temporary objects through an audited recovery job.

## Migration Order

1. identity/session/organization;
2. assessment/Wizard/developer policy/RBAC scope;
3. repository connection/snapshot/scan job;
4. evidence refs/findings/report/graph;
5. TechnicalProfile/AIUsageFlow/reconciliation/VerifiedProfile;
6. legal source/document/corpus/approval/chunks;
7. ChromaDB legal index references and retrieval audit metadata;
8. retrieval audit/LegalRuleMatch;
9. model metadata/classification/gap/document;
10. outbox/audit indexes and retention jobs.

## Core Indexes and Constraints

- organization/assessment scope on all tenant entities;
- assessment state and owner;
- repository ID + commit SHA;
- scan idempotency key/status;
- report hash/version;
- conflict status;
- VerifiedProfile version;
- corpus status/version and document effective dates;
- source validation status;
- ChromaDB legal index version and chunk record references;
- classification/gap/document status;
- audit correlation/time;
- outbox status/nextAttemptAt/lock;
- unique historical version constraints.

## Retention

| Artifact | MVP Retention | Rule |
|---|---:|---|
| Scanner workspace | delete immediately after success/terminal failure; crash cleanup within 24h | never long-term raw source |
| Source/evidence/graph/report metadata | 12 months | metadata/hash/ref only |
| Profiles/conflicts/classification/gap | 12 months minimum | immutable/versioned |
| Legal source snapshots/corpus versions | retained per legal corpus governance | approved history immutable |
| RetrievalAuditLog | 12 months | sanitized facets/hash/results only |
| ModelRunMetadata | 12 months | no raw input/secret |
| AuditEvent | 12 months minimum | append-oriented/redacted |
| GeneratedDocument metadata/artifact | 12 months or controlled deletion policy | hash/storage ref/versioned |
| OutboxEvent | 30 days after PUBLISHED; 90 days after FAILED | reference-only payload |

## Environment and Secrets

| Group | Required Controls |
|---|---|
| Database/RabbitMQ/S3 | secret references, startup validation, redacted logs |
| OAuth/OIDC/MFA/GitHub App | callback/scope validation, no plaintext secret/token |
| Scanner | workspace root, file/size/time bounds, ruleset version, fixed analyzer executable |
| LLM | provider/model, credential ref, timeout/token/monthly budget |
| Legal corpus | source validation list, active approved corpus version, ChromaDB collection/index version |
| Observability | correlation IDs and redacted failure codes |

A-to-Z acceptance requires real PostgreSQL, RabbitMQ, S3-compatible storage, ChromaDB legal index, and real LLM provider. Dense embedding provider/model is not required for legal retrieval MVP. Mock adapters are component-test/offline-only.

## Recovery Rules

| Failure | Recovery |
|---|---|
| stuck OutboxEvent | lock timeout, retry/backoff, operator replay after cause correction |
| duplicate command | idempotent no-op or resume from persisted safe state |
| failed scan | new ScanJob; preserve failed history |
| cleanup failure | security remediation then new ScanJob; never promote staged report |
| corpus ingestion failure | correct source/normalization and create new staging attempt |
| corpus approval rejection | remain DRAFT/rejected; correct and resubmit; no retrieval |
| legal index failure | rebuild same approved immutable content with recorded new index attempt/version |
| classification/document failure | retry only transient errors; domain guard failures remain blocked until upstream changes |
| artifact upload orphan | audited cleanup/reconciliation job |

## Non-Claims

- This document is not executable Prisma schema or migration code.
- It does not authorize production deployment.
- It does not permit raw source persistence.
- It does not make corpus approval equivalent to legal certification.
- It does not certify implementation readiness.
