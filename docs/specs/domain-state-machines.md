# LCSP Domain State Machines

## Purpose

Canonical state transitions for the A-to-Z runnable MVP. Physical enums remain owned by `persistence-implementation.md`.

## Common Rules

- Every transition requires a guard and material state changes write AuditEvent.
- Async work uses names from `event-catalog.md`.
- Completed and failed artifacts are immutable history.
- Classification requires direct EngineeringRule evaluation with legal-rule provenance and evidence refs.
- Final document requires classification, GapAnalysis, citations, and no unresolved conflict.
- Manager completion never depends on external collaborator participation.
- RBAC is the authorization source of truth for all user and service transitions.
- Structured attestation is `SUPERSEDED_FOR_ACTIVE_MVP` and has no active state machine.

## Assessment

```text
CREATED
-> WIZARD_PROFILE_READY (optional; may be reached any time before or after REPOSITORY_CONNECTED)
-> REPOSITORY_CONNECTED
-> TRUSTED_SCAN_TRIGGERED
-> PENDING_MAPPING or BLOCKED_MAPPING or WAITING_FOR_CONTEXT or SNAPSHOT_CREATED
-> SNAPSHOT_CREATED
-> SCAN_REQUESTED
-> SCAN_RUNNING
-> SCAN_COMPLETED
-> TECHNICAL_PROFILE_READY
-> AI_USAGE_FLOW_READY
-> RECONCILIATION_REQUIRED or ENGINEERING_RULE_ASSESSMENT_REQUESTED
-> CLASSIFICATION_READY or CLASSIFICATION_BLOCKED
-> GAP_ANALYSIS_READY or GAP_ANALYSIS_BLOCKED
-> DOCUMENT_GENERATED or DOCUMENT_BLOCKED
```

| Current                                | Trigger                                     | Guard                                                                 | Next                                                                               |
| -------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| none                                   | assessment created                          | Manager authorized                                                    | CREATED                                                                            |
| CREATED                                | Wizard saved                                | required fields valid                                                 | WIZARD_PROFILE_READY                                                               |
| CREATED                                | repository connected (Wizard not yet saved) | GitHub App scope valid                                                | REPOSITORY_CONNECTED                                                               |
| WIZARD_PROFILE_READY                   | repository connected                        | GitHub App scope valid                                                | REPOSITORY_CONNECTED                                                               |
| REPOSITORY_CONNECTED                   | Wizard saved                                | required fields valid                                                 | REPOSITORY_CONNECTED (WizardProfile attached; state unchanged, only linkage added) |
| REPOSITORY_CONNECTED                   | trusted trigger received                    | verified source and RBAC allow                                        | TRUSTED_SCAN_TRIGGERED                                                             |
| TRUSTED_SCAN_TRIGGERED                 | mapping pending                             | required repository/account/assessment mapping missing                | PENDING_MAPPING                                                                    |
| TRUSTED_SCAN_TRIGGERED                 | mapping blocked                             | ambiguous mapping or unsafe context                                   | BLOCKED_MAPPING                                                                    |
| TRUSTED_SCAN_TRIGGERED                 | waiting                                     | out-of-order event or incomplete context can safely wait              | WAITING_FOR_CONTEXT                                                                |
| TRUSTED_SCAN_TRIGGERED                 | snapshot created                            | complete tenant/repository/assessment/branch/commit context exists    | SNAPSHOT_CREATED                                                                   |
| PENDING_MAPPING or WAITING_FOR_CONTEXT | context completed                           | mapping is unique and RBAC allows                                     | SNAPSHOT_CREATED                                                                   |
| BLOCKED_MAPPING                        | Manager/system correction                   | mapping is resolved and audited                                       | SNAPSHOT_CREATED                                                                   |
| SNAPSHOT_CREATED                       | scan requested                              | idempotent job/outbox exists                                          | SCAN_REQUESTED                                                                     |
| SCAN_REQUESTED                         | scan started                                | Python Worker lock acquired                                           | SCAN_RUNNING                                                                       |
| SCAN_RUNNING                           | scan completed event                        | quality-valid report and cleanup verification                         | SCAN_COMPLETED                                                                     |
| SCAN_COMPLETED                         | technical-profile completed                 | profile persisted                                                     | TECHNICAL_PROFILE_READY                                                            |
| TECHNICAL_PROFILE_READY                | AIUsageFlow completed                       | flow persisted                                                        | AI_USAGE_FLOW_READY                                                                |
| AI_USAGE_FLOW_READY                    | conflict detected                           | material conflict exists (only possible when WizardProfile is linked) | RECONCILIATION_REQUIRED                                                            |
| AI_USAGE_FLOW_READY                    | EngineeringRule assessment requested        | no material conflict, or no WizardProfile linked                      | ENGINEERING_RULE_ASSESSMENT_REQUESTED                                              |
| RECONCILIATION_REQUIRED                | EngineeringRule assessment requested        | Manager resolved all conflicts                                        | ENGINEERING_RULE_ASSESSMENT_REQUESTED                                              |
| ENGINEERING_RULE_ASSESSMENT_REQUESTED  | classification completed                    | direct result persisted with provenance                               | CLASSIFICATION_READY                                                               |
| ENGINEERING_RULE_ASSESSMENT_REQUESTED  | classification blocked                      | guard failed                                                          | CLASSIFICATION_BLOCKED                                                             |
| CLASSIFICATION_READY                   | gap completed                               | GapAnalysis persisted                                                 | GAP_ANALYSIS_READY                                                                 |
| CLASSIFICATION_READY                   | gap blocked or failed                       | gap unavailable                                                       | GAP_ANALYSIS_BLOCKED                                                               |
| GAP_ANALYSIS_READY                     | document generated                          | artifact metadata persisted                                           | DOCUMENT_GENERATED                                                                 |
| eligible blocked state                 | document blocked                            | output guard failed                                                   | DOCUMENT_BLOCKED                                                                   |

