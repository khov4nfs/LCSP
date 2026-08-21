# Python Worker Platform Implementation Specification

## Status

AUTHORITATIVE BUILD DOCUMENT — A-to-Z RUNNABLE MVP

## Purpose

Define the common Python Worker Platform contract for all asynchronous domain workloads. This file owns platform-wide process, queue, configuration, observability, idempotency, persistence adapter, audit, and deployment rules.

Domain worker build details live in worker-specific implementation files:

- `docs/implementation/scanner-worker-implementation.md`
- `docs/implementation/legal-corpus-ingestion-implementation.md`
- `docs/implementation/chromadb-vectorless-legal-retriever-implementation.md`

This file is not the scanner runtime specification.

## Worker Modules

| Worker | Queue | Command | Primary Output |
|---|---|---|---|
| Scan Trigger Worker | `lcsp.scan-trigger-worker.v1` | `command.scan-trigger.resolve-context.v1` | trusted scan context or blocked trigger state |
| Scanner Worker | `lcsp.scan-worker.v1` | `command.scan.requested.v1` | `TechnicalEvidenceReport` |
| Technical Profile Worker | `lcsp.technical-profile-worker.v1` | `command.technical-profile.requested.v1` | `TechnicalProfile` |
| AI Usage Flow Worker | `lcsp.ai-usage-flow-worker.v1` | `command.ai-usage-flow.requested.v1` | `AIUsageFlow` |
| Reconciliation Worker | `lcsp.reconciliation-worker.v1` | `command.reconciliation.requested.v1` | `ReconciliationConflict` or `VerifiedProfile` |
| Legal Source Ingestion Worker | `lcsp.legal-source-ingest.v1` | `command.legal-source.ingest.requested.v1` | staged legal corpus artifacts |
| VBPL Effected Chunk-Set Worker | `lcsp.legal-source-vbpl-effected-chunk-set.v1` | `command.legal-source.vbpl-effected-chunk-set.requested.v1` | effect-aware legal chunk-set and relationship manifest |
| Legal Index Worker | `lcsp.legal-index-build.v1` | `command.legal-index-build.requested.v1` | ChromaDB vectorless legal index |
| Legal Matching Worker | `lcsp.legal-matching-worker.v1` | `command.legal-matching.requested.v1` | `LegalRuleMatch[]` |
| Classification Worker | `lcsp.classification-worker.v1` | `command.classification.requested.v1` | `RiskClassification` |
| Gap Analysis Worker | `lcsp.gap-analysis-worker.v1` | `command.gap-analysis.requested.v1` | `GapAnalysis` |
| Document Worker | `lcsp.document-worker.v1` | `command.document.requested.v1` | `GeneratedDocument` |
| Audit Export | synchronous Backend API operation | none | redacted audit export artifact |

## Platform Package Shape

```text
lcsp-python-workers/
  pyproject.toml
  src/lcsp_workers/
    platform/
      config.py
      logging.py
      queue_consumer.py
      retry_policy.py
      idempotency.py
      lifecycle.py
      persistence.py
      outbox.py
      audit.py
      telemetry.py
      redaction.py
    scan_trigger/
    scanner/
    technical_profile/
    ai_usage_flow/
    reconciliation/
    legal_ingestion/
    legal_index/
    legal_matching/
    classification/
    gap_analysis/
    document/
```

Canonical MVP package topology is the `lcsp-python-workers` monorepo. Separating workers into independently deployable Python packages is a post-MVP packaging decision and must not be presented as concurrent canonical structure.

## Runtime Contract

Every worker process must:

1. Load validated configuration.
2. Validate PostgreSQL connectivity.
3. Validate RabbitMQ connectivity.
4. Validate required downstream service credentials for its own domain only.
5. Bind exactly its configured queue.
6. Consume one command schema family.
7. Acquire idempotent command lock before domain mutation.
8. Persist domain output before emitting downstream events.
9. Write `AuditEvent` for material state changes.
10. Write `OutboxEvent` in the same transaction as terminal state changes.
11. Stop accepting new work on shutdown and either complete or safely release in-flight work.

Workers do not publish RabbitMQ events directly inside domain transactions. An outbox publisher owns external publication.

## Shared Configuration

| Key | Secret | Applies To |
|---|---:|---|
| `DATABASE_URL` | Yes | all workers |
| `RABBITMQ_URL` | Yes | all workers |
| `LCSP_ENV` | No | all workers |
| `LCSP_LOG_LEVEL` | No | all workers |
| `WORKER_NAME` | No | all workers |
| `WORKER_QUEUE` | No | all workers |
| `WORKER_CONCURRENCY` | No | all workers |
| `WORKER_SHUTDOWN_GRACE_SECONDS` | No | all workers |
| `WORKER_RETRY_PROFILE` | No | all workers |
| `LLM_PROVIDER_CONFIG_REF` | Yes | AIUsageFlow, Classification, Document |
| `CHROMADB_URL` | Yes | Legal Index, Legal Matching |
| `OBJECT_STORAGE_*` | Yes | Scanner, Legal Ingestion, Document |

Domain-specific configuration belongs in the domain implementation file.

## Idempotency and Retry

Every command handler must key idempotency by:

```text
command name
aggregate ID
command semantic version
input version/hash where applicable
```

Duplicate delivery must be a no-op or safe resume from persisted state. Retryable failures use bounded backoff and DLQ according to `docs/implementation/queue-implementation.md`. Domain guard failures persist blocked/failed state and are not retried blindly.

## Audit and Observability

Every worker writes redacted logs and audit records with:

- correlation ID;
- causation ID;
- command ID;
- aggregate reference;
- actor/service identity;
- worker name/version;
- policy ID/version when PBAC is evaluated;
- safe failure code and recovery hint when applicable.

Raw source, secrets, full prompts, provider tokens, and unredacted tool output must not appear in logs, queues, audit, or ordinary persistence.

## Acceptance

- Each listed active asynchronous worker has a queue binding, command schema, idempotency behavior, terminal states, audit events, and outbox behavior.
- Audit export is a synchronous Backend API operation for MVP; adding an Audit Export Worker requires a separate command, queue, event and retry contract.
- Scanner-specific runtime details are owned by `scanner-worker-implementation.md`, not this platform file.
- Legal retrieval-specific ChromaDB behavior is owned by `chromadb-vectorless-legal-retriever-implementation.md`.
- Duplicate command delivery does not duplicate domain artifacts.
- Terminal success emits exactly one downstream outbox event for that terminal transition.
- Terminal failure records safe failure reason, correlation ID, and recovery behavior.

## Non-Claims

- Not deployment authorization.
- Not a scanner behavior specification.
- Not implementation readiness certification.
