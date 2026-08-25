# Queue Implementation

## Status

AUTHORITATIVE IMPLEMENTATION DOCUMENT

## Purpose

Single source for RabbitMQ topology, retries, idempotency, worker orchestration and async job behavior.

## Queue Jobs, Retry and Idempotency

## Purpose

Define queue job types, job envelope, retry policy, idempotency and failure handling for long-running LCSP workflows.

## Scope

Queue handles trusted scan trigger resolution, Repository Scan, workflow/orchestration work, classification/RAG steps, document generation and recovery jobs. API remains responsive and does not execute long-running work synchronously. All asynchronous domain consumers belong to the Python Worker Platform.

## Active Implementation References

- `docs/implementation/backend-implementation.md`
- `docs/implementation/persistence-implementation.md`
- `docs/implementation/scanner-implementation.md`
- `docs/specs/event-catalog.md`
- `docs/specs/domain-state-machines.md`

## Implementation Boundaries

- Queue payloads contain references only.
- Worker consumes jobs and persists progress/checkpoints.
- Retry must be bounded and auditable.
- Raw source, prompts, secrets and full AST bodies must never be queue payloads.

## Job Types

| Job Type                  | Purpose                                               | Idempotency Basis                                                                                    |
| ------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `scan_trigger_resolution` | Resolve trusted scan trigger context and mapping      | org + repository connection + assessment/pending mapping + branch + commit + trigger source/delivery |
| `repository_scan`         | Static scan selected repo/commit                      | repo + commit + scanner/toolchain version + config/ruleset version                                   |
| `workflow_continue`       | Resume orchestrator after node/result                 | workflow run + state version                                                                         |
| `classification_run`      | Legal RAG + risk classification                       | VerifiedProfile version + corpus version                                                             |
| `gap_analysis_run`        | Generate compliance gap analysis after classification | classification result + legal-match versions                                                         |
| `document_generation`     | Generate document artifact                            | assessment + template + result versions                                                              |
| `cleanup_verification`    | Verify scanner workspace cleanup                      | scan id + workspace id                                                                               |
| `recovery_replay`         | Reconcile stuck job/state                             | workflow run + checkpoint                                                                            |

## Job Envelope

| Field             | Required | Notes               |
| ----------------- | -------: | ------------------- |
| `job_id`          |      Yes | Unique job identity |
| `job_type`        |      Yes | Stable type         |
| `correlationId`   |      Yes | Audit/trace         |
| `assessment_id`   |      Yes | Scope               |
| `workflow_run_id` |      Yes | Orchestration scope |
| `idempotency_key` |      Yes | Duplicate handling  |
| `input_refs`      |      Yes | DB/object refs only |
| `attempt`         |      Yes | Retry count         |
| `created_at`      |      Yes | Timeout/retry       |

## Retryable and Non-Retryable Failures

| Failure                            |             Retry? | Behavior                                        |
| ---------------------------------- | -----------------: | ----------------------------------------------- |
| Transient GitHub/network failure   |                Yes | Retry with backoff                              |
| Queue delivery interruption        |                Yes | Re-deliver idempotently                         |
| Worker crash                       |                Yes | Resume from checkpoint                          |
| Invalid evidence schema            |                 No | Reject report, classification locked            |
| Missing authorization/precondition |                 No | Fail closed                                     |
| Missing citation                   | No automatic retry | Block/degrade until corpus/rule issue addressed |
| Raw source cleanup failure         |           Escalate | Critical security alert                         |

## Retry Budget and Backoff

Use per-job retry budgets and exponential backoff with jitter. Poison jobs move to dead-letter with redacted diagnostic metadata and operator remediation path.

## Idempotency Rules

- Duplicate scan request for same repo/commit/scanner/ruleset returns existing job/result when safe.
- Classification duplicate for same VerifiedProfile/corpus version returns existing run/result.
- GapAnalysis duplicate for the same `riskClassificationId` returns the existing `GapAnalysis` row. The physical idempotency constraint is `GapAnalysis.@@unique([riskClassificationId])`.
- Document duplicate for same template/result versions returns existing artifact or creates new explicit regeneration version.