## RepositoryScanJob

States: `REQUESTED`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELED`.

- Request creates REQUESTED only when snapshot and unique idempotency key exist.
- Python Worker consumption moves REQUESTED to RUNNING.
- COMPLETED requires accepted report and verified workspace cleanup.
- Any terminal scan failure moves REQUESTED/RUNNING to FAILED.
- Rerun creates a new job; COMPLETED or FAILED never returns to RUNNING.

## TrustedScanTrigger and ScanMappingResolution

Trigger states: `RECEIVED`, `CONTEXT_VALIDATING`, `READY_TO_SNAPSHOT`, `PENDING_MAPPING`, `BLOCKED_MAPPING`, `WAITING_FOR_CONTEXT`, `REJECTED`.

```text
RECEIVED
-> CONTEXT_VALIDATING
-> READY_TO_SNAPSHOT
or PENDING_MAPPING
or BLOCKED_MAPPING
or WAITING_FOR_CONTEXT
or REJECTED
```

- Invalid signature or untrusted source moves to REJECTED and creates no scan.
- RBAC denial moves to REJECTED and is audited.
- Missing mapping moves to PENDING_MAPPING or WAITING_FOR_CONTEXT.
- Ambiguous mapping moves to BLOCKED_MAPPING.
- READY_TO_SNAPSHOT may create immutable RepositorySnapshot and RepositoryScanJob.
- Duplicate delivery is idempotent and must not duplicate artifacts.
- Idempotency key, retry/DLQ and replay behavior are governed by `docs/implementation/decisions/trusted-scan-trigger-retry-dlq-replay-decision.md`.

## TechnicalEvidenceReport

```text
DRAFT -> SCHEMA_VALID -> QUALITY_VALID
                    -> QUALITY_INSUFFICIENT
