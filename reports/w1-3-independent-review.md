# W1.3 Independent Lifecycle Authority Review

Date: 2026-10-06
Scope: read-only review of the W1.3 owned diff, lifecycle callers, canonical API/SSE response shapes, transition guards, CAS/replay, transaction/event ordering, and pure reads.
Authority: `reports/architecture-freeze-migration-manifest.md` was read completely before this review.
Source/database changes: none. Existing worktree changes were preserved; only isolated review artifacts were created.

## Decision

**REQUEST_CHANGES — W1.3 is not proven and must not be accepted as the sole lifecycle authority.**

The shared transition matrix itself is correct, and focused unit checks pass, but the production path still has a new assessment creation bypass, accepts caller-supplied guard attestations without an owning verifier, has a concurrent replay/CAS ordering defect, bypasses the canonical outbox contract, and exposes divergent canonical GET/SSE shapes with empty/null fallbacks. Existing V1 status fields and web inference are recorded under their manifest owners below; they are not counted as W1.3 failures merely because their later cleanup wave has not run.

## Proven positive checks

- Static source search found no non-test `lifecycleState` writer outside `AssessmentLifecycleCoordinator`; canonical state writes are localized to its initialization/transition methods.
- The independent exact transition-table assertion passed for all frozen states/destinations, including mandatory CAS/event guards and the ACTIVE->FINALIZING completion guard.
- Focused unit coverage passed initialization, one illegal transition, stale rejection before writes, sequence allocation/order, rollback on outbox failure, pure canonical GET projection, and canonical snapshot/SSE projection. These remain mock/projection evidence, not production PostgreSQL proof.

## Freeze criteria used

- Manifest §3.1, lines 84-100: persisted `AssessmentLifecycleState` is the only customer-facing lifecycle; only `AssessmentLifecycleCoordinator` writes it; all lifecycle commands use its transition; GET/SSE/UI are read-only.
- Manifest §4, lines 166-191: one typed `AssessmentEvent` envelope, server-owned identity/order/actor fields, event-id idempotency, transactional sequence allocation, and no UI inference.
- Manifest §8, lines 291-304: V1 state is historical during migration and must not be promoted as canonical authority.
- Manifest §9, lines 311-334: no compatibility aliases, adapters, fallback routes, or duplicate lifecycle derivation in the final runtime.
- Manifest §11, lines 404-430: W5 API/web cutover and integration gate; failed gates block dependents.
- Manifest §12, lines 432-464: acceptance is production-shaped and remains NOT PROVEN until every required row passes.

## Findings

### F1 — BLOCKER / W1.3: optional coordinator DI permits a canonical-state bypass

Evidence:

- `apps/api/src/modules/assessment/application/commands/create-assessment/create-assessment.handler.ts:50-57` injects `AssessmentLifecycleCoordinator` with `@Optional()`.
- `.../create-assessment.handler.ts:113-139` saves the Assessment and invokes `initializeInTx` and `transitionInTx` only inside `if (this.lifecycle)`.
- The production module registers the provider at `apps/api/src/modules/assessment/assessment.module.ts:54-65`, but optional injection still allows a module/test/alternate composition without it to create a row with no canonical ALS, runtime row, or lifecycle event.
- The existing create test constructs the handler without the coordinator at `.../create-assessment.handler.spec.ts:17-60` and passes at lines 72-89; it asserts only the legacy V1 status.

Impact: a new assessment can be persisted through a conditional V1-only path. This directly violates the sole-authority/no-fallback rule and the creation contract requiring Assessment(CREATED), AssessmentRuntime, and CREATED->PREPARING.

Required ownership action: W1.3 must make the coordinator dependency mandatory and make initialization/transition unconditional inside the same transaction. The provider must fail startup if absent; no compatibility behavior is acceptable.

### F2 — BLOCKER / W1.3: transition guards are caller attestations, not verified authoritative guards

Evidence:

- `apps/api/src/modules/assessment/application/commands/transition-lifecycle/transition-lifecycle.command.ts:10-20` accepts arbitrary `verifiedGuards`.
- `.../transition-lifecycle.handler.ts:8-21` passes those values directly to the coordinator.
- `apps/api/src/modules/assessment/application/services/assessment-lifecycle-coordinator.service.ts:278-301` only appends the mandatory CAS/event guard and checks enum membership in the transition table; it does not resolve Completion Gate, artifact persistence, human-request state, input ownership, retry authorization, or cancellation authority from server-owned services.
- The contract explicitly says guard names are obligations and only an owning server boundary supplies verified evidence at `packages/contracts/src/assessment/agentic-runtime.ts:165-168`.

Isolated repro:

```
pnpm exec tsx /tmp/lcsp-w1-3-guard-repro.ts
# exit 0
# unchecked guard repro: PASS {"toState":"FINALIZING","eventLookups":2}
```

The repro supplied only `COMPLETION_GATE_ZERO_BLOCKERS` and `ARTIFACT_PERSISTED_AND_VALIDATED` to an ACTIVE->FINALIZING call; the coordinator accepted the transition without any Completion Gate or artifact service. This is an acceptance failure even though the command adapter is currently internal: the claimed verification boundary is not implemented or wired.

Required ownership action: W1.3 must accept only server-derived guard results from the authoritative boundary and must fail closed when required evidence is absent. The transition command must not be an assertion tunnel.

### F3 — BLOCKER / W1.3: concurrent same-event replay checks stale CAS before replay

Evidence:

- The coordinator takes the assessment row lock at `.../assessment-lifecycle-coordinator.service.ts:207-225`.
- It compares the locked row revision with `expectedRevision` and throws stale at lines 235-243.
- Only after that stale check does it re-read `AssessmentEvent` for concurrent replay at lines 261-275.
- Therefore, when request A commits event E and revision N+1 while request B with the same eventId E and expectedRevision N is waiting on the lock, request B sees N+1, throws stale, and never reaches the committed-event replay.

Isolated repro:

```
pnpm exec tsx /tmp/lcsp-w1-3-replay-cas-repro.ts
# exit 0
# replay/CAS repro: PASS {"status":409,"eventLookups":1,"committedEventReread":false}
```

The existing unit test at `.../assessment-lifecycle-coordinator.service.spec.ts:300-326` fakes the locked row at the old revision, so it exercises the second lookup but not the actual post-commit lock/revision ordering. This violates the manifest event-id replay contract and leaves a retry with a committed event unable to return its committed result.