## Progress Reporting

Worker writes job progress and node state to durable state. API exposes progress through polling or SSE projection. Web never reads queue directly.

## Timeout and Cancellation

Timeouts mark jobs failed or recoverable depending on node. Cancellation is allowed only where state can be safely rolled forward or marked canceled without leaving untracked raw workspace.

## Security and Privacy Considerations

Queue payloads must be redacted and reference-based. No source, prompts, secrets, raw provider tokens or full AST bodies.

## Audit Requirements

Audit job queued, started, checkpointed, retried, dead-lettered, canceled, completed and failed.

## Locked Retry Budget for Controlled MVP

All worker retries use bounded exponential backoff with jitter: `30s`, `120s`, `600s`, then DLQ after max attempts. Jitter is plus/minus 20 percent. Non-retryable domain guard failures persist blocked/failed state and do not consume retry budget.

| Worker                              | Queue                              | DLQ                                    | Max Attempts | Terminal Failure Behavior                                                                                                                                                                         |
| ----------------------------------- | ---------------------------------- | -------------------------------------- | -----------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scan Trigger worker (Python)        | `lcsp.scan-trigger-worker.v1`      | `lcsp.scan-trigger-worker.dlq.v1`      |            5 | Persist safe mapping state or rejected trigger, audit PBAC/trigger decision. Retry/DLQ/replay behavior follows `docs/implementation/decisions/trusted-scan-trigger-retry-dlq-replay-decision.md`. |
| Scan worker (Python)                | `lcsp.scan-worker.v1`              | `lcsp.scan-worker.dlq.v1`              |            3 | Persist `event.scan.failed.v1`, mark ScanJob `FAILED`, audit redacted failure.                                                                                                                    |
| Legal Source Ingest worker (Python) | `lcsp.legal-source-ingest.v1`      | `lcsp.legal-source-ingest.dlq.v1`      |            3 | Publish `event.legal-source.ingest.failed.v1`, block corpus building, audit.                                                                                                                      |
| Legal Index Build worker (Python)   | `lcsp.legal-index-build.v1`        | `lcsp.legal-index-build.dlq.v1`        |            3 | Publish `event.legal-index-build.failed.v1`, block ChromaDB legal retriever, audit.                                                                                                               |
| TechnicalProfile worker (Python)    | `lcsp.technical-profile-worker.v1` | `lcsp.technical-profile-worker.dlq.v1` |            3 | Publish `event.technical-profile.failed.v1`, block downstream, audit.                                                                                                                             |
| AIUsageFlow worker (Python)         | `lcsp.ai-usage-flow-worker.v1`     | `lcsp.ai-usage-flow-worker.dlq.v1`     |            3 | Publish `event.ai-usage-flow.failed.v1`, block reconciliation, audit.                                                                                                                             |
| Reconciliation worker (Python)      | `lcsp.reconciliation-worker.v1`    | `lcsp.reconciliation-worker.dlq.v1`    |            3 | Persist conflict/blocked state when possible; otherwise audit worker failure.                                                                                                                     |
| LegalMatching worker (Python)       | `lcsp.legal-matching-worker.v1`    | `lcsp.legal-matching-worker.dlq.v1`    |            3 | Publish `event.legal-matching.failed.v1`, block/degrade classification, audit.                                                                                                                    |
| Classification worker (Python)      | `lcsp.classification-worker.v1`    | `lcsp.classification-worker.dlq.v1`    |            3 | Publish `event.classification.blocked.v1` or failed audit record depending on failure type.                                                                                                       |
| GapAnalysis worker (Python)         | `lcsp.gap-analysis-worker.v1`      | `lcsp.gap-analysis-worker.dlq.v1`      |            3 | Publish `event.gap-analysis.failed.v1` or `event.gap-analysis.blocked.v1`, block document generation, audit.                                                                                      |
| Document worker (Python)            | `lcsp.document-worker.v1`          | `lcsp.document-worker.dlq.v1`          |            3 | Publish `event.document.blocked.v1` or failed audit record depending on failure type.                                                                                                             |

