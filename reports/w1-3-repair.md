# W1.3 repair report

## Root cause

The unfinished W1.3 diff still allowed canonical-state bypasses: optional coordinator DI, caller-supplied guard attestations, stale-CAS-before-replay ordering, a raw outbox write, divergent canonical GET/SSE projections, and runtime-control acknowledgements that were not bound to the server-owned Root runtime. Continue could also enqueue a native resume before W3/W4 blocker authority existed, while lifecycle reads narrowed an already-authorized admin/service path to owner-only. Unit mocks also did not prove PostgreSQL row-lock ordering, event-id replay, sequence allocation, or transactional pairing.

## Fix

The repair makes coordinator DI and new-assessment initialization mandatory, keeps the frozen transition table as the only lifecycle vocabulary, derives acknowledgement authority from the persisted canonical runtime/current turn inside the owning transaction, and fails closed when later-wave proof is unavailable. It rechecks committed events after the assessment/runtime locks and before stale CAS, treats event sequence and ALS revision as independent counters, rejects changed command/type/scope reuse, writes the validated `AssessmentEvent` and shared outbox message atomically, and validates canonical GET/snapshot/SSE objects with the accepted schemas. Runtime Continue now rejects before turn/CAS/outbox mutation until W3/W4 supplies blocker/native proof, while authenticated owner/admin context and the existing visibility rule remain the only control/read authority.

## F1–F7 evidence

| Finding | Evidence in this repair                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1      | `AssessmentLifecycleCoordinator` is a required constructor dependency; create always calls `initializeInTx` and `transitionInTx` in the same transaction. The focused create spec asserts both calls.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| F2      | `verifiedGuards` and the public authority argument are gone. Ordinary transitions receive only the mandatory CAS/event guard; unavailable W2/W3/W4 guards fail closed. Runtime acknowledgement proof is read under Assessment then AssessmentRuntime locks and requires the canonical Root namespace/current execution/exact thread, persisted stop `requestId`, non-null checkpoint, `STOP_REQUESTED -> STOPPED`, and execution `PAUSED`; `INTERRUPTED` and unrequested stops fail closed. Runtime control side effects also require the authenticated owner (or an explicitly authenticated admin context), never a caller-supplied role/provenance assertion.                    |
| F3      | Assessment and runtime rows are locked before event lookup; committed-event replay is checked before stale CAS. Replay validates assessment/thread/event/actor/target/revision/blocker identity. PostgreSQL coverage includes distinct concurrent stale requests, simultaneous identical replay, changed command, changed event type (unit), and changed scope. Sequence and ALS revision are independently asserted (`sequence = 8`, `assessmentRevision = 1`).                                                                                                                                                                                                                    |
| F4      | Lifecycle delivery uses `buildOutboxMessageInput` and `OutboxRepository.enqueue(tx)`, with correlation, causation, actor, result, redaction, idempotency, and schema metadata. The strict validated domain event is preserved unchanged at `outbox.payload.assessmentEvent`; event/outbox/revision/sequence rollback is exercised by a real transaction.                                                                                                                                                                                                                                                                                                                            |
| F5      | GET and runtime snapshot/SSE use the shared canonical AES schema plus accepted lifecycle/event schemas and generated Prisma delegates. GET runtime fields now use the same camelCase canonical object as `canonicalAssessments`; invalid UUID/namespace/counter data, malformed non-null rows, and delegate failures reject/propagate, while genuinely absent V1 data remains explicit `null`/unavailable. The shared snapshot contract exposes canonical ALS/AES and strict AssessmentEvent fields, and SSE passes those nested objects unchanged.                                                                                                                                 |
| F6      | Create, runtime acknowledgement, and Continue boundaries route lifecycle changes through the coordinator. Runtime controls no longer create arbitrary turns or use a legacy status as lifecycle authority; `current()` and `request()` resolve only `AssessmentRuntime.currentExecutionId` and reject mismatched/other-thread turns. Continue fails closed before a fresh resume mutation while later blocker/native authority is unavailable, and lifecycle reads preserve the existing authenticated admin/service visibility path while foreign customers remain rejected. Reconciliation now filters canonical lifecycle states while leaving V1 history/status data untouched. |
| F7      | `tests/assessment-lifecycle-protocol.test.ts` runs the actual coordinator/control/Prisma path against the owned PostgreSQL database, covering row-lock CAS, replay, scope/type/command reuse, sequence/idempotency, paired event/outbox writes, rollback, fail-closed later guards, unavailable resume with no control/outbox mutation, unrequested stop, human interrupt, explicit pause proof, authorized admin/foreign-customer reads, and changed-current-turn rejection.                                                                                                                                                                                                       |