The first replay lookup is also before authorization of the requested transition, expected-revision validation, guard validation, and the row lock at lines 180-205. Reusing an existing eventId with a changed command therefore returns the old result instead of rejecting the changed command:

```
pnpm exec tsx /tmp/lcsp-w1-3-replay-command-repro.ts
# exit 0
# changed-command replay repro: PASS {"requestedToState":"CANCELLED","returnedToState":"PREPARING","requestedRevision":99,"returnedRevision":1}
```

This is not acceptable event-id idempotency: the same identity must replay only the same command, and a changed command must conflict.

Required ownership action: re-check the event identity after acquiring the lock before rejecting the stale revision, and add a production PostgreSQL concurrent test.

### F4 — BLOCKER / W1.3: canonical lifecycle event is persisted through an alternate outbox envelope

Evidence:

- The coordinator validates only the lifecycle payload at `.../assessment-lifecycle-coordinator.service.ts:339-355`.
- It directly calls `tx.outboxMessage.create` at lines 356-366 with raw `aggregateType`, `eventType`, `payload`, and `status`; it does not call the shared `OutboxRepository.enqueue` or `buildOutboxMessageInput`.
- `packages/contracts/src/outbox/outbox-message.types.ts:97-130` enforces canonical outbox event naming, payload sanitization, schema version, correlationId, causationId, actor, redaction status, and idempotency key.
- The publisher extracts authorization/provenance headers from `payload.actor` and `payload.correlationId` at `apps/api/src/platform/outbox/outbox-publisher.service.ts:333-356`. The coordinator's raw envelope has neither, so the published message has no user/correlation headers.
- The raw event routing key is `ASSESSMENT_LIFECYCLE_CHANGED`, whereas the shared outbox helper's canonical naming rule is `event.<domain>.<name>.v1` or `command.<domain>.<name>.v1`.
- `CANONICAL_ACTOR_TYPE` is hardcoded to `API` at `.../assessment-lifecycle-coordinator.service.ts:22-24`, while the raw outbox row omits the material outbox `actor` identity entirely; an owner check is not a persisted actor/provenance record.
- The raw persistence call also introduces literal `"ASSESSMENT"` and `"PENDING"` values at lines 360 and 364 instead of the shared contract constants/mappers.

Impact: the same lifecycle change has two incompatible contracts: the AssessmentEvent row/envelope and an outbox message that omits required delivery/provenance metadata. This loses the shared event-delivery boundary and cannot prove authorization, tenant/provenance, redaction, or replay metadata preservation.

Additional unchecked read path: `toResult` casts replayed JSON at `.../assessment-lifecycle-coordinator.service.ts:383-404` instead of parsing the full `assessmentEventSchema`; canonical SSE reads similarly expose `payload: unknown` without schema validation at `apps/api/src/platform/runtime-events/assessment-runtime-event.service.ts:1040-1084`.

Required ownership action: persist and enqueue one contract-valid server envelope through the shared outbox path, with all server-owned context fields, and parse the full event shape on replay/read.

### F5 — BLOCKER / W1.3: GET and SSE expose different canonical lifecycle/event shapes and silently fall back

Evidence:

- Direct GET maps lifecycle to `{ state, assessmentRevision, blocker }` at `apps/api/src/modules/assessment/application/queries/get-assessment/get-assessment.handler.ts:227-252`; runtime fields are snake_case at lines 254-281.
- SSE canonical snapshot maps lifecycle to `{ state, revision, blockerReason, blockerReference }` and runtime to camelCase at `apps/api/src/platform/runtime-events/assessment-runtime-event.service.ts:1017-1036`.
- The SSE controller maps event envelope fields to snake_case at `apps/api/src/modules/scan/presentation/http/workspace-runtime-events.controller.ts:138-158`.
- The shared lifecycle/event schemas require `assessmentRevision`, nested `blocker`, and camelCase envelope fields at `packages/contracts/src/assessment/agentic-runtime.ts:575-587` and `951-983`.

Isolated schema repro:

```
pnpm exec tsx /tmp/lcsp-w1-3-shape-repro.ts
# exit 0
# canonical shape repro: PASS {"lifecycleIssue":["assessmentRevision"],"eventIssue":["eventType"]}
```

The repro feeds the actual SSE projection shape to the shared schemas and gets rejection. This is not merely a web migration concern: API consumers cannot use one exact canonical contract across GET and SSE.

New fallback paths also undermine authority:

- `readCanonicalAssessments` returns an empty array when the Prisma model is unavailable at `assessment-runtime-event.service.ts:987-995`.
- `readCanonicalEvents` does the same at lines 1044-1052.
- Both readers use optional `unknown` casts instead of the generated Prisma delegates even though `AssessmentRuntime` and `AssessmentEvent` are in `schema.prisma`; this suppresses real schema/client errors and turns an unavailable canonical model into an empty authoritative response.
- The controller turns absent canonical arrays into `[]` via `data.canonicalAssessments ?? []` and `data.canonicalEvents ?? []` at `workspace-runtime-events.controller.ts:138-145`.
- GET returns `lifecycle: null` on invalid persisted canonical data at `get-assessment.handler.ts:235-251`, while retaining the legacy `status` at lines 121-126.

Required ownership action: define one canonical response contract and use it unchanged (or one explicitly validated presentation mapping) for direct GET and SSE. Missing/invalid canonical rows must fail closed or return a structured problem, never silently become empty/null canonical state.

### F6 — HIGH / W1.3 and W1 integration: lifecycle commands do not route through the coordinator

Evidence:

- `rg -n 'new TransitionAssessmentLifecycleCommand|commandBus.execute.*Transition|TransitionAssessmentLifecycleCommand' apps/api/src --glob '*.ts'` found only the command and handler definitions; no production caller dispatches the transition command.
- Customer pause routes to legacy runtime control instead of ALS transition: `apps/api/src/modules/assessment/presentation/http/assessment.controller.ts:297-309` and `apps/api/src/modules/assessment/presentation/http/assessment-runtime-control.controller.ts:48-80`.
- `apps/api/src/platform/runtime-events/assessment-runtime-control.service.ts:64-173` mutates `AssessmentRuntimeTurn` and emits the legacy pause/resume outbox event; it never invokes `AssessmentLifecycleCoordinator`.
- Continue reads the legacy V1 status to decide whether the assessment is finished at `apps/api/src/modules/assessment/application/services/assessment-pipeline-continuation.service.ts:67-80`.

This leaves pause/resume/continue and finalization without canonical ALS transitions and without paired AssessmentEvent rows. The manifest requires every create, runtime, HITL, input, pause, cancel, failure, retry, and finalization command to call the single coordinator transition.

