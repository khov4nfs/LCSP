---
title: 'Assessment Root correlation lifecycle'
type: 'bugfix'
created: '2026-11-23'
status: 'done'
review_loop_iteration: 0
baseline_commit: '9edf04873f0dfe11cad129f0080cc4d19ced6e83'
context:
  - 'docs/project-context.md'
  - 'deepagents/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `AssessmentRuntimeClient` creates a new `x-correlation-id` for every HTTP attempt and the Root boundary ignores its existing command correlation ID. This fragments one execution across context, rule-set, evidence, heartbeat, and retries.

**Approach:** Bind the boundary's existing correlation ID once to the runtime client and reuse it for every call and retry in that execution. Preserve the current header contract and redact worker/lease secrets from surfaced API error metadata.

## Boundaries & Constraints

**Always:** Reuse one immutable correlation ID per execution; propagate the existing header; keep heartbeat and main-thread calls on the same trace; preserve retry behavior; keep worker key and lease token out of logs and surfaced errors.

**Ask First:** Any change to the NestJS header contract, queue payload schema, retry policy, lease lifecycle, or command identity semantics.

**Never:** Add a second correlation header, store correlation globally, reuse an ID across independent executions, log request headers/secrets, alter authorization, or commit/push/create a PR.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Root execution | Boundary receives a valid ID | Every client call uses that exact ID | Existing API failures remain unchanged |
| Read retry | GET/HEAD transiently fails | All attempts reuse the execution ID | Existing bounded backoff applies |
| New execution | Two independent clients run | Each execution has a distinct ID | No cross-execution mutable state |
| Sensitive error metadata | Problem contains worker/lease fields | Secrets are absent from surfaced error data | Preserve safe scalar metadata |

</frozen-after-approval>

## Code Map

- `deepagents/assessment_root/client.py` -- worker headers, retries, and API error metadata.
- `deepagents/assessment_root/boundary.py` -- canonical command correlation and execution client construction.
- `deepagents/tools/common/capabilities/agent_runtime/rabbitmq_consumer.py` -- ingress fallback correlation isolation.
- `deepagents/tests/test_assessment_runtime_client_retries.py` -- focused transport coverage.
- `deepagents/tests/test_assessment_root_agent.py` -- boundary propagation coverage.
- `deepagents/tests/test_agent_runtime_rabbitmq_consumer.py` -- missing-correlation delivery coverage.

## Tasks & Acceptance

**Execution:**
- [x] `deepagents/tests/test_assessment_runtime_client_retries.py` -- add RED tests for workflow/retry reuse, execution isolation, and secret-safe errors.
- [x] `deepagents/tests/test_assessment_root_agent.py` -- prove boundary propagation.
- [x] `deepagents/assessment_root/client.py` -- bind immutable execution correlation and sanitize sensitive metadata.
- [x] `deepagents/assessment_root/boundary.py` -- propagate the canonical correlation without a new header.
- [x] `deepagents/tools/common/capabilities/agent_runtime/rabbitmq_consumer.py` -- prevent unrelated fallback deliveries from sharing one boundary-wide ID.
- [x] `deepagents/tests/test_agent_runtime_rabbitmq_consumer.py` -- lock distinct fallback identities with a RED/GREEN reproducer.
- [x] `.agents/memory/lessons-learned.md` and `deepagents/AGENTS.md` -- persist the invariant.

**Acceptance Criteria:**
- Given one execution with multiple calls and retries, every request carries the same canonical ID.
- Given independent execution clients, their fallback IDs differ.
- Given a boundary correlation ID, client requests use that exact value.
- Given sensitive upstream metadata, worker/lease secrets do not appear in the error string or metadata.
- Given two deliveries without a producer correlation, their fallback identities are non-empty and distinct.
- Given one unidentified delivery is retried or times out before dispatch, its minted fallback is persisted and reused by settlement telemetry.

## Spec Change Log

## Design Notes

The ID is instance-scoped: production creates one client per boundary and the heartbeat thread shares it. The immutable value requires no lock and cannot contaminate another production execution.

## Verification

**Commands:**
- `cd deepagents && PYTHONPATH=. .venv/bin/pytest tests/test_assessment_runtime_client_retries.py -v`
- `cd deepagents && PYTHONPATH=. .venv/bin/pytest tests/test_assessment_root_agent.py -q`
- `cd deepagents && PYTHONPATH=. .venv/bin/pytest tests/test_agent_runtime_rabbitmq_consumer.py -q`
- Python lint/type checks for changed files.
- `graphify update .`

## Suggested Review Order

**Execution trace lifecycle**

- Bind the canonical boundary identity at the Python execution entry point.
  [`boundary.py:167`](../../deepagents/assessment_root/boundary.py#L167)

- Keep one immutable header identity across calls, retries, and heartbeat.
  [`client.py:87`](../../deepagents/assessment_root/client.py#L87)

- Reject client reuse before a trace can cross execution boundaries.
  [`client.py:231`](../../deepagents/assessment_root/client.py#L231)

**Ingress resilience and secret isolation**

- Resolve, validate, and persist fallback identity before dispatch or timeout.
  [`rabbitmq_consumer.py:629`](../../deepagents/tools/common/capabilities/agent_runtime/rabbitmq_consumer.py#L629)

- Preserve safe correction feedback while removing reflected worker credentials.
  [`client.py:34`](../../deepagents/assessment_root/client.py#L34)

**Regression evidence**

- Lock workflow, retry, heartbeat, isolation, validation, and redaction behavior.
  [`test_assessment_runtime_client_retries.py:51`](../../deepagents/tests/test_assessment_runtime_client_retries.py#L51)

- Prove the outbox correlation reaches the runtime client unchanged.
  [`test_assessment_root_agent.py:990`](../../deepagents/tests/test_assessment_root_agent.py#L990)

- Cover unique, durable fallback behavior through retry and timeout paths.
  [`test_agent_runtime_rabbitmq_consumer.py:308`](../../deepagents/tests/test_agent_runtime_rabbitmq_consumer.py#L308)
