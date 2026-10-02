# Scanner/PGE → Initial Interview AI Discovery Gate

## Authority boundary

Scanner and the Program Evidence Graph own technical facts: invocation-shaped SDK calls,
outbound API candidates, call/data/control/config provenance, source anchors, coverage and
unresolved technical frontiers. Initial Interview owns Customer/runtime/business context.
Interview answers may supplement operational facts but never rewrite contradictory PGE
evidence. Legal applicability and compliance classification remain downstream.

The persisted Scanner projection is `evidence_payload.ai_discovery` with evidence states
`CONFIRMED_AI_CALL`, `POSSIBLE_AI_CALL`, `AI_PROVIDER_REFERENCE`, and
`UNRESOLVED_DYNAMIC`, and gate states `AI_CONFIRMED`, `AI_UNKNOWN`, and
`AI_ABSENT_CONFIRMED`. Provider/package/config presence alone is not model invocation.

## Producer and failure

`ai_discovery` is produced by ONE bounded AI-discovery Deep Agent task in the scan job
(Repository Analyst runtime, 2026-09-30; see `deepagents/FLOW.md`). It is an independent
prerequisite persisted with the technical evidence. A model/provider failure yields gate
`AI_UNKNOWN` with limitation `AI_DISCOVERY_FAILED`; the scan still completes, accepted rule
evidence is never destroyed, and rules gated on `aiDetected` become `UPSTREAM_FACT_PENDING`.

## Gate

`AI_CONFIRMED` requires governed invocation/API evidence. A model invocation whose runtime
guard cannot be resolved remains technically observed but operationally `AI_UNKNOWN` until
the Customer supplies the deployment fact. `AI_UNKNOWN` also covers AI-capable custom
gateways, provider references that still need technical resolution, material dynamic
frontiers, and non-READY technical coverage.

`AI_ABSENT_CONFIRMED` is legal only when PGE coverage is `READY` and there is no confirmed
or possible AI call, provider reference requiring clarification, or material AI dynamic
frontier. A missing signal under `PARTIAL`/`UNAVAILABLE` coverage is never absence proof.

Technical/resolvable uncertainty routes to targeted reanalysis. Customer-owned runtime or
business uncertainty becomes one bounded Interview question. When the deterministic absence
backstop contradicts a model-asserted `AI_ABSENT_CONFIRMED` with an AI SDK import or
dependency in product code, the full repository pass has already failed to trace a call, so
the reference is Customer-owned `OUTBOUND_AI_CONFIRMATION` (does the product use this SDK in
production?) rather than another technical pass; only a failed deterministic search stays a
technical frontier. Confirmed invocation skips
the redundant “is this AI?” question and asks purpose + Web/Mobile/API feature/module and
workflow context. An unresolved custom outbound candidate uses `Yes / No / Unsure`; a Yes
answer may provide the customer-hosted/provider identity as free text.

## Source snippets

PGE does not persist unrestricted source for Interview display. Each AI finding may persist
only a `snippet_ref`: pinned `snapshot_id`, `commit_sha`, `file_path`, optional symbol,
bounded `start_line`/`end_line`, `evidence_hash`, and
`PINNED_SNAPSHOT_BOUNDED_REDACTED_V1`. The canonical Interview question carries that
locator unchanged. Customer/Admin clients resolve it on demand through
`GET /assessments/:assessmentId/interview/questions/:questionId/source-snippet`; the API
reopens the exact completed pinned snapshot, verifies commit + full-file evidence hash,
returns at most 7 lines / 4096 UTF-8 bytes, and redacts secret-looking values before the
response leaves the governed boundary. Raw source is never written to PGE or Interview
state. API keys, tokens, passwords, credentials, or unrelated source are never returned.

## Idempotency

Clarification identity is derived from the pinned assessment/snapshot evidence identity and
clarification kind. Existing Interview session revision and answer-request idempotency then
prevent retry/resume from creating duplicate questions or context revisions.