Ownership split: the pre-existing V1 status/readiness fields and their cleanup are W5/W6 work, not counted here solely because they remain. They are still enumerated for cutover:

- Domain/status writers: `apps/api/src/modules/assessment/domain/entities/assessment.entity.ts:114-142`.
- Repository persistence/filtering: `apps/api/src/modules/assessment/infrastructure/persistence/prisma-assessment.repository.ts:70-120`.
- Complete-repository and AI-not-detected handlers: `.../complete-repository-setup.handler.ts:51-132`, `.../mark-ai-not-detected.handler.ts:75-140`.
- GET/list/readiness response fields: `get-assessment.handler.ts:121-126`, `assessment-detail.contract.ts:77-84`, `list-assessments.handler.ts:92-98`, `get-assessment-readiness.handler.ts:101-110`.
- Direct deletion/cancellation semantics remain a W7 retention/deletion owner concern at `apps/api/src/modules/assessment/application/commands/delete-assessment/delete-assessment.handler.ts:30-90`; do not delete history prematurely.

### F7 — HIGH / acceptance evidence gap: unit mocks do not prove production CAS/transaction behavior

Focused checks pass:

```
NODE_OPTIONS=--experimental-vm-modules pnpm --dir apps/api exec jest --config ./jest.config.ts --runInBand --runTestsByPath \
  src/modules/assessment/application/services/assessment-lifecycle-coordinator.service.spec.ts \
  src/modules/assessment/application/queries/get-assessment/get-assessment.handler.spec.ts \
  src/platform/runtime-events/assessment-runtime-event.service.spec.ts \
  src/modules/scan/presentation/http/workspace-runtime-events.controller.spec.ts \
  src/modules/assessment/application/commands/create-assessment/create-assessment.handler.spec.ts
# exit 0: 5 suites, 64 tests passed
pnpm exec tsc -p apps/api/tsconfig.json --noEmit --pretty false
# exit 0
pnpm --dir apps/api exec eslint <W1.3 changed API files>
# exit 0
pnpm exec tsx <independent exact transition-matrix assertion>
# exit 0: independent transition matrix: PASS
git diff --check
# exit 0
```

The coordinator spec uses a fake transaction and fake row locks at `assessment-lifecycle-coordinator.service.spec.ts:35-143`; it covers initialization, one illegal edge, stale rejection, sequence/order, replay, a mocked concurrent reread, and rollback at lines 164-340. It does not exercise all legal/illegal edges, real PostgreSQL lock ordering, concurrent transactions, canonical outbox metadata, or HTTP GET/SSE contract equivalence. The independent matrix assertion proves the frozen table, not the coordinator's production guard authority or transaction behavior. W1.3 therefore cannot claim the manifest's production acceptance rows from these tests alone.

## Durable reproduction source (inline)

The exact scratch files used for the positive repro commands are reproduced below with repository-relative imports. A reviewer can save each block as a temporary TypeScript file at the repository root and run the shown `pnpm exec tsx` command; the report does not depend on a `/tmp` file.

### Guard trust repro

Command: `pnpm exec tsx ./lcsp-w1-3-guard-repro.ts` (observed exit 0; `unchecked guard repro: PASS`).

```ts
import {
  AGENTIC_RUNTIME_TRANSITION_GUARDS,
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "./packages/contracts/src/assessment/agentic-runtime.ts";
import { AssessmentLifecycleCoordinator } from "./apps/api/src/modules/assessment/application/services/assessment-lifecycle-coordinator.service.ts";

const assessmentId = "assessment-guard-repro";
const ownerId = "owner-guard-repro";
const threadId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
let eventLookups = 0;
const tx = {
  assessmentEvent: {
    findUnique: async () => {
      eventLookups += 1;
      return null;
    },
    create: async ({ data }: { data: unknown }) => data,
  },
  assessment: {
    findUnique: async () => ({ ownerId }),
    updateMany: async () => ({ count: 1 }),
  },
  assessmentRuntime: {
    update: async () => ({}),
  },
  outboxMessage: {
    create: async () => ({}),
  },
  $queryRaw: async (query: unknown) =>
    String(query).includes('"AssessmentRuntime"')
      ? [{ assessmentId, threadId, eventSequence: 0 }]
      : [{ id: assessmentId, ownerId, lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE, lifecycleRevision: 0 }],
};
const prisma = { $transaction: async (callback: (value: typeof tx) => unknown) => callback(tx) };
const coordinator = new AssessmentLifecycleCoordinator(prisma as never);

async function main() {
const result = await coordinator.transition({
  assessmentId,
  actorId: ownerId,
  expectedRevision: 0,
  toState: ASSESSMENT_LIFECYCLE_STATES.FINALIZING,
  correlationId: "corr-guard-repro",
  eventId,
  verifiedGuards: [
    AGENTIC_RUNTIME_TRANSITION_GUARDS.COMPLETION_GATE_ZERO_BLOCKERS,
    AGENTIC_RUNTIME_TRANSITION_GUARDS.ARTIFACT_PERSISTED_AND_VALIDATED,
  ],
});

if (result.toState !== ASSESSMENT_LIFECYCLE_STATES.FINALIZING || eventLookups !== 2) {
  throw new Error(`unexpected result: ${JSON.stringify({ result, eventLookups })}`);
}
console.log("unchecked guard repro: PASS", JSON.stringify({ toState: result.toState, eventLookups }));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

```

### Concurrent replay/CAS repro

Command: `pnpm exec tsx ./lcsp-w1-3-replay-cas-repro.ts` (observed exit 0; `replay/CAS repro: PASS`).