## Locked Orchestration Persistence for Controlled MVP

Checkpoint persistence uses existing domain state, job status rows, `OutboxEvent` and `AuditEvent`. Worker handlers must be idempotent by job id, aggregate id, source version and command routing key. Additional workflow-engine-specific checkpoint storage is not required for controlled MVP coding.

<!-- PHASE-5-5-RABBITMQ-OUTBOX:START -->

## Phase 5.5 Canonical RabbitMQ Topology and Outbox Pattern

### Exchanges

| Exchange             | Purpose                                               |
| -------------------- | ----------------------------------------------------- |
| `lcsp.commands.v1`   | Commands requesting work.                             |
| `lcsp.events.v1`     | Facts emitted after persisted state changes.          |
| `lcsp.deadletter.v1` | Dead-letter routing for exhausted or poison messages. |

### Queues and DLQs

| Queue                              | DLQ                                    | Consumer                             |
| ---------------------------------- | -------------------------------------- | ------------------------------------ |
| `lcsp.scan-trigger-worker.v1`      | `lcsp.scan-trigger-worker.dlq.v1`      | Python Scan Trigger Worker           |
| `lcsp.scan-worker.v1`              | `lcsp.scan-worker.dlq.v1`              | Python Worker                        |
| `lcsp.legal-source-ingest.v1`      | `lcsp.legal-source-ingest.dlq.v1`      | Python Legal Source Ingestion worker |
| `lcsp.legal-index-build.v1`        | `lcsp.legal-index-build.dlq.v1`        | Python ChromaDB Legal Index worker   |
| `lcsp.technical-profile-worker.v1` | `lcsp.technical-profile-worker.dlq.v1` | Python TechnicalProfile worker       |
| `lcsp.ai-usage-flow-worker.v1`     | `lcsp.ai-usage-flow-worker.dlq.v1`     | Python AIUsageFlow worker            |
| `lcsp.reconciliation-worker.v1`    | `lcsp.reconciliation-worker.dlq.v1`    | Python Reconciliation worker         |
| `lcsp.legal-matching-worker.v1`    | `lcsp.legal-matching-worker.dlq.v1`    | Python Legal Matching worker         |
| `lcsp.classification-worker.v1`    | `lcsp.classification-worker.dlq.v1`    | Python Classification worker         |
| `lcsp.gap-analysis-worker.v1`      | `lcsp.gap-analysis-worker.dlq.v1`      | Python Gap Analysis worker           |
| `lcsp.document-worker.v1`          | `lcsp.document-worker.dlq.v1`          | Python Document worker               |

### Routing Keys

Commands use `lcsp.commands.v1`:

- `command.scan.requested.v1`
- `command.scan-trigger.resolve-context.v1`
- `command.legal-source.ingest.requested.v1`
- `command.legal-index-build.requested.v1`
- `command.technical-profile.requested.v1`
- `command.ai-usage-flow.requested.v1`
- `command.reconciliation.requested.v1`
- `command.legal-matching.requested.v1`
- `command.classification.requested.v1`
- `command.gap-analysis.requested.v1`
- `command.document.requested.v1`

Events use `lcsp.events.v1`:

- `event.scan.completed.v1`
- `event.scan.failed.v1`
- `event.scan-trigger.ready.v1`
- `event.scan-trigger.pending-mapping.v1`
- `event.scan-trigger.blocked-mapping.v1`
- `event.scan-trigger.waiting-for-context.v1`
- `event.scan-trigger.rejected.v1`
- `event.legal-source.ingest.completed.v1`
- `event.legal-source.ingest.failed.v1`
- `event.legal-index-build.completed.v1`
- `event.legal-index-build.failed.v1`
- `event.technical-profile.completed.v1`
- `event.technical-profile.failed.v1`
- `event.ai-usage-flow.completed.v1`
- `event.ai-usage-flow.failed.v1`
- `event.reconciliation.conflict-detected.v1`
- `event.classification.completed.v1`
- `event.classification.blocked.v1`
- `event.gap-analysis.completed.v1`
- `event.gap-analysis.blocked.v1`
- `event.gap-analysis.failed.v1`
- `event.document.generated.v1`
- `event.document.blocked.v1`