## Verification

All commands were run from the repository root with `rtk` as required.

```text
rtk proxy env LCSP_TEST_POSTGRES_PORT=55437 LCSP_TEST_POSTGRES_DB=lcsp_w13_repair LCSP_TEST_POSTGRES_USER=postgres LCSP_TEST_POSTGRES_PASSWORD=postgres node apps/api/test/scripts/ensure-test-postgres.mjs
exit 0

rtk proxy env DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55437/lcsp_w13_repair?schema=public pnpm --dir apps/api exec prisma db push --accept-data-loss
exit 0

rtk proxy env DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55437/lcsp_w13_repair?schema=public NODE_ENV=test NODE_OPTIONS=--experimental-vm-modules pnpm --dir apps/api exec tsx --test ../../tests/assessment-lifecycle-protocol.test.ts
exit 0: 1 test passed, 0 failed

rtk proxy env NODE_OPTIONS=--experimental-vm-modules pnpm --dir apps/api exec jest --config ./jest.config.ts --runInBand --runTestsByPath src/modules/assessment/application/services/assessment-lifecycle-coordinator.service.spec.ts src/modules/assessment/application/queries/get-assessment/get-assessment.handler.spec.ts src/platform/runtime-events/assessment-runtime-event.service.spec.ts src/modules/scan/presentation/http/workspace-runtime-events.controller.spec.ts src/modules/assessment/application/commands/create-assessment/create-assessment.handler.spec.ts src/platform/runtime-events/assessment-runtime-control.service.spec.ts src/modules/assessment/application/services/assessment-pipeline-continuation.service.spec.ts
exit 0: 7 suites passed, 88 tests passed

rtk proxy env DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55437/lcsp_api_w13_repair?schema=public NODE_ENV=test NODE_OPTIONS=--experimental-vm-modules pnpm --dir apps/api exec jest --config ./test/jest-e2e.ts --runInBand --runTestsByPath test/assessment-runtime-control.e2e-spec.ts
exit 0: 1 suite passed, 5 tests passed

rtk pnpm exec tsc -p apps/api/tsconfig.json --noEmit --pretty false
exit 0

rtk pnpm --dir apps/api exec eslint src/modules/assessment/application/commands/create-assessment src/modules/assessment/application/commands/transition-lifecycle src/modules/assessment/application/contracts/assessment/assessment-detail.contract.ts src/modules/assessment/application/queries/get-assessment src/modules/assessment/application/services/assessment-interview-runtime.service.ts src/modules/assessment/application/services/assessment-lifecycle-coordinator.service.ts src/modules/assessment/application/services/assessment-lifecycle-coordinator.service.spec.ts src/modules/assessment/application/services/assessment-pipeline-continuation.service.ts src/modules/assessment/application/services/assessment-pipeline-continuation.service.spec.ts src/modules/assessment/application/services/assessment-pipeline-reconciliation.service.ts src/modules/assessment/assessment.module.ts src/modules/assessment/presentation/http/assessment-runtime-control.controller.ts src/modules/scan/presentation/http/workspace-runtime-events.controller.ts src/modules/scan/presentation/http/workspace-runtime-events.controller.spec.ts src/platform/runtime-events/assessment-runtime-control.service.ts src/platform/runtime-events/assessment-runtime-control.service.spec.ts src/platform/runtime-events/assessment-runtime-event.service.ts src/platform/runtime-events/assessment-runtime-event.service.spec.ts test/assessment-runtime-control.e2e-spec.ts
exit 0

rtk pnpm exec prettier --check apps/api/src/modules/assessment/application/commands/create-assessment/create-assessment.handler.spec.ts apps/api/src/modules/assessment/application/commands/create-assessment/create-assessment.handler.ts apps/api/src/modules/assessment/application/contracts/assessment/assessment-detail.contract.ts apps/api/src/modules/assessment/application/queries/get-assessment/get-assessment.handler.spec.ts apps/api/src/modules/assessment/application/queries/get-assessment/get-assessment.handler.ts apps/api/src/modules/assessment/application/services/assessment-lifecycle-coordinator.service.spec.ts apps/api/src/modules/assessment/application/services/assessment-lifecycle-coordinator.service.ts apps/api/src/modules/assessment/application/services/assessment-pipeline-continuation.service.spec.ts apps/api/src/modules/assessment/application/services/assessment-pipeline-continuation.service.ts apps/api/src/modules/assessment/application/services/assessment-pipeline-reconciliation.service.ts apps/api/src/modules/assessment/assessment.module.ts apps/api/src/modules/assessment/presentation/http/assessment-runtime-control.controller.ts apps/api/src/modules/scan/presentation/http/workspace-runtime-events.controller.spec.ts apps/api/src/modules/scan/presentation/http/workspace-runtime-events.controller.ts apps/api/src/platform/runtime-events/assessment-runtime-control.service.spec.ts apps/api/src/platform/runtime-events/assessment-runtime-control.service.ts apps/api/src/platform/runtime-events/assessment-runtime-event.service.spec.ts apps/api/src/platform/runtime-events/assessment-runtime-event.service.ts apps/api/test/assessment-runtime-control.e2e-spec.ts apps/api/src/modules/assessment/application/commands/transition-lifecycle/transition-lifecycle.command.ts apps/api/src/modules/assessment/application/commands/transition-lifecycle/transition-lifecycle.handler.ts packages/contracts/src/assessment/events.ts tests/assessment-lifecycle-protocol.test.ts reports/w1-3-repair.md
exit 0

rtk pnpm run check:contracts
exit 0: Contract literal policy passed.

rtk pnpm --dir packages/contracts build
exit 0

rtk pnpm exec tsx --test tests/agentic-runtime-contracts.test.ts
exit 0: 5 tests passed, 0 failed

rtk git diff --check
exit 0
```

`rtk graphify update .` also completed and refreshed the incremental code graph; no full reindex or LLM labeling was run.

## Scope notes and remaining limits

- The exact adjacent production path authorized during repair was `apps/api/src/modules/assessment/application/services/assessment-pipeline-reconciliation.service.ts`; its focused behavior remains canonical-state-only.
- Coordinator explicitly extended ownership for only the two mechanical `runtimeControl.request` fields in `apps/api/src/modules/assessment/application/services/assessment-interview-runtime.service.ts`; both now forward the existing authenticated `input.actor`, with no other interview-runtime change.
- Mandatory coordinator DI also required a two-line constructor wiring update in `apps/api/test/assessment-runtime-control.e2e-spec.ts`; no behavior or fallback was added there.
- Runtime Continue remains intentionally unavailable until W3/W4 owns material-blocker and native resume proof; the durable E2E asserts repeated Continue attempts leave the stopped turn and outbox unchanged.
- No Prisma schema/migration, web, Python, legal, W1.1 test, backfill, cutover, or history deletion was performed.
- Root execution, HITL, Completion Gate, later-wave guard authorities, and full ordered delivery remain intentionally unavailable and fail closed; W1.4 remains blocked. This report does not claim production Root/HITL/completion acceptance.