```ts
import {
  AGENTIC_RUNTIME_TRANSITION_GUARDS,
  ASSESSMENT_LIFECYCLE_STATES,
} from "./packages/contracts/src/assessment/agentic-runtime.ts";
import { AssessmentLifecycleCoordinator } from "./apps/api/src/modules/assessment/application/services/assessment-lifecycle-coordinator.service.ts";

const assessmentId = "assessment-replay-cas-repro";
const ownerId = "owner-replay-cas-repro";
const eventId = "33333333-3333-4333-8333-333333333333";
let eventLookups = 0;
const tx = {
  assessmentEvent: {
    findUnique: async () => {
      eventLookups += 1;
      return eventLookups === 1
        ? null
        : {
            eventId,
            assessmentId,
            threadId: "44444444-4444-4444-8444-444444444444",
            sequence: 1,
            payload: {
              fromState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
              toState: ASSESSMENT_LIFECYCLE_STATES.FINALIZING,
              assessmentRevision: 1,
            },
          };
    },
    create: async ({ data }: { data: unknown }) => data,
  },
  assessment: {
    findUnique: async () => ({ ownerId }),
    updateMany: async () => ({ count: 1 }),
  },
  assessmentRuntime: { update: async () => ({}) },
  outboxMessage: { create: async () => ({}) },
  $queryRaw: async (query: unknown) => {
    const text = String(query);
    return text.includes('"AssessmentRuntime"')
      ? [{ assessmentId, threadId: "44444444-4444-4444-8444-444444444444", eventSequence: 1 }]
      : [{ id: assessmentId, ownerId, lifecycleState: ASSESSMENT_LIFECYCLE_STATES.FINALIZING, lifecycleRevision: 1 }];
  },
};
const prisma = { $transaction: async (callback: (value: typeof tx) => unknown) => callback(tx) };
const coordinator = new AssessmentLifecycleCoordinator(prisma as never);

async function main() {
  try {
    await coordinator.transition({
      assessmentId,
      actorId: ownerId,
      expectedRevision: 0,
      toState: ASSESSMENT_LIFECYCLE_STATES.FINALIZING,
      correlationId: "corr-replay-cas-repro",
      eventId,
      verifiedGuards: [
        AGENTIC_RUNTIME_TRANSITION_GUARDS.COMPLETION_GATE_ZERO_BLOCKERS,
      ],
    });
    throw new Error("expected stale CAS rejection");
  } catch (error) {
    const status = typeof (error as { getStatus?: () => number }).getStatus === "function"
      ? (error as { getStatus: () => number }).getStatus()
      : undefined;
    if (status !== 409 || eventLookups !== 1) {
      throw new Error(`unexpected replay/CAS behavior: ${JSON.stringify({ status, eventLookups })}`);
    }
    console.log("replay/CAS repro: PASS", JSON.stringify({ status, eventLookups, committedEventReread: false }));
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

```

### Changed-command replay repro

Command: `pnpm exec tsx ./lcsp-w1-3-replay-command-repro.ts` (observed exit 0; `changed-command replay repro: PASS`).

```ts
import {
  AGENTIC_RUNTIME_TRANSITION_GUARDS,
  ASSESSMENT_LIFECYCLE_STATES,
} from "./packages/contracts/src/assessment/agentic-runtime.ts";
import { AssessmentLifecycleCoordinator } from "./apps/api/src/modules/assessment/application/services/assessment-lifecycle-coordinator.service.ts";

const assessmentId = "assessment-replay-command-repro";
const ownerId = "owner-replay-command-repro";
const eventId = "66666666-6666-4666-8666-666666666666";
const tx = {
  assessmentEvent: {
    findUnique: async () => ({
      eventId,
      assessmentId,
      threadId: "77777777-7777-4777-8777-777777777777",
      sequence: 1,
      payload: {
        fromState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
        toState: ASSESSMENT_LIFECYCLE_STATES.PREPARING,
        assessmentRevision: 1,
      },
    }),
    create: async ({ data }: { data: unknown }) => data,
  },
  assessment: { findUnique: async () => ({ ownerId }) },
  assessmentRuntime: { update: async () => ({}) },
  outboxMessage: { create: async () => ({}) },
  $queryRaw: async () => [],
};
const prisma = { $transaction: async (callback: (value: typeof tx) => unknown) => callback(tx) };
const coordinator = new AssessmentLifecycleCoordinator(prisma as never);

async function main() {
  const result = await coordinator.transition({
    assessmentId,
    actorId: ownerId,
    expectedRevision: 99,
    toState: ASSESSMENT_LIFECYCLE_STATES.CANCELLED,
    correlationId: "corr-replay-command-repro",
    eventId,
    verifiedGuards: [
      AGENTIC_RUNTIME_TRANSITION_GUARDS.EXPLICIT_CANCELLATION_BEFORE_PUBLICATION,
    ],
  });
  if (result.toState !== ASSESSMENT_LIFECYCLE_STATES.PREPARING || result.assessmentRevision !== 1) {
    throw new Error(`unexpected changed-command replay result: ${JSON.stringify(result)}`);
  }
  console.log("changed-command replay repro: PASS", JSON.stringify({ requestedToState: ASSESSMENT_LIFECYCLE_STATES.CANCELLED, returnedToState: result.toState, requestedRevision: 99, returnedRevision: result.assessmentRevision }));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

```

### GET/SSE shape repro

Command: `pnpm exec tsx ./lcsp-w1-3-shape-repro.ts` (observed exit 0; `canonical shape repro: PASS`).

```ts
import {
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  ASSESSMENT_LIFECYCLE_STATES,
  assessmentEventSchema,
  assessmentLifecycleSchema,
} from "./packages/contracts/src/assessment/agentic-runtime.ts";

const uuid = "55555555-5555-4555-8555-555555555555";
const sseLifecycle = {
  state: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
  revision: 3,
  blockerReason: null,
  blockerReference: null,
};
const sseEvent = {
  event_id: uuid,
  assessment_id: uuid,
  thread_id: uuid,
  sequence: 4,
  timestamp: "2026-10-06T00:00:00.000Z",
  event_type: AGENTIC_ASSESSMENT_EVENT_TYPES.ASSESSMENT_LIFECYCLE_CHANGED,
  actor_type: ASSESSMENT_EVENT_ACTOR_TYPES.API,
  execution_id: null,
  parent_execution_id: null,
  task_id: null,
  tool_call_id: null,
  payload: {
    fromState: ASSESSMENT_LIFECYCLE_STATES.PREPARING,
    toState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
    assessmentRevision: 3,
  },
};

const lifecycleResult = assessmentLifecycleSchema.safeParse(sseLifecycle);
const eventResult = assessmentEventSchema.safeParse(sseEvent);
if (lifecycleResult.success || eventResult.success) {
  throw new Error("expected SSE projection to fail the canonical contract schemas");
}
console.log(
  "canonical shape repro: PASS",
  JSON.stringify({
    lifecycleIssue: lifecycleResult.error.issues[0]?.path,
    eventIssue: eventResult.error.issues[0]?.path,
  }),
);

```

## Existing web inference — W1.4 ownership, not a W1.3-only failure

The API now emits `stage_lifecycles: []` at `apps/api/src/platform/runtime-events/assessment-runtime-event.service.ts:975-980`, but web still parses stage lifecycle and derives workflow status:

- `apps/web/src/features/workspace/utils/workspace-runtime-parser.ts:108-164` reads only `stage_lifecycles` and does not parse `canonical_assessments` or `canonical_events`.
- `apps/web/src/features/workspace/utils/assessment-runtime-adapter.ts:539-616` derives statuses from activity/runs/interview/scan artifacts.
- `.../assessment-runtime-adapter.ts:620-670` projects stage lifecycle into UI status, and lines 700-729 contain a legacy gate fallback.

This is explicitly W1.4 and must not be edited in this review. It blocks the W1 Integration Gate until replaced, but it is not used to downgrade W1.3 merely because W1.4 has not run.

## Response-shape inventory

Current direct GET `GET /assessments/:assessmentId` (wrapped in the standard result envelope by `assessment.controller.ts:346-364`) includes:

```
data: {
  assessment_id,
  name,
  status,                    // existing V1 status; W5 removal owner
  lifecycle: {
    state,
    assessmentRevision,
    blocker?
  } | null,
  runtime: {
    thread_id,
    root_agent_version,
    checkpoint_namespace,
    checkpoint_id,
    current_execution_id,
    execution_state,
    event_sequence,
    started_at,
    last_resumed_at,
    updated_at
  } | null,
  ...
}
```

Current SSE `workspace.runtime` includes legacy projections plus:

```
data: {
  stage_lifecycles: [],       // legacy/derived projection field
  canonical_assessments: [{
    assessment_id,
    lifecycle: { state, revision, blockerReason, blockerReference },
    runtime: { threadId, executionState, eventSequence, currentExecutionId, checkpointId, updatedAt }
  }],
  canonical_events: [{
    event_id,
    assessment_id,
    thread_id,
    sequence,
    timestamp,
    event_type,
    actor_type,
    execution_id,
    parent_execution_id,
    task_id,
    tool_call_id,
    payload
  }]
}
```

These are not one exact canonical lifecycle/event response shape. Canonical arrays can also become empty through optional model checks and nullish fallbacks. The V1 `status` field's survival is a W5 migration finding; the W1.3 failure is the newly introduced canonical fallback and GET/SSE divergence.

## Keep / no deletion

- KEEP the existing W1.3 source changes for coordinator, canonical reads, and tests pending owner fixes.
- DELETE none. No source files or user DB records were changed.
- Preserve V1 history and do not promote legacy status/event/stage values as canonical semantics.

## Isolated verification artifacts

- `/tmp/lcsp-w1-3-guard-repro.ts`
- `/tmp/lcsp-w1-3-replay-cas-repro.ts`
- `/tmp/lcsp-w1-3-replay-command-repro.ts`
- `/tmp/lcsp-w1-3-shape-repro.ts`
- This report: `/tmp/lcsp-w1-3-review.md`

---

## Post-repair independent acceptance review (2026-10-06)

### Decision: REQUEST_CHANGES

This is a fresh read-only acceptance review of the complete current W1.3/R1/R2
worktree state against accepted HEAD 5cc2ea8da; the original REQUEST_CHANGES
decision and all earlier evidence above are preserved. No production, test,
contract, Prisma, DB/WIP, commit, or history file was changed by this review;
only this post-repair section was appended. The coordinator repair closes F1-F4
and the reachable F6 authority bypass, and the production-shaped PostgreSQL
protocol is green, but F5 still has GET/SSE canonical absence/error parity
defects and the durable protocol test fails the shared import-policy check, so
W1.3 cannot be accepted.

### Scope and authority/caller trace

- Accepted comparison base: 5cc2ea8da (task_867e9f693ac9: prepare Assessment
  Root structural eval fixtures).
- Reviewed the tracked 20-file W1.3 diff plus the current untracked
  coordinator, transition command/handler, focused protocol runner, focused
  protocol test, and R2 persistence-repair artifacts. The current tracked diff
  is 1701 insertions and 235 deletions.
- Actual production canonical lifecycle callers found in the current source are
  create initialization/transition
  (apps/api/src/modules/assessment/application/commands/create-assessment/create-assessment.handler.ts:49-131),
  the transition adapter
  (.../commands/transition-lifecycle/transition-lifecycle.handler.ts:9-18),
  and runtime acknowledgement
  (apps/api/src/platform/runtime-events/assessment-runtime-control.service.ts:242-250,301-309).
  No direct canonical lifecycleState writer outside
  AssessmentLifecycleCoordinator was found in apps/api/src; V1 status writes
  remain later-wave/W5 scope.
- TransitionAssessmentLifecycleCommand has no caller-attested verifiedGuards
  input (.../transition-lifecycle.command.ts:10-20). W2/W3/W4 guard
  authorities remain unavailable; the coordinator's transition table therefore
  rejects those transitions rather than fabricating authority.
- The two actor-forwarding fields in
  assessment-interview-runtime.service.ts remain the only reviewed
  interview-service change. No semantic judge, alias, fallback lifecycle
  derivation, or Python mirror was introduced.

### F1-F7 boundary matrix