Never use unprefixed scan routing keys. All requested-work messages must use `command.*`; all persisted facts must use `event.*`.

### Message Envelope

```json
{
  "messageId": "018f0000-0000-7000-8000-000000000001",
  "eventType": "command.scan.requested.v1",
  "schemaVersion": 1,
  "correlationId": "018f0000-0000-7000-8000-000000000002",
  "causationId": "018f0000-0000-7000-8000-000000000003",
  "aggregateType": "Assessment",
  "aggregateId": "018f0000-0000-7000-8000-000000000004",
  "occurredAt": "2026-06-21T00:00:00.000Z",
  "payload": {
    "scanJobId": "018f0000-0000-7000-8000-000000000005",
    "repositorySnapshotId": "018f0000-0000-7000-8000-000000000006"
  }
}
```

Payloads must contain UUIDv7 references only. They must not contain raw source, tokens, prompts, secrets or full AST bodies.

### Outbox Pattern

All API and worker command methods write `OutboxEvent` rows instead of publishing directly inside a domain transaction.

Transaction rule:

1. Validate DTO.
2. Authorize actor.
3. Validate state transition.
4. Start DB transaction.
5. Write domain row.
6. Write `AuditEvent`.
7. Write `OutboxEvent`.
8. Commit transaction.
9. Outbox publisher later publishes to RabbitMQ.
10. Mark outbox event `PUBLISHED`.

No service may publish directly to RabbitMQ inside the same transaction.

`OutboxEvent` fields are: `id`, `eventType`, `exchange`, `routingKey`, `payload`, `status`, `attempts`, `nextAttemptAt`, `lockedAt`, `lockedBy`, `publishedAt`, `lastError`, `correlationId`, `causationId`, `aggregateType`, `aggregateId`, `createdAt`, `updatedAt`.

Publisher locking and retry:

1. Select `PENDING` events where `nextAttemptAt <= now()`.
2. Lock with `lockedAt` and `lockedBy`.
3. Publish to RabbitMQ exchange/routing key.
4. Mark `PUBLISHED` on broker acknowledgement.
5. On transient failure, increment `attempts`, clear lock, set exponential backoff in `nextAttemptAt`.
6. Mark `FAILED` after max attempts.
7. Write an `AuditEvent` for publishing failure.

### Canonical Classification Trigger

Classification runs from accepted technical evidence through the managed EngineeringRule assessment boundary:

```text
event.technical-evidence.accepted.v1 -> engineering_assessment_requested
```

The retired VerifiedProfile approval, legal-matching callback and classification baseline/proposal/review queues are not active MVP gates:

```text
event.reconciliation.verified-profile-ready.v1
command.legal-matching.requested.v1
event.legal-matching.completed.v1
```

Classification persists a direct EngineeringRule result with legal rule provenance, citation state and evidence refs. Evidence-less claims fail closed to `UNKNOWN`.

Gap Analysis runs only after classification completes:

```text
event.classification.completed.v1 -> command.gap-analysis.requested.v1
```

Document generation runs only after gap analysis completes:

```text
event.gap-analysis.completed.v1 -> command.document.requested.v1
```

Document generation must not consume `event.classification.completed.v1` directly. `event.classification.blocked.v1`, `event.gap-analysis.blocked.v1`, and `event.gap-analysis.failed.v1` keep document generation blocked until a new valid upstream result exists.
<!-- PHASE-5-5-RABBITMQ-OUTBOX:END -->
