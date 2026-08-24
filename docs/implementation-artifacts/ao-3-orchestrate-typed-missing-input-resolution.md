# Story AO-3: Orchestrate Typed Missing-Input Resolution

Status: ready-for-dev

Jira: [LCSP-160 — Missing-Input Orchestration](https://minhpnq1807.atlassian.net/browse/LCSP-160)

## Story

As an orchestrator,
I want typed agent outcomes and a controlled resolver map,
so that missing evidence triggers a safe bounded action instead of a blind retry loop.

## Acceptance Criteria

1. Agent outcomes use the canonical `READY`, `NEEDS_INPUT`, `CONFLICT`, `OUT_OF_COVERAGE`, `BLOCKED`, or `FAILED` values, with requirements, evidence references, confidence, and an explicit terminal reason where applicable.
2. The resolver validates an allow-list, PBAC, idempotency, retry budget, and workflow state before dispatch.
3. Durable checkpoints resume safely; exhausted or invalid resolution transitions to fallback, DLQ, or `BLOCKED`, never an infinite loop.
4. Every transition has trace/audit data for reason, tool, artifact version, input/output references, and redaction status.

## Tasks / Subtasks

- [ ] Define canonical typed outcome, missing-input requirement, resolver decision, state-transition, and audit contracts. (AC: 1, 4)
- [ ] Implement resolver allow-list/PBAC/idempotency/retry-budget validation and durable checkpoint/resume behavior. (AC: 2, 3)
- [ ] Implement retry, fallback, DLQ, and blocking policy; add transition, resume, exhaustion, and redaction integration tests. (AC: 3, 4)

## Dev Notes

- Official execution artifact: `docs/implementation-artifacts/ao-3-orchestrate-typed-missing-input-resolution.md`.
- The orchestrator only coordinates tool capabilities defined in AO-2. It must not make direct source access, arbitrary tool calls, or unrecorded recovery decisions.
- `NEEDS_INPUT` is a typed request to resolve a specific requirement. Resolution is permitted only when the required workflow state, artifact version, scope, and authorization remain valid.
- Checkpoints persist safe state references and hashes, not raw source, prompts, secrets, or full tool payloads. Replay must be idempotent under the same correlation/idempotency key.
- A resolver cannot claim `READY` merely because a retry ran; it must produce the required evidence references or emit a bounded terminal/degraded outcome.

### Tool Catalog Coverage

- Implement the catalog resolver map as typed orchestration policy: technical signal (`search_evidence` → `trace_static_flow` → `request_targeted_reanalysis`), wizard contradiction (`compare_wizard_claim` → `get_reconciliation_context`), legal basis/citation (`retrieve_legal_basis` → `get_legal_rule_match` → `validate_citation_set`), corpus recovery, and gap evidence (`get_gap_evidence_trace` → owning-layer resolver).
- The orchestrator does not implement tool-specific business logic. It validates and dispatches only the catalog sequence permitted for the missing requirement, then checkpoints the safe result.
- Per-tool implementation tasks: `docs/implementation/tasks/modules/agentic-evidence-tools/artifact-wizard-conflict-tools.md`, `legal-classification-gap-tools.md`, and `legal-corpus-recovery-tools.md`.
- AO-3 owns the protected transitions missing from the read-tool catalog: `reconcile_profile_to_verified_profile`, `submit_classification_for_independent_review`, and `resolve_independent_classification_review`. These packets are under `docs/implementation/tasks/modules/agentic-evidence-tools/packets/ao-3-*.md`; none is LLM-callable.
- A `VerifiedProfile` is persisted only after accepted immutable inputs and no open conflict. A reviewed `Classification` is persisted only by an authorized independent reviewer; proposal validation and review-request submission never approve it.

### Expected Files

- `packages/contracts/src/agentic-evidence/*`
- `deepagents/tools/common/platform/graph_runtime.py` and orchestration modules
- `apps/api/src/modules/*` for PBAC, audit/outbox, and durable workflow projection seams
- orchestration contract and integration tests

### Verification Requirements

- Test every outcome and transition, including denied/unknown resolver, stale artifact version, duplicate dispatch, checkpoint recovery, retry-budget exhaustion, fallback, and DLQ.
- Assert persisted traces use safe references and redaction metadata only.
- Run worker and API suites affected by the state/checkpoint boundary.

### References

- [Source: docs/specs/spec-agentic-evidence-orchestration/SPEC.md]
- [Source: docs/specs/spec-agentic-evidence-orchestration/orchestration-state-machine.md]
- [Source: docs/specs/spec-agentic-evidence-orchestration/tool-catalog.md]
- [Source: docs/implementation/decisions/trusted-scan-trigger-retry-dlq-replay-decision.md]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Completion Notes List

- Created from the LCSP-160 Jira Story and the authoritative orchestration state machine.

### File List

- docs/implementation-artifacts/ao-3-orchestrate-typed-missing-input-resolution.md

## Change Log

- 2026-08-11: Created AO-3 execution artifact.
