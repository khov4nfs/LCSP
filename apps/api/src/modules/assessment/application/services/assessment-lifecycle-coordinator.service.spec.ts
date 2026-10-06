import { describe, expect, it, jest } from "@jest/globals";
import {
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_LIFECYCLE_STATES,
  type AssessmentLifecycleState,
} from "@lcsp/contracts/assessment";
import { HttpStatus } from "@nestjs/common";
import { AssessmentEventType, Prisma } from "@prisma/client";

import {
  AssessmentLifecycleCoordinator,
  type AssessmentLifecycleTransitionInput,
} from "./assessment-lifecycle-coordinator.service.js";

const ASSESSMENT_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "owner-1";
const THREAD_ID = "22222222-2222-4222-8222-222222222222";
const EVENT_ID = "123e4567-e89b-12d3-a456-426614174000";

type Fixture = ReturnType<typeof buildFixture>;
type WriteArgs = {
  where?: Record<string, unknown>;
  data: Record<string, unknown>;
};
type UpdateManyArgs = {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
};
type AssessmentLookup = {
  ownerId: string;
  lifecycleState?: AssessmentLifecycleState | null;
  lifecycleRevision?: number | null;
};

function buildFixture(
  options: {
    state?: AssessmentLifecycleState;
    revision?: number;
    sequence?: number;
    priorEvent?: Record<string, unknown> | null;
    failOutbox?: boolean;
  } = {},
) {
  const assessment = {
    id: ASSESSMENT_ID,
    ownerId: OWNER_ID,
    lifecycleState: options.state ?? ASSESSMENT_LIFECYCLE_STATES.CREATED,
    lifecycleRevision: options.revision ?? 0,
  };
  const runtime = {
    assessmentId: ASSESSMENT_ID,
    threadId: THREAD_ID,
    eventSequence: options.sequence ?? 0,
  };
  const snapshot = {
    assessment: { ...assessment },
    runtime: { ...runtime },
  };
  const assessmentEventFindUnique =
    jest.fn<(args: unknown) => Promise<Record<string, unknown> | null>>();
  assessmentEventFindUnique.mockResolvedValue(options.priorEvent ?? null);
  const assessmentEventCreate =
    jest.fn<(args: WriteArgs) => Promise<Record<string, unknown>>>();
  assessmentEventCreate.mockImplementation(({ data }) => Promise.resolve(data));
  const assessmentFindUnique =
    jest.fn<(args: unknown) => Promise<AssessmentLookup | null>>();
  assessmentFindUnique.mockResolvedValue({ ownerId: OWNER_ID });
  const assessmentUpdateMany =
    jest.fn<(args: UpdateManyArgs) => Promise<{ count: number }>>();
  assessmentUpdateMany.mockImplementation(({ where, data }) => {
    if (
      assessment.lifecycleState !== where.lifecycleState ||
      assessment.lifecycleRevision !== where.lifecycleRevision
    ) {
      return Promise.resolve({ count: 0 });
    }
    Object.assign(assessment, data);
    return Promise.resolve({ count: 1 });
  });
  const runtimeUpdate =
    jest.fn<
      (args: {
        where: { assessmentId: string };
        data: { eventSequence: number };
      }) => Promise<typeof runtime>
    >();
  runtimeUpdate.mockImplementation(({ data }) => {
    runtime.eventSequence = data.eventSequence;
    return Promise.resolve(runtime);
  });
  const assessmentUpdate =
    jest.fn<(args: WriteArgs) => Promise<typeof assessment>>();
  assessmentUpdate.mockResolvedValue(assessment);
  const runtimeCreate = jest.fn<(args: WriteArgs) => Promise<typeof runtime>>();
  runtimeCreate.mockResolvedValue(runtime);
  const outboxEnqueue =
    jest.fn<(input: unknown, tx: unknown) => Promise<string>>();
  outboxEnqueue.mockImplementation(() => {
    if (options.failOutbox) return Promise.reject(new Error("outbox failed"));
    return Promise.resolve("outbox-message-1");
  });
  const queryRaw = jest.fn<() => Promise<unknown[]>>();
  queryRaw
    .mockResolvedValueOnce([{ ...assessment }])
    .mockResolvedValueOnce([{ ...runtime }]);
  const tx = {
    assessmentEvent: {
      findUnique: assessmentEventFindUnique,
      create: assessmentEventCreate,
    },
    assessment: {
      findUnique: assessmentFindUnique,
      update: assessmentUpdate,
      updateMany: assessmentUpdateMany,
    },
    assessmentRuntime: {
      create: runtimeCreate,
      update: runtimeUpdate,
    },
    $queryRaw: queryRaw,
  };
  const prisma = {
    $transaction: jest.fn(
      async (callback: (transaction: typeof tx) => unknown) => {
        try {
          return await callback(tx);
        } catch (error) {
          Object.assign(assessment, snapshot.assessment);
          Object.assign(runtime, snapshot.runtime);
          throw error;
        }
      },
    ),
  };
  return {
    coordinator: new AssessmentLifecycleCoordinator(
      prisma as never,
      { enqueue: outboxEnqueue } as never,
    ),
    tx,
    prisma,
    assessment,
    runtime,
    outboxEnqueue,
  };
}

