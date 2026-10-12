# W1.3 Assessment lifecycle coordinator implementation

## Root cause

Assessment lifecycle state was not yet owned by one API writer: creation persisted only V1 status, runtime snapshots derived stage state from legacy artifacts and mutated stale scan jobs on read, and the detail/SSE surfaces did not read the accepted canonical ALS/AES rows.

## Fix

- Added `AssessmentLifecycleCoordinator` as the API-only canonical ALS writer.
  It initializes `Assessment` + `AssessmentRuntime`, validates the accepted transition table and server guard set, locks rows, performs expected-revision CAS, increments the per-assessment sequence, and persists the canonical `AssessmentEvent` and durable outbox record in one transaction.
- Added event-id replay handling, a post-lock replay check for concurrent duplicate requests, owner authorization, canonical-data refusal, blocker validation, and a CQRS transition command/handler.
- Routed assessment creation through coordinator initialization and `CREATED -> PREPARING`; no Prisma schema/migration files were changed.
- Changed GET detail and runtime snapshot/SSE projections to read persisted ALS/AES. Removed stage-lifecycle derivation and stale-scan write-on-read from workspace snapshot construction; legacy activity remains secondary and `stage_lifecycles` is now empty.
- Added focused API tests for initialization, guarded transitions, stale CAS, ordered sequence/event/outbox writes, sequential and concurrent idempotency, rollback, persisted GET state, canonical snapshot/SSE equality, and pure-read behavior.

## Verification

- `pnpm exec tsc -p apps/api/tsconfig.json --noEmit --pretty false` — PASS
- Changed API files ESLint — PASS
- Focused Jest: 5 suites, 64 tests — PASS
- `git diff --check` — PASS

Owned source changes are intentionally uncommitted. No Prisma, Python, web, legal-pipeline, or shared-contract files were changed; accepted W1.1/W1.2 dependencies remain the source of canonical values and persistence shape. Independent review is still required before acceptance.