| Boundary | Result | Independent source/evidence |
| --- | --- | --- |
| F1 mandatory coordinator/creation | PASS | CreateAssessmentHandler requires AssessmentLifecycleCoordinator (create-assessment.handler.ts:49-55) and unconditionally calls initializeInTx then transitionInTx in its transaction (:113-131). The module registers the coordinator. Focused creation tests and API typecheck passed. |
| F2 server-derived guards | PASS | The transition command contains no guard-attestation field. AssessmentLifecycleCoordinator.transitionWithGuards adds only the canonical CAS/atomic-event guard (assessment-lifecycle-coordinator.service.ts:308-318); only the internal runtime acknowledgement path supplies the server-verified EXPLICIT_SAFE_PAUSE proof (:419-465). The contract guard table and W2/W3/W4 unavailable paths fail closed. |
| F3 lock/replay/CAS/changed command | PASS | Canonical assessment/runtime rows are locked with FOR UPDATE before event lookup (assessment-lifecycle-coordinator.service.ts:474-505); committed event replay is parsed and command-matched before stale CAS (:278-303), including assessment/thread/type/actor/to-state/revision/blocker matching (:666-689). PostgreSQL reproduced identical concurrent replay, changed-command conflict, stale CAS, and monotonic sequence behavior. |
| F4 atomic event/outbox transport | PASS | The coordinator uses buildOutboxMessageInput and OutboxRepository.enqueue in the same transaction before creating the canonical AssessmentEvent (assessment-lifecycle-coordinator.service.ts:386-410). The PostgreSQL protocol checked the strict envelope, canonical event type/actor, outbox metadata, FK linkage, and rollback atomicity. |
| F5 GET/SSE/snapshot canonical parity | REQUEST_CHANGES | Direct GET validates the lifecycle/runtime pair and requires checkpointNamespace === assessmentId (get-assessment.handler.ts:67-83,300-321). SSE readCanonicalAssessments starts from AssessmentRuntime rows only (assessment-runtime-event.service.ts:968-997), validates only the runtime schema (:999-1018), and never compares the namespace to row.assessmentId; it can therefore accept a valid but wrong namespace that GET rejects. It also omits a lifecycle-only/non-runtime row that GET treats as an invalid non-null/null pair. Finally, WorkspaceRuntimeEventsController.stream catches canonical snapshot/database errors and returns EMPTY (workspace-runtime-events.controller.ts:70-147), masking the required error instead of propagating the canonical problem. |
| F6 lifecycle mutation routing | PASS for the current W1.3 reachability boundary | Create and runtime acknowledgement route through the coordinator; pipeline continuation reads coordinator state and runtime resume fails closed before mutation while W3/W4 authority is unavailable (assessment-runtime-control.service.ts:146-155). No alternate canonical lifecycle writer was found. Future W2/W3/W4 transitions remain unavailable and are not represented as accepted implementation. |
| F7 production-shaped evidence/shared checks | REQUEST_CHANGES | The owned migrated PostgreSQL runner and all 88 focused tests pass, but check:imports exits 1 on five direct source-path imports in the durable protocol test. Unit success does not override the failed required shared check. |

### F5 parity repros

The shared canonical schemas are strict for field shape
(packages/contracts/src/evidence/assessment-runtime.ts:405-435), but they do
not encode the cross-row namespace identity rule. This exact isolated probe
demonstrates the resulting mismatch:

    rtk pnpm --dir apps/api exec tsx --eval 'import { assessmentRuntimeSchema } from "@lcsp/contracts/evidence"; const assessmentId = "11111111-1111-4111-8111-111111111111"; const wrongNamespace = "22222222-2222-4222-8222-222222222222"; const runtime = { threadId: "33333333-3333-4333-8333-333333333333", rootAgentVersion: "assessment-root-v2", checkpointNamespace: wrongNamespace, checkpointId: null, currentExecutionId: null, executionState: "RUNNING", eventSequence: 0, startedAt: null, lastResumedAt: null, updatedAt: "2026-10-06T00:00:00.000Z" }; const parsed = assessmentRuntimeSchema.safeParse(runtime); console.log(JSON.stringify({ sseRuntimeSchemaAccepts: parsed.success, getCanonicalBoundaryRejects: parsed.success && runtime.checkpointNamespace !== assessmentId }));'

Exit 0; output:
{"sseRuntimeSchemaAccepts":true,"getCanonicalBoundaryRejects":true}

The transport error masking was independently reproduced without changing a
test or source file:

    rtk pnpm --dir apps/api exec tsx --eval 'import { WorkspaceRuntimeEventsController } from "./src/modules/scan/presentation/http/workspace-runtime-events.controller.ts"; const controller = new WorkspaceRuntimeEventsController({ buildWorkspaceSnapshot: async () => { throw new Error("canonical-db-failure"); } }); const subscription = controller.stream({ rbacContext: { role: "CUSTOMER", userId: "owner" } } as never).subscribe({ next: () => { console.error("unexpected snapshot emission"); process.exit(2); }, error: (error) => { console.error("unexpected stream error", error); process.exit(3); } }); setTimeout(() => { subscription.unsubscribe(); console.log("masked-empty: PASS"); process.exit(0); }, 350);'

Exit 0; output included the controller warning followed by
masked-empty: PASS, with no stream error. This is exactly the prohibited
canonical DB-error masking path.

### Required checks and exact results

All commands below were run from
/home/khovan/orca/workspaces/LCSP/agentic-prod-integration; no /tmp artifact
was used as evidence for this post-repair decision. The older /tmp references
in the original section above are retained as history only.

    rtk node tests/assessment-lifecycle-migrated-db.mjs

Exit 0. The durable runner owns database lcsp_api_w13_r2_repair, never reads or
mutates the configured caller database, runs Prisma generate and ordered
migrate deploy, verifies all migrations and 16 deployed constraint/FK
assertions, then runs the protocol and runtime-control suites. Final output:

    PASS: 16 migration constraint assertions; ordered migrate deploy, lifecycle protocol, and five runtime-control tests passed on postgresql://postgres:postgres@127.0.0.1:55437/lcsp_api_w13_r2_repair?schema=public

    rtk run 'NODE_OPTIONS=--experimental-vm-modules pnpm --dir apps/api exec jest --config ./jest.config.ts --runInBand --runTestsByPath src/modules/assessment/application/services/assessment-lifecycle-coordinator.service.spec.ts src/platform/runtime-events/assessment-runtime-control.service.spec.ts src/platform/runtime-events/assessment-runtime-event.service.spec.ts src/modules/assessment/application/services/assessment-pipeline-continuation.service.spec.ts src/modules/assessment/application/commands/create-assessment/create-assessment.handler.spec.ts src/modules/assessment/application/queries/get-assessment/get-assessment.handler.spec.ts src/modules/scan/presentation/http/workspace-runtime-events.controller.spec.ts'

Exit 0; 7 suites and 88 tests passed.

    rtk pnpm --dir apps/api exec tsc -p tsconfig.json --noEmit --pretty false

Exit 0.

    rtk pnpm --dir packages/contracts exec tsc --noEmit --pretty false -p tsconfig.json

Exit 0.

Changed W1.3 API files were linted with:

    rtk pnpm --dir apps/api exec eslint src/modules/assessment/application/commands/create-assessment/create-assessment.handler.spec.ts src/modules/assessment/application/commands/create-assessment/create-assessment.handler.ts src/modules/assessment/application/commands/transition-lifecycle/transition-lifecycle.command.ts src/modules/assessment/application/commands/transition-lifecycle/transition-lifecycle.handler.ts src/modules/assessment/application/queries/get-assessment/get-assessment.handler.spec.ts src/modules/assessment/application/queries/get-assessment/get-assessment.handler.ts src/modules/assessment/application/services/assessment-interview-runtime.service.ts src/modules/assessment/application/services/assessment-lifecycle-coordinator.service.spec.ts src/modules/assessment/application/services/assessment-lifecycle-coordinator.service.ts src/modules/assessment/application/services/assessment-pipeline-continuation.service.spec.ts src/modules/assessment/application/services/assessment-pipeline-continuation.service.ts src/modules/assessment/application/services/assessment-pipeline-reconciliation.service.ts src/modules/assessment/assessment.module.ts src/modules/assessment/presentation/http/assessment-runtime-control.controller.ts src/modules/scan/presentation/http/workspace-runtime-events.controller.spec.ts src/modules/scan/presentation/http/workspace-runtime-events.controller.ts src/platform/runtime-events/assessment-runtime-control.service.spec.ts src/platform/runtime-events/assessment-runtime-control.service.ts src/platform/runtime-events/assessment-runtime-event.service.spec.ts src/platform/runtime-events/assessment-runtime-event.service.ts test/assessment-runtime-control.e2e-spec.ts

