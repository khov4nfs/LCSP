# LCSP Event Catalog

## Purpose

Canonical command and event names for the A-to-Z runnable MVP.

## Rules

- Commands use `command.<domain>.<action>.v1` on `lcsp.commands.v1`.
- Events use `event.<domain>.<fact>.v1` on `lcsp.events.v1`.
- Payloads contain IDs, versions, statuses, hashes, and metadata references only.
- Every message includes message ID, schema version, correlation ID, causation ID, aggregate reference, timestamp, and idempotency key.
- Exhausted messages route to the matching DLQ.
- PBAC decisions are audited with actor/service identity, organization, resource, action, policy ID/version, decision, safe context refs and correlation ID.
- Structured attestation events are `SUPERSEDED_FOR_ACTIVE_MVP` and must not appear in active command/event choreography.

## Commands and Queues

| Command | Queue | Producer | Consumer |
|---|---|---|---|
| `command.scan-trigger.resolve-context.v1` | `lcsp.scan-trigger-worker.v1` | Backend API / webhook handler / scheduler outbox | Python Scan Trigger Worker |
| `command.scan.requested.v1` | `lcsp.scan-worker.v1` | Backend API outbox | Python Scanner Worker |
| `command.technical-profile.requested.v1` | `lcsp.technical-profile-worker.v1` | scan projection | Python Technical Profile Worker |
| `command.ai-usage-flow.requested.v1` | `lcsp.ai-usage-flow-worker.v1` | profile projection | Python AI Usage Flow Worker |
| `command.legal-source.ingest.requested.v1` | `lcsp.legal-source-ingest.v1` | Internal Legal Operations API | Python Legal Ingestion Worker |
| `command.legal-source.vbpl-effected-chunk-set.requested.v1` | `lcsp.legal-source-vbpl-effected-chunk-set.v1` | Internal Legal Operations API / corpus preparation outbox | Python VBPL Effected Chunk-Set Worker |
| `command.legal-index-build.requested.v1` | `lcsp.legal-index-build.v1` | corpus approval outbox | Python ChromaDB Legal Index Worker |
| `event.technical-evidence.accepted.v1` | managed Deep Agents invocation | accepted technical evidence projection | Python EngineeringRule Assessment Boundary |
| `command.gap-analysis.requested.v1` | `lcsp.gap-analysis-worker.v1` | classification projection | Python Gap Analysis Worker |
| `command.document.requested.v1` | `lcsp.document-worker.v1` | gap/document request projection | Python Document Worker |

## Completion and Failure Events

| Domain | Success/Fact Event | Failure/Blocked Event |
|---|---|---|
| Scan Trigger | `event.scan-trigger.ready.v1` | `event.scan-trigger.pending-mapping.v1`, `event.scan-trigger.blocked-mapping.v1`, `event.scan-trigger.waiting-for-context.v1`, `event.scan-trigger.rejected.v1` |
| Scan | `event.scan.completed.v1` | `event.scan.failed.v1` |
| Technical Profile | `event.technical-profile.completed.v1` | `event.technical-profile.failed.v1` |
| AI Usage Flow | `event.ai-usage-flow.completed.v1` | `event.ai-usage-flow.failed.v1` |
| Legal Source | `event.legal-source.ingest.completed.v1` | `event.legal-source.ingest.failed.v1` |
| Legal Index | `event.legal-index-build.completed.v1` | `event.legal-index-build.failed.v1` |
| Classification | `event.classification.completed.v1` | `event.classification.blocked.v1` |
| Gap Analysis | `event.gap-analysis.completed.v1` | `event.gap-analysis.blocked.v1`, `event.gap-analysis.failed.v1` |
| Document | `event.document.generated.v1` | `event.document.blocked.v1` |

## Event Guards

| Event | Required Guard |
|---|---|
| `event.scan.completed.v1` | quality-valid report persisted, ScanJob completed, workspace cleanup verified |
| `event.scan-trigger.ready.v1` | trusted source verified, PBAC allowed, unique tenant/repository/assessment/branch/commit mapping exists |
| `event.legal-source.ingest.completed.v1` | source validated, snapshot/hash persisted, document staged in DRAFT corpus |
| `event.legal-index-build.completed.v1` | corpus approved, ChromaDB records written, legal hierarchy/xref metadata verified and citation allowlist-ready |
| `event.classification.completed.v1` | direct EngineeringRule assessment result persisted with legal rule provenance and evidence refs |
| `event.gap-analysis.completed.v1` | valid classification and legal basis exist |
| `event.document.generated.v1` | gap/classification/citation/output guards pass and artifact metadata exists |