DRAFT or SCHEMA_VALID -> FAILED
```

Only QUALITY_VALID linked to a COMPLETED ScanJob with verified cleanup is downstream eligible.

## TechnicalProfile

Derived states: `NOT_CREATED`, `READY`, `BLOCKED`, `STALE`.

Accepted report creates READY. Invalid or insufficient evidence creates BLOCKED. New accepted evidence leaves the prior immutable profile projected as STALE.

## AIUsageFlow

States: `DRAFT`, `READY`, `UNCLEAR`, `CONFLICTED`, `BLOCKED`.

- READY requires evidence refs on material claims and no critical unknown or conflict.
- UNCLEAR preserves unsupported critical facts.
- CONFLICTED records declaration/evidence mismatch.
- BLOCKED records failed required input or gate.
- Provider-only evidence cannot create READY confirmed usage.

## ReconciliationConflict and VerifiedProfile

Conflict states: `CONFLICT_OPEN`, `RESOLVED`, `VERIFIED`.

```text
CONFLICT_OPEN
-> Manager resolution with rationale
-> RESOLVED
-> reconciliation confirms
-> VERIFIED
```

VerifiedProfile states: `NOT_CREATED`, `READY`, `STALE`. Open conflict prevents creation. New upstream evidence leaves the prior immutable version STALE.

Structured Developer attestation is `SUPERSEDED_FOR_ACTIVE_MVP` and cannot transition Conflict, VerifiedProfile, or Classification.

## Retired Developer Task and Removed Attestation

Developer task states are historical only: `INVITED`, `ACTIVE`, `REVOKED`, `EXPIRED`, `COMPLETED`.

Attestation states are historical only: `SUBMITTED`, `ACCEPTED_AS_SUPPLEMENTAL`, `REJECTED`, `WITHDRAWN`.

`FR-010`, `FR-011`, `FR-047`, `FR-045/FR-046` structured attestation and `FR-052` delegated free-form clarification have no active MVP state machine.

## Legal Source Ingestion

States: `REQUESTED`, `FETCHING`, `SNAPSHOTTED`, `NORMALIZED`, `STAGED`, `FAILED`.

```text
validated source
-> command.legal-source.ingest.requested.v1
-> FETCHING
-> SNAPSHOTTED
-> NORMALIZED
-> STAGED in a DRAFT corpus
```

Validation, redirect, snapshot, identity, or normalization failure produces FAILED and no retrievable corpus item.

## LegalCorpusVersion

States: `DRAFT`, `APPROVED`, `SUPERSEDED`.

- DRAFT becomes APPROVED only after Internal Legal Operator review.
- APPROVED content is immutable.
- A newer approved version may mark an older version SUPERSEDED.
- Existing assessments retain their pinned version.
- Rejected review remains unavailable and is recorded separately.

## Corpus Index Build

States: `NOT_REQUESTED`, `REQUESTED`, `RUNNING`, `READY`, `FAILED`.

```text
LegalCorpusVersion APPROVED
-> command.legal-index-build.requested.v1
-> REQUESTED -> RUNNING
-> event.legal-index-build.completed.v1 -> READY
or event.legal-index-build.failed.v1 -> FAILED
```

Only READY ChromaDB legal indexes are available to vectorless legal retrieval.

## Legal Matching

Status: `SUPERSEDED_FOR_ACTIVE_MVP`.

The retired legal matching state machine is not an active gate for new assessment execution. Direct EngineeringRule assessment owns legal-rule provenance and citation-backed evaluation.

## RiskClassification

States: `REQUESTED`, `RUNNING`, `COMPLETED`, `BLOCKED`, `FAILED`.

COMPLETED requires direct EngineeringRule evaluations, citation basis, evidence refs, and valid guarded model output where used. Missing prerequisites, evidence-less claims, or unsupported conclusion yields BLOCKED.

## GapAnalysis

States: `REQUESTED`, `RUNNING`, `COMPLETED`, `BLOCKED`, `FAILED`.

COMPLETED requires usable classification and legal basis. BLOCKED or FAILED prevents final document generation.

## GeneratedDocument

States: `REQUESTED`, `RUNNING`, `GENERATED`, `BLOCKED`, `FAILED`.

Final report requires classification, GapAnalysis, citations, and no conflict. Readiness-only output may exist earlier without a risk level. Artifact publication requires storage reference, hash, and output guard approval.

## Audit Export

States: `REQUESTED`, `GENERATED`, `FAILED`.

Export contains redacted event and version references only.

```text
DOMAIN_STATE_MACHINES_ALIGNED
LEGAL_CORPUS_AND_INDEX_LIFECYCLES_INCLUDED
STRUCTURED_ATTESTATION_NON_UNLOCKING
STRUCTURED_ATTESTATION_SUPERSEDED_FOR_ACTIVE_MVP
TRUSTED_SCAN_TRIGGER_STATE_MACHINE_ADDED
PYTHON_SCANNER_COMPLETION_GATE_ALIGNED
STATE_TRANSITION_AUTHORITY_EXTENDED_IN_IMPLEMENTATION_READINESS
```
