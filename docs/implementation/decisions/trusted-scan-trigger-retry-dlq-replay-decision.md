---
status: ACTIVE_PLANNING_AUTHORITY
artifact_type: implementation_decision
decision_id: DEC-TRUSTED-SCAN-TRIGGER-001
owner: Platform / Scanner
resolves:
  - TRUSTED_SCAN_TRIGGER_IDEMPOTENCY_RETRY_DLQ_REPLAY_OPERATOR_RECOVERY
---

# Trusted Scan Trigger Retry, DLQ, and Replay Decision

## Decision

Trusted scan initiation is resolved through durable trigger records and idempotent scan job creation. Duplicate, retry, out-of-order, and replayed deliveries must never create duplicate accepted evidence chains or mutate historical scan artifacts.

## Idempotency Keys

| Flow | Idempotency key |
|---|---|
| Manager scan request | `scan-request:{assessment_id}:{repository_snapshot_id}:{scan_generation}` |
| Trusted integration trigger | `trusted-trigger:{provider}:{delivery_id}` plus resolved `scan-request` key |
| Rerun same snapshot | `scan-rerun:{assessment_id}:{repository_snapshot_id}:{requested_generation}` |
| Worker command | command payload `idempotency_key` + aggregate ID |

The API may return an existing job when the idempotency key, assessment ID, snapshot ID, and state version match. If the same key arrives with different material inputs, reject with `IDEMPOTENCY_CONFLICT`.

## Retry Policy

| Stage | Retry budget | Retryable failures | Non-retryable failures |
|---|---:|---|---|
| trigger validation | 3 attempts | temporary provider metadata lookup failure | invalid signature, untrusted source |
| mapping resolution | 5 attempts | temporary DB/provider lookup failure | ambiguous mapping, tenant mismatch |
| snapshot creation | 3 attempts | provider timeout, transient clone/archive failure | revoked repository, invalid commit |
| scan command publish | 5 attempts | outbox publish failure, broker unavailable | schema-invalid command |
| scanner worker execution | domain policy | timeout/tool failure according to scanner severity policy | privacy cleanup failure, redaction failure |

Retries use exponential backoff with jitter. Retry metadata must include `attempt`, `max_attempts`, `last_error_code`, and `next_retry_at`.

## DLQ Policy

Move to DLQ when retry budget is exhausted or when a non-retryable technical failure requires operator action.

DLQ records must include:

- command/event name and schema version;
- aggregate ID;
- organization ID and assessment ID when applicable;
- idempotency key;
- correlation ID and causation ID;
- retry count;
- last safe error code;
- operator recovery action.

DLQ payloads must not contain raw source, secrets, tokens, full prompts, or tool output bodies.

## Replay Authority

| Actor | Allowed replay |
|---|---|
| Manager | request scan rerun from current UI state |
| Platform operator | replay DLQ item after fixing infrastructure/config |
| Scanner operator | replay scanner command only when prior accepted evidence is not mutated |
| Developer | no replay authority unless separately scoped and RBAC allows a rerun request |

Replay creates a new attempt or resumes an existing non-terminal job. Replay must not rewrite `COMPLETED`, `FAILED`, or accepted evidence/profile artifacts.

## Mapping States

| State | Meaning | Downstream eligibility |
|---|---|---|
| `PENDING_MAPPING` | required mapping missing but resolvable by Manager/system input | no scan |
| `WAITING_FOR_CONTEXT` | out-of-order event can safely wait for missing context | no scan |
| `BLOCKED_MAPPING` | ambiguous or unsafe mapping | no scan |
| `READY_TO_SNAPSHOT` | unique tenant/repository/assessment/ref/commit context resolved | snapshot allowed |
| `REJECTED` | invalid, unauthorized, or unsafe trigger | terminal no scan |

## Audit and Status Signals

| Event | Required signal |
|---|---|
| duplicate trigger | existing trigger/job ID, no mutation |
| idempotency conflict | rejection with safe reason |
| retry scheduled | next retry time and safe reason |
| DLQ entered | operator action and correlation ID |
| replay accepted | replay actor, authority, and target aggregate |
| replay denied | reason and policy/state gate |

## Acceptance Evidence

| Requirement | Required evidence |
|---|---|
| FR-050 | duplicate trusted trigger resumes/no-ops without duplicate scan |
| NFR-010 | trigger, retry, DLQ, replay decisions audited |
| NFR-021 | scan request returns after durable enqueue/status update |
| NFR-030 | rerun/replay preserves historical scan/evidence/profile chains |

## Implementation References

- `docs/implementation/tasks/modules/scan/01-scan-job-status-endpoint.md`
- `docs/implementation/tasks/modules/python-workers/platform/01-worker-platform-bootstrap.md`
- `docs/implementation/backend-implementation.md`
- `docs/implementation/queue-implementation.md`
- `docs/specs/domain-state-machines.md`

```text
TRUSTED_SCAN_TRIGGER_RETRY_DLQ_REPLAY_RESOLVED
IDEMPOTENCY_CONFLICT_REJECTS
DLQ_OPERATOR_RECOVERY_REQUIRED
REPLAY_DOES_NOT_MUTATE_ACCEPTED_EVIDENCE
```