Exit 0.

    rtk pnpm run check:contracts

Exit 0; Contract literal policy passed.

    rtk pnpm run check:agentic-tools

Exit 0.

    rtk pnpm run check:imports

Exit 1. The durable tests/assessment-lifecycle-protocol.test.ts imports these
five workspace source paths directly, all rejected by the shared policy:

- ../apps/api/src/infrastructure/prisma/prisma.service.js
- ../apps/api/src/modules/assessment/application/services/assessment-lifecycle-coordinator.service.js
- ../apps/api/src/platform/outbox/outbox.repository.js
- ../apps/api/src/platform/runtime-events/assessment-runtime-control.service.js
- ../apps/api/src/platform/runtime-events/assessment-runtime-event.service.js

    rtk git diff --check HEAD

Exit 0 for the tracked current diff.

    rtk pnpm exec prettier --check tests/assessment-lifecycle-protocol.test.ts tests/assessment-lifecycle-migrated-db.mjs

Exit 0. The pre-existing untracked report history itself does not satisfy the
repository's Prettier check; it was intentionally not reformatted because this
review is append-only.

### Closure, remaining fix, and later-wave limits

To reach PASS, the W1.3 owner must make the canonical GET and SSE projection
share one persisted-row validation path: enumerate assessments with a
left-join/equivalent canonical pair check, reject any non-null lifecycle/runtime
partial pair, enforce the namespace-to-assessment identity in SSE, and let
canonical persistence/database/generated-client failures surface as the shared
problem rather than EMPTY. The durable protocol test must also cross the
approved import boundary so check:imports exits 0. Re-run the same owned
PostgreSQL runner, focused suites, typechecks, lint, and shared checks after
that repair, with a fresh independent review.

The following are explicitly not invented W1.3 dependencies: W2/W3/W4 native
guard authorities remain unavailable and must fail closed; W1.4 web lifecycle
inference and W5 V1 field cleanup remain their owners' pending work; additive
W1.2/V1 history remains preserved; absent canonical V1 data remains
unavailable/null; and no semantic evaluation, alias, compatibility bridge, or
fallback authority is accepted.

### Post-repair KEEP / DELETE

- KEEP the repaired coordinator, server-derived guard proof, lock/replay/CAS
  ordering, transaction-scoped outbox, runtime acknowledgement authority, and
  durable PostgreSQL evidence.
- KEEP the original review/task/dispatch history and all V1 migration history.
- DELETE none. This review changed only this report section.

---

## Closure review (2026-10-06)

### Decision: PASS

This is a fresh independent closure review of the complete current W1.3/R1/R2/R3/R4 worktree state against accepted HEAD `5cc2ea8da`, preserving the original review and all prior repair/task/dispatch identities. F5 canonical GET/SSE persistence/error parity and the F7 shared import-policy failure are closed with durable source and current-run evidence; no new W1.3 failure or regression was found. This review changed only this report by appending this section; production, tests, contracts, Prisma schema/migrations, databases/WIP, commits, pushes, and PR state were not changed.

### Closure matrix

| Boundary | Result | Current source and evidence |
| --- | --- | --- |
| F1 mandatory coordinator/creation | PASS | `CreateAssessmentHandler` requires `AssessmentLifecycleCoordinator` (`apps/api/src/modules/assessment/application/commands/create-assessment/create-assessment.handler.ts:49-56`) and unconditionally initializes the canonical pair then performs `CREATED -> PREPARING` in the same transaction (`:112-136`). The provider and transition handler are registered in `apps/api/src/modules/assessment/assessment.module.ts:48-65`. |
| F2 server-derived guards | PASS | `TransitionAssessmentLifecycleCommand` carries no `verifiedGuards` (`apps/api/src/modules/assessment/application/commands/transition-lifecycle/transition-lifecycle.command.ts:9-20`). The coordinator supplies only CAS/atomic-event proof on the generic path (`assessment-lifecycle-coordinator.service.ts:308-318`); runtime acknowledgement is the sole server-owned proof boundary (`:418-471`), and unavailable W2/W3/W4 guards fail closed. |
| F3 lock/replay/CAS/changed command | PASS | Assessment and runtime rows are locked with `FOR UPDATE` before event lookup (`assessment-lifecycle-coordinator.service.ts:474-506`); committed replay is re-read after the lock and before stale CAS (`:281-305`) and command-matched (`:666-689`). The real PostgreSQL protocol passed concurrent same-event replay, changed-command conflict, stale CAS, monotonic sequence, and rollback checks. |
| F4 atomic event/outbox transport | PASS | Lifecycle events use `buildOutboxMessageInput` and `OutboxRepository.enqueue` in the transaction (`assessment-lifecycle-coordinator.service.ts:369-414`) and persist the same strict `AssessmentEvent` envelope. The PostgreSQL protocol validated canonical event type/actor, outbox metadata, FK linkage, and atomic rollback. |
| F5 canonical GET/SSE/snapshot parity and error behavior | PASS | GET and workspace snapshots share `projectCanonicalAssessment` (`apps/api/src/platform/runtime-events/canonical-assessment-projection.ts:39-58`), which permits only the all-null unavailable pair, rejects partial/malformed pairs, validates canonical schemas, and enforces `checkpointNamespace === assessmentId` (`:60-128`). GET uses it at `get-assessment.handler.ts:72-77`; SSE reads generated Prisma `Assessment`/`AssessmentEvent` delegates and validates persisted rows at `assessment-runtime-event.service.ts:927-1017`. Snapshot failures become one terminal shared-problem SSE event, never `EMPTY`, at `workspace-runtime-events.controller.ts:163-217`. |
| F6 lifecycle mutation routing | PASS for the W1.3 reachability boundary | Current production lifecycle assignments are confined to `AssessmentLifecycleCoordinator`; create and runtime acknowledgement route through it, while future W2/W3/W4 authorities remain unavailable and fail closed. V1 status fields, W1.4 UI projection, and W5 legacy cleanup remain their explicit later-wave owners and are not reinterpreted as W1.3 failures. |
| F7 production-shaped/shared checks | PASS | The owned migrated PostgreSQL runner, focused API suites, API/contracts build/typecheck, changed-file lint, import policy, contract literal policy, agentic-tool policy, formatting, and diff checks all passed in this review. |