function transitionInput(
  fixture: Fixture,
  overrides: Partial<AssessmentLifecycleTransitionInput> = {},
): AssessmentLifecycleTransitionInput {
  return {
    assessmentId: ASSESSMENT_ID,
    expectedRevision: fixture.assessment.lifecycleRevision,
    toState: ASSESSMENT_LIFECYCLE_STATES.PREPARING,
    correlationId: "corr-1",
    eventId: EVENT_ID,
    actorId: OWNER_ID,
    ...overrides,
  };
}

describe("AssessmentLifecycleCoordinator", () => {
  it("initializes the canonical lifecycle and root runtime rows", async () => {
    const fixture = buildFixture();
    fixture.tx.assessment.findUnique.mockResolvedValueOnce({
      ownerId: OWNER_ID,
      lifecycleState: null,
      lifecycleRevision: null,
    });

    const result = await fixture.coordinator.initialize({
      assessmentId: ASSESSMENT_ID,
      ownerId: OWNER_ID,
      rootAgentVersion: "assessment-root-v2",
      checkpointNamespace: ASSESSMENT_ID,
      correlationId: "corr-1",
    });

    expect(result).toMatchObject({
      assessmentId: ASSESSMENT_ID,
      lifecycleState: ASSESSMENT_LIFECYCLE_STATES.CREATED,
      lifecycleRevision: 0,
    });
    expect(fixture.tx.assessment.update).toHaveBeenCalledWith({
      where: { id: ASSESSMENT_ID },
      data: {
        lifecycleState: ASSESSMENT_LIFECYCLE_STATES.CREATED,
        lifecycleRevision: 0,
      },
    });
    expect(fixture.tx.assessmentRuntime.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assessmentId: ASSESSMENT_ID,
          rootAgentVersion: "assessment-root-v2",
          checkpointNamespace: ASSESSMENT_ID,
        }),
      }),
    );
  });

  it("enforces the exact shared transition table", async () => {
    const fixture = buildFixture();

    await expect(
      fixture.coordinator.transition(
        transitionInput(fixture, {
          toState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
        }),
      ),
    ).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
    });
    expect(fixture.tx.assessment.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a stale revision before any lifecycle or event write", async () => {
    const fixture = buildFixture({ revision: 4 });

    await expect(
      fixture.coordinator.transition(
        transitionInput(fixture, { expectedRevision: 3 }),
      ),
    ).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
    });
    expect(fixture.tx.assessment.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.assessmentRuntime.update).not.toHaveBeenCalled();
    expect(fixture.outboxEnqueue).not.toHaveBeenCalled();
    expect(fixture.tx.assessmentEvent.create).not.toHaveBeenCalled();
  });

  it("commits one ordered event and outbox record with the next sequence", async () => {
    const fixture = buildFixture({ sequence: 7 });

    const result = await fixture.coordinator.transition(
      transitionInput(fixture),
    );

    expect(result).toMatchObject({
      assessmentId: ASSESSMENT_ID,
      threadId: THREAD_ID,
      eventId: EVENT_ID,
      sequence: 8,
      fromState: ASSESSMENT_LIFECYCLE_STATES.CREATED,
      toState: ASSESSMENT_LIFECYCLE_STATES.PREPARING,
      assessmentRevision: 1,
    });
    expect(fixture.tx.assessmentRuntime.update).toHaveBeenCalledWith({
      where: { assessmentId: ASSESSMENT_ID },
      data: { eventSequence: 8 },
    });
    expect(
      fixture.tx.assessment.updateMany.mock.calls[0]?.[0].data.blockerReference,
    ).toBe(Prisma.DbNull);
    expect(fixture.outboxEnqueue).toHaveBeenCalledTimes(1);
    expect(fixture.tx.assessmentEvent.create).toHaveBeenCalledTimes(1);
    expect(fixture.outboxEnqueue.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.tx.assessmentEvent.create.mock.invocationCallOrder[0],
    );
    expect(
      fixture.tx.assessmentEvent.create.mock.calls[0][0].data,
    ).toMatchObject({
      eventId: EVENT_ID,
      assessmentId: ASSESSMENT_ID,
      threadId: THREAD_ID,
      sequence: 8,
      actorType: ASSESSMENT_EVENT_ACTOR_TYPES.API,
      outboxMessageId: "outbox-message-1",
    });
    expect(fixture.outboxEnqueue.mock.calls[0][0]).toMatchObject({
      eventType: ASSESSMENT_EVENT_TYPES.lifecycleChangedOutbox,
      correlationId: "corr-1",
      causationId: EVENT_ID,
      assessmentId: ASSESSMENT_ID,
      payload: {
        assessmentEvent: expect.objectContaining({
          eventId: EVENT_ID,
          eventType:
            AGENTIC_ASSESSMENT_EVENT_TYPES.ASSESSMENT_LIFECYCLE_CHANGED,
        }),
      },
    });
  });

  it("replays an existing event idempotently without allocating a sequence", async () => {
    const fixture = buildFixture({
      priorEvent: {
        eventId: EVENT_ID,
        assessmentId: ASSESSMENT_ID,
        threadId: THREAD_ID,
        sequence: 3,
        timestamp: new Date("2026-10-06T00:00:00.000Z"),
        eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.ASSESSMENT_LIFECYCLE_CHANGED,
        actorType: ASSESSMENT_EVENT_ACTOR_TYPES.API,
        payload: {
          fromState: ASSESSMENT_LIFECYCLE_STATES.CREATED,
          toState: ASSESSMENT_LIFECYCLE_STATES.PREPARING,
          assessmentRevision: 1,
        },
      },
    });

    const result = await fixture.coordinator.transition(
      transitionInput(fixture),
    );

    expect(result.sequence).toBe(3);
    expect(result.assessmentRevision).toBe(1);
    expect(fixture.assessment.lifecycleRevision).toBe(0);
    expect(fixture.runtime.eventSequence).toBe(0);
    expect(fixture.tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(fixture.tx.assessmentRuntime.update).not.toHaveBeenCalled();
    expect(fixture.outboxEnqueue).not.toHaveBeenCalled();
    expect(fixture.tx.assessmentEvent.create).not.toHaveBeenCalled();
  });

  it("rechecks the event after the assessment lock for concurrent retries", async () => {
    const fixture = buildFixture();
    const committedEvent = {
      eventId: EVENT_ID,
      assessmentId: ASSESSMENT_ID,
      threadId: THREAD_ID,
      sequence: 1,
      timestamp: new Date("2026-10-06T00:00:00.000Z"),
      eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.ASSESSMENT_LIFECYCLE_CHANGED,
      actorType: ASSESSMENT_EVENT_ACTOR_TYPES.API,
      payload: {
        fromState: ASSESSMENT_LIFECYCLE_STATES.CREATED,
        toState: ASSESSMENT_LIFECYCLE_STATES.PREPARING,
        assessmentRevision: 1,
      },
    };
    fixture.tx.assessmentEvent.findUnique.mockResolvedValue(committedEvent);

    const result = await fixture.coordinator.transition(
      transitionInput(fixture),
    );

    expect(result.eventId).toBe(EVENT_ID);
    expect(result.sequence).toBe(1);
    expect(fixture.tx.assessment.updateMany).not.toHaveBeenCalled();
    expect(fixture.outboxEnqueue).not.toHaveBeenCalled();
    expect(fixture.tx.assessmentEvent.create).not.toHaveBeenCalled();
  });

  it("rejects replay when the committed event type is not lifecycle-owned", async () => {
    const fixture = buildFixture({
      priorEvent: {
        eventId: EVENT_ID,
        assessmentId: ASSESSMENT_ID,
        threadId: THREAD_ID,
        sequence: 1,
        timestamp: new Date("2026-10-06T00:00:00.000Z"),
        eventType: AssessmentEventType.ACTIVITY_RECORDED,
        actorType: ASSESSMENT_EVENT_ACTOR_TYPES.API,
        payload: {
          fromState: ASSESSMENT_LIFECYCLE_STATES.CREATED,
          toState: ASSESSMENT_LIFECYCLE_STATES.PREPARING,
          assessmentRevision: 1,
        },
      },
    });

    await expect(
      fixture.coordinator.transition(transitionInput(fixture)),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    expect(fixture.tx.assessment.updateMany).not.toHaveBeenCalled();
    expect(fixture.outboxEnqueue).not.toHaveBeenCalled();
  });

  it("rolls back the lifecycle and sequence when the outbox write fails", async () => {
    const fixture = buildFixture({ failOutbox: true });

    await expect(
      fixture.coordinator.transition(transitionInput(fixture)),
    ).rejects.toThrow("outbox failed");
    expect(fixture.assessment.lifecycleState).toBe(
      ASSESSMENT_LIFECYCLE_STATES.CREATED,
    );
    expect(fixture.assessment.lifecycleRevision).toBe(0);
    expect(fixture.runtime.eventSequence).toBe(0);
    expect(fixture.tx.assessmentEvent.create).not.toHaveBeenCalled();
  });
});
