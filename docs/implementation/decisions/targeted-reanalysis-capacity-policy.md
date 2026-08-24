# Targeted Reanalysis Capacity and Recovery Policy

## Status

Accepted — 2026-08-11

## Context

Targeted reanalysis is a workload-creating, orchestrator-only tool. LCSP's scanner permits up to 600 seconds per scan. The shared Python `ConsumerBase` configures RabbitMQ with `prefetch_count=1`, so one consumer process executes only one scanner message at a time. The API outbox already provides transactional enqueue, `FOR UPDATE SKIP LOCKED`, exponential retry and DLQ, but its generic default is five total publish attempts; the workers already default to three requeues after an initial delivery.

Without a tenant admission policy, repeated missing-input resolution can starve ordinary scans, create duplicate execution on redelivery, or consume unbounded queue storage.

## Decision

For `command.scan.targeted-reanalysis.v1`:

- Run at most **2** requests concurrently per organization, with **10** further requests queued FIFO; `QUEUED`, `DISPATCHED`, and `RUNNING` are active states, capped at **12** in total.
- Accept at most **12 distinct requests per 15 minutes** and **40 per rolling 24 hours** per organization. Idempotent replays return the same request and do not consume rate quota.
- When the running limit is reached, retain a valid request as `QUEUED`; when active or rate capacity is exhausted, return a typed `BLOCKED` outcome and create no request/outbox row.
- Start with **4 global scanner slots**, retaining `prefetch_count=1` in each consumer. This makes the 2-per-tenant cap a fair-share boundary. Capacity may only increase after measuring p95 queue wait, execution duration, timeouts and DLQ rate.
- Publish through the API outbox once plus **3 retries** (4 attempts total) at `1s`, `2s`, and `4s` exponential backoff with jitter. Exhaustion writes DLQ and a failed request checkpoint.
- Execute once plus **3 worker retries** (4 deliveries total) through delayed queues at `10s`, `60s`, `300s`. The existing worker `MAX_RETRIES=3` semantics match this retry count but require a delayed-retry transport for this command.
- Retry only transient infrastructure failures. Validation, PBAC denial, immutable-pin mismatch, unsupported analyzer, and privacy/schema failures are terminal. A terminal request can never modify the original report; a successful request creates a new immutable report version.

## Required persistence and dispatch behavior

`TargetedReanalysisRequest` must persist organization/assessment, input report, pinned snapshot/commit, analyzer, normalized bounded scope, reason requirement, idempotency key, state, retry counters, checkpoint ref, output report ref and safe failure code. The unique idempotency key is organization-scoped.

The request reservation, capacity count, `PENDING_DISPATCH` checkpoint, outbox command and audit event occur in one transaction. Scheduler and worker claims use row locks and compare-and-set transitions, making duplicate outbox/AMQP delivery safe.

## Consequences

This is an intentionally modest baseline: a worst-case tenant may wait roughly 50 minutes behind ten 600-second requests using its two slots. It protects shared capacity and gives operational metrics a clear basis for revision. Requests beyond the queue are explicit failures for the resolver to surface, never invisible truncation.

## Source evidence

- `deepagents/tools/graph/scanner/scan_consumer.py` — `scan_timeout_seconds = 600`.
- `deepagents/tools/common/platform/queue_consumer.py` — `basic_qos(prefetch_count=1)` and `MAX_RETRIES` requeue behavior.
- `deepagents/tools/common/platform/config.py` — worker default `MAX_RETRIES=3`.
- `apps/api/src/platform/outbox/outbox.repository.ts` and `outbox-publisher.service.ts` — transactional `SKIP LOCKED`, retry and DLQ pattern.