## Domain Events

- `ASSESSMENT_CREATED`
- `WIZARD_PROFILE_SAVED`
- `REPOSITORY_CONNECTED`
- `SNAPSHOT_CREATED`
- `SCAN_REQUESTED`
- `SCAN_STARTED`
- `TECHNICAL_PROFILE_CREATED`
- `AI_USAGE_FLOW_CREATED`
- `RECONCILIATION_CONFLICT_DETECTED`
- `RECONCILIATION_RESOLVED`
- `VERIFIED_PROFILE_CREATED`
- `SCAN_TRIGGER_RECEIVED`
- `SCAN_TRIGGER_READY`
- `SCAN_TRIGGER_PENDING_MAPPING`
- `SCAN_TRIGGER_BLOCKED_MAPPING`
- `SCAN_TRIGGER_WAITING_FOR_CONTEXT`
- `SCAN_TRIGGER_REJECTED`
- `PBAC_DECISION_RECORDED`
- `LEGAL_SOURCE_VALIDATED`
- `LEGAL_SOURCE_INGESTED`
- `LEGAL_SOURCE_INGEST_FAILED`
- `LEGAL_CORPUS_APPROVED`
- `LEGAL_CORPUS_REJECTED`
- `LEGAL_CORPUS_SUPERSEDED`
- `LEGAL_INDEX_BUILD_COMPLETED`
- `LEGAL_INDEX_BUILD_FAILED`
- `LEGAL_MATCHING_COMPLETED`
- `CLASSIFICATION_COMPLETED`
- `CLASSIFICATION_BLOCKED`
- `GAP_ANALYSIS_COMPLETED`
- `GAP_ANALYSIS_BLOCKED`
- `DOCUMENT_GENERATED`
- `DOCUMENT_BLOCKED`
- `AUDIT_EXPORT_GENERATED`
- `SECURITY_EVENT`

Internal Legal Operator produces source-validation and corpus approval/rejection/supersession events through internal API/CLI. These are not Manager/Developer customer tasks.

`AUDIT_EXPORT_GENERATED` is a synchronous Backend API audit/export domain fact for MVP. There is no active `command.audit-export.requested.v1`, audit export queue, or Audit Export Worker. Introducing an asynchronous audit export worker requires a separate command/event/retry contract.

## Orchestration

```text
command.scan-trigger.resolve-context.v1
-> event.scan-trigger.ready.v1
or event.scan-trigger.pending-mapping.v1
or event.scan-trigger.blocked-mapping.v1
or event.scan-trigger.waiting-for-context.v1
or event.scan-trigger.rejected.v1
-> command.scan.requested.v1 when ready
```

```text
event.scan.completed.v1
-> command.technical-profile.requested.v1
-> event.technical-profile.completed.v1
-> command.ai-usage-flow.requested.v1
-> event.ai-usage-flow.completed.v1
-> event.technical-evidence.accepted.v1
-> managed boundary engineering_assessment_requested
-> event.classification.completed.v1
-> command.gap-analysis.requested.v1
-> event.gap-analysis.completed.v1
-> command.document.requested.v1
```

Internal legal preparation:

```text
command.legal-source.ingest.requested.v1
-> event.legal-source.ingest.completed.v1
-> command.legal-source.vbpl-effected-chunk-set.requested.v1 when VBPL HTML effect markup is available
-> legal chunk-set + relationship manifest READY
-> internal approval
-> command.legal-index-build.requested.v1
-> event.legal-index-build.completed.v1
```

## Idempotency and Failure

- Duplicate delivery is a no-op or safe resume from persisted state.
- Retryable failures use bounded backoff and DLQ.
- Domain guard failures persist blocked/failed state without unnecessary retries.
- Completed artifacts are immutable and are not silently overwritten.

```text
CANONICAL_EVENT_NAMES_NORMALIZED
PYTHON_SCANNER_EVENT_OWNERSHIP_ALIGNED
PYTHON_WORKER_PLATFORM_EVENT_OWNERSHIP_ALIGNED
STRUCTURED_ATTESTATION_EVENTS_SUPERSEDED_FOR_ACTIVE_MVP
AUTOMATIC_TRUSTED_SCAN_TRIGGER_EVENTS_ADDED
INTERNAL_LEGAL_OPERATOR_EVENT_BOUNDARY_LOCKED
```