### Durable current-run checks

All commands ran from `/home/khovan/orca/workspaces/LCSP/agentic-prod-integration`; no `/tmp` artifact was used as evidence.

```text
rtk node tests/assessment-lifecycle-migrated-db.mjs
exit 0
prisma-generate: exit 0
migrate-deploy: exit 0
assessment-lifecycle-protocol: exit 0
assessment-runtime-control: exit 0
PASS: 96 ordered migrations; 16 deployed assertions (11 CHECK + 4 FK plus ordered migration application); lifecycle protocol and five runtime-control tests passed on the runner-owned lcsp_api_w13_r2_repair database.

rtk env NODE_OPTIONS=--experimental-vm-modules pnpm --dir apps/api exec jest --config ./jest.config.ts --runInBand --runTestsByPath src/modules/assessment/application/services/assessment-lifecycle-coordinator.service.spec.ts src/platform/runtime-events/assessment-runtime-control.service.spec.ts src/platform/runtime-events/assessment-runtime-event.service.spec.ts src/modules/assessment/application/services/assessment-pipeline-continuation.service.spec.ts src/modules/assessment/application/commands/create-assessment/create-assessment.handler.spec.ts src/modules/assessment/application/queries/get-assessment/get-assessment.handler.spec.ts src/modules/scan/presentation/http/workspace-runtime-events.controller.spec.ts
exit 0: 7 suites, 95 tests passed.

rtk pnpm --dir apps/api exec tsc -p tsconfig.json --noEmit --pretty false
exit 0.

rtk pnpm --dir packages/contracts exec tsc --noEmit --pretty false -p tsconfig.json
exit 0.

rtk pnpm --dir packages/contracts run build
exit 0.

rtk pnpm --dir apps/api exec eslint src/modules/assessment/application/commands/create-assessment/create-assessment.handler.spec.ts src/modules/assessment/application/commands/create-assessment/create-assessment.handler.ts src/modules/assessment/application/commands/transition-lifecycle/transition-lifecycle.command.ts src/modules/assessment/application/commands/transition-lifecycle/transition-lifecycle.handler.ts src/modules/assessment/application/queries/get-assessment/get-assessment.handler.spec.ts src/modules/assessment/application/queries/get-assessment/get-assessment.handler.ts src/modules/assessment/application/services/assessment-interview-runtime.service.ts src/modules/assessment/application/services/assessment-lifecycle-coordinator.service.spec.ts src/modules/assessment/application/services/assessment-lifecycle-coordinator.service.ts src/modules/assessment/application/services/assessment-pipeline-continuation.service.spec.ts src/modules/assessment/application/services/assessment-pipeline-continuation.service.ts src/modules/assessment/application/services/assessment-pipeline-reconciliation.service.ts src/modules/assessment/assessment.module.ts src/modules/assessment/presentation/http/assessment-runtime-control.controller.ts src/modules/scan/presentation/http/workspace-runtime-events.controller.spec.ts src/modules/scan/presentation/http/workspace-runtime-events.controller.ts src/platform/runtime-events/assessment-runtime-control.service.spec.ts src/platform/runtime-events/assessment-runtime-control.service.ts src/platform/runtime-events/assessment-runtime-event.service.spec.ts src/platform/runtime-events/assessment-runtime-event.service.ts test/assessment-runtime-control.e2e-spec.ts
exit 0.

rtk pnpm run check:imports
rtk pnpm run check:contracts
rtk pnpm run check:agentic-tools
exit 0 for each; import policy, contract literal policy, and agentic-tool runtime policy passed.

rtk git diff --check HEAD
exit 0.

rtk pnpm exec prettier --check apps/api/src/modules/assessment/application/services/assessment-lifecycle-coordinator.service.ts apps/api/src/platform/runtime-events/canonical-assessment-projection.ts apps/api/test/assessment-lifecycle-protocol.test.ts tests/assessment-lifecycle-migrated-db.mjs reports/w1-3-r3-canonical-read-repair.md
exit 0.

rtk git diff --name-only 5cc2ea8da -- apps/api/prisma/schema.prisma apps/api/prisma/migrations packages/contracts/src/assessment/agentic-runtime.ts
exit 0 with no paths; frozen W1.2 SQL/schema and W1.1 canonical values/transition table are unchanged against accepted HEAD.
```

### Durable parity/error probes

The durable source is `apps/api/test/assessment-lifecycle-protocol.test.ts:80-595`, `apps/api/src/modules/assessment/application/queries/get-assessment/get-assessment.handler.spec.ts:132-291`, `apps/api/src/platform/runtime-events/assessment-runtime-event.service.spec.ts:1271-1431`, and `apps/api/src/modules/scan/presentation/http/workspace-runtime-events.controller.spec.ts:327-364`. The current direct projection probe (`rtk pnpm exec tsx --eval ...`, exit 0) produced: wrong namespace `409 ASSESSMENT_REPOSITORY_SETUP_STATE_INVALID`; all-null pair accepted as `{ lifecycle:null, runtime:null }`; lifecycle-only and runtime-only pairs each rejected with `409 ASSESSMENT_REPOSITORY_SETUP_STATE_INVALID`. The current SSE probe (`rtk pnpm --dir apps/api exec tsx --eval ...`, exit 0) produced `type:error` with the shared `{ ok:false, problem:{ status:500, code:INTERNAL_ERROR, correlationId } }` envelope for a canonical database failure; raw failure text was not emitted.

### Scope limits and KEEP/DELETE

This PASS is limited to W1.3/R1/R2/R3/R4 local source and production-shaped evidence. It does not claim browser/W1.4 acceptance, full repository/remote CI, W2/W3/W4 guard-authority implementation, W5 V1 field deletion, or later-wave semantic/runtime integration. Historical review content, V1 migration history, canonical null/unavailable behavior, repaired coordinator/lock/replay/outbox path, shared projection, and durable protocol artifacts are KEEP; DELETE none.
