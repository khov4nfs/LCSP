import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  AGENT_EXECUTION_STATES,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  ASSESSMENT_LIFECYCLE_STATES,
  type AssessmentLifecycleState,
} from "@lcsp/contracts/assessment";
import { ASSESSMENT_EVENT_TYPES } from "@lcsp/contracts/assessment";
import { AUDIT_ACTOR_IDS, AUDIT_ACTOR_TYPES } from "@lcsp/contracts/audit";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  ASSESSMENT_RUNTIME_CONTROL_ACTIONS,
  ASSESSMENT_RUNTIME_CONTROL_STATES,
} from "@lcsp/contracts/evidence";

import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import { AssessmentLifecycleCoordinator } from "../src/modules/assessment/application/services/assessment-lifecycle-coordinator.service.js";
import { OutboxRepository } from "../src/platform/outbox/outbox.repository.js";
import { AssessmentRuntimeControlService } from "../src/platform/runtime-events/assessment-runtime-control.service.js";
import { AssessmentRuntimeEventService } from "../src/platform/runtime-events/assessment-runtime-event.service.js";

const EXPECTED_DATABASE_URL =
  "postgresql://postgres:postgres@127.0.0.1:55437/lcsp_api_w13_r2_repair?schema=public";

function assertDisposableDatabase(): void {
  assert.equal(
    process.env.DATABASE_URL,
    EXPECTED_DATABASE_URL,
    "assessment lifecycle protocol must use its owned disposable database",
  );
}

function statusOf(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null) {
    if ("status" in error && typeof error.status === "number")
      return error.status;
    if (hasStatusGetter(error)) {
      const status = error.getStatus();
      return typeof status === "number" ? status : undefined;
    }
  }
  return undefined;
}

function hasStatusGetter(value: object): value is { getStatus: () => unknown } {
  return "getStatus" in value && typeof value.getStatus === "function";
}

async function assertProblem(
  operation: Promise<unknown>,
  status: number,
): Promise<void> {
  await assert.rejects(
    operation,
    (error: unknown) => statusOf(error) === status,
  );
}

function transitionInput(
  assessmentId: string,
  ownerId: string,
  expectedRevision: number,
  eventId: string,
  toState: AssessmentLifecycleState = ASSESSMENT_LIFECYCLE_STATES.PREPARING,
) {
  return {
    assessmentId,
    expectedRevision,
    toState,
    correlationId: `protocol:${assessmentId}:${eventId}`,
    eventId,
    actorId: ownerId,
  };
}

void test("assessment lifecycle coordinator protocol uses real PostgreSQL transactions", async () => {
  assertDisposableDatabase();
  const prisma = new PrismaService();
  const assessmentIds: string[] = [];
  const ownerId = randomUUID();
  const otherOwnerId = randomUUID();
  const userIds = [ownerId, otherOwnerId];
  const outbox = new OutboxRepository(prisma);
  const coordinator = new AssessmentLifecycleCoordinator(prisma, outbox);
  const runtimeEvents = new AssessmentRuntimeEventService(prisma);
  const controls = new AssessmentRuntimeControlService(
    prisma,
    outbox,
    runtimeEvents,
    coordinator,
  );

  const createAssessment = async (owner = ownerId): Promise<string> => {
    const assessmentId = randomUUID();
    assessmentIds.push(assessmentId);
    await prisma.assessment.create({
      data: {
        id: assessmentId,
        ownerId: owner,
        name: `W1.3 protocol ${assessmentId}`,
      },
    });
    await coordinator.initialize({
      assessmentId,
      ownerId: owner,
      rootAgentVersion: "assessment-root-v2",
      checkpointNamespace: assessmentId,
      correlationId: `protocol:init:${assessmentId}`,
    });
    return assessmentId;
  };

  try {
    await prisma.$connect();
    await prisma.user.createMany({
      data: userIds.map((id, index) => ({
        id,
        email: `w13-protocol-${index}-${id}@example.test`,
        passwordHash: "protocol-only",
        emailVerified: true,
        failedLoginCount: 0,
      })),
    });

    const orderedAssessment = await createAssessment();
    await prisma.assessmentRuntime.update({
      where: { assessmentId: orderedAssessment },
      data: { eventSequence: 7 },
    });
    const orderedEventId = randomUUID();
    const orderedResult = await coordinator.transition(
      transitionInput(orderedAssessment, ownerId, 0, orderedEventId),
    );
    assert.equal(orderedResult.sequence, 8);
    assert.equal(orderedResult.assessmentRevision, 1);
    const orderedAssessmentRow = await prisma.assessment.findUniqueOrThrow({
      where: { id: orderedAssessment },
      select: {
        lifecycleState: true,
        lifecycleRevision: true,
        blockerReason: true,
        blockerReference: true,
      },
    });
    const orderedRuntimeRow = await prisma.assessmentRuntime.findUniqueOrThrow({
      where: { assessmentId: orderedAssessment },
      select: { eventSequence: true },
    });
    assert.deepEqual(orderedAssessmentRow, {
      lifecycleState: ASSESSMENT_LIFECYCLE_STATES.PREPARING,
      lifecycleRevision: 1,
      blockerReason: null,
      blockerReference: null,
    });
    assert.equal(orderedRuntimeRow.eventSequence, 8);
    assert.deepEqual(
      await coordinator.current(
        orderedAssessment,
        {
          userId: otherOwnerId,
          sessionId: "protocol-admin-session",
          role: AUTH_USER_ROLES.admin,
          scope: null,
        },
        "protocol:admin-current",
      ),
      {
        state: ASSESSMENT_LIFECYCLE_STATES.PREPARING,
        revision: 1,
      },
    );
    await assertProblem(
      coordinator.current(
        orderedAssessment,
        {
          userId: otherOwnerId,
          sessionId: "protocol-customer-session",
          role: AUTH_USER_ROLES.customer,
          scope: null,
        },
        "protocol:foreign-current",
      ),
      404,
    );

    const orderedEvent = await prisma.assessmentEvent.findUniqueOrThrow({
      where: { eventId: orderedEventId },
    });
    const orderedOutbox = await prisma.outboxMessage.findUniqueOrThrow({
      where: { id: orderedEvent.outboxMessageId },
    });
    const transportPayload = orderedOutbox.payload as Record<string, unknown>;
    assert.deepEqual(transportPayload.assessmentEvent, {
      eventId: orderedEvent.eventId,
      assessmentId: orderedEvent.assessmentId,
      threadId: orderedEvent.threadId,
      sequence: orderedEvent.sequence,
      timestamp: orderedEvent.timestamp.toISOString(),
      eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.ASSESSMENT_LIFECYCLE_CHANGED,
      actorType: ASSESSMENT_EVENT_ACTOR_TYPES.API,
      payload: orderedEvent.payload,
    });
    assert.deepEqual(
      Object.keys(transportPayload.assessmentEvent as object).sort(),
      [
        "actorType",
        "assessmentId",
        "eventId",
        "eventType",
        "payload",
        "sequence",
        "threadId",
        "timestamp",
      ],
    );
    assert.equal(
      orderedOutbox.eventType,
      ASSESSMENT_EVENT_TYPES.lifecycleChangedOutbox,
    );
    assert.equal(orderedEvent.outboxMessageId, orderedOutbox.id);

    const orderedReplay = await coordinator.transition(
      transitionInput(orderedAssessment, ownerId, 0, orderedEventId),
    );
    assert.equal(orderedReplay.sequence, 8);
    assert.equal(orderedReplay.assessmentRevision, 1);
    assert.equal(
      (
        await prisma.assessmentRuntime.findUniqueOrThrow({
          where: { assessmentId: orderedAssessment },
          select: { eventSequence: true },
        })
      ).eventSequence,
      8,
    );
    assert.equal(
      (
        await prisma.assessment.findUniqueOrThrow({
          where: { id: orderedAssessment },
          select: { lifecycleRevision: true },
        })
      ).lifecycleRevision,
      1,
    );

    await assertProblem(
      coordinator.transition(
        transitionInput(
          orderedAssessment,
          ownerId,
          0,
          orderedEventId,
          ASSESSMENT_LIFECYCLE_STATES.CANCELLED,
        ),
      ),
      409,
    );
    const foreignAssessment = await createAssessment();
    await assertProblem(
      coordinator.transition(
        transitionInput(foreignAssessment, ownerId, 0, orderedEventId),
      ),
      409,
    );
    await assertProblem(
      coordinator.transition(
        transitionInput(orderedAssessment, otherOwnerId, 0, orderedEventId),
      ),
      404,
    );
    const staleAssessment = await createAssessment();
    const staleResults = await Promise.allSettled([
      coordinator.transition(
        transitionInput(staleAssessment, ownerId, 0, randomUUID()),
      ),
      coordinator.transition(
        transitionInput(staleAssessment, ownerId, 0, randomUUID()),
      ),
    ]);
    assert.equal(
      staleResults.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      staleResults.filter(
        (result) =>
          result.status === "rejected" && statusOf(result.reason) === 409,
      ).length,
      1,
    );
    assert.equal(
      await prisma.assessmentEvent.count({
        where: { assessmentId: staleAssessment },
      }),
      1,
    );
    assert.equal(
      await prisma.outboxMessage.count({
        where: { aggregateId: staleAssessment },
      }),
      1,
    );

    const replayAssessment = await createAssessment();
    const replayEventId = randomUUID();
    const replayResults = await Promise.all([
      coordinator.transition(
        transitionInput(replayAssessment, ownerId, 0, replayEventId),
      ),
      coordinator.transition(
        transitionInput(replayAssessment, ownerId, 0, replayEventId),
      ),
    ]);
    assert.deepEqual(replayResults[0], replayResults[1]);
    assert.equal(
      await prisma.assessmentEvent.count({
        where: { assessmentId: replayAssessment },
      }),
      1,
    );
    assert.equal(
      await prisma.outboxMessage.count({
        where: { aggregateId: replayAssessment },
      }),
      1,
    );

    const rollbackAssessment = await createAssessment();
    const rollbackEventId = randomUUID();
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await coordinator.transitionInTx(
          transitionInput(rollbackAssessment, ownerId, 0, rollbackEventId),
          tx,
        );
        throw new Error("protocol rollback");
      }),
      /protocol rollback/,
    );
    assert.equal(
      await prisma.assessmentEvent.count({
        where: { assessmentId: rollbackAssessment },
      }),
      0,
    );
    assert.equal(
      await prisma.outboxMessage.count({
        where: { aggregateId: rollbackAssessment },
      }),
      0,
    );
    assert.deepEqual(
      await prisma.assessment.findUniqueOrThrow({
        where: { id: rollbackAssessment },
        select: { lifecycleState: true, lifecycleRevision: true },
      }),
      {
        lifecycleState: ASSESSMENT_LIFECYCLE_STATES.CREATED,
        lifecycleRevision: 0,
      },
    );
    assert.equal(
      (
        await prisma.assessmentRuntime.findUniqueOrThrow({
          where: { assessmentId: rollbackAssessment },
          select: { eventSequence: true },
        })
      ).eventSequence,
      0,
    );

    const unavailableGuardAssessment = await createAssessment();
    await coordinator.transition(
      transitionInput(unavailableGuardAssessment, ownerId, 0, randomUUID()),
    );
    await assertProblem(
      coordinator.transition(
        transitionInput(
          unavailableGuardAssessment,
          ownerId,
          1,
          randomUUID(),
          ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
        ),
      ),
      409,
    );
    assert.equal(
      await prisma.assessmentEvent.count({
        where: { assessmentId: unavailableGuardAssessment },
      }),
      1,
    );

    const controlAssessment = await createAssessment();
    const controlActor = {
      userId: ownerId,
      sessionId: "protocol-control-session",
      role: AUTH_USER_ROLES.customer,
      scope: null,
    };
    const initializedRuntime = await prisma.assessmentRuntime.findUniqueOrThrow(
      {
        where: { assessmentId: controlAssessment },
        select: { threadId: true },
      },
    );
    const controlRunId = randomUUID();
    const controlBoundary = "ROOT";
    const controlLogicalRunId = randomUUID();
    await prisma.assessment.update({
      where: { id: controlAssessment },
      data: {
        lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
        lifecycleRevision: 0,
      },
    });
    await prisma.assessmentRuntimeTurn.create({
      data: {
        id: controlRunId,
        assessmentId: controlAssessment,
        threadId: initializedRuntime.threadId,
        boundary: controlBoundary,
        logicalRunId: controlLogicalRunId,
        correlationId: "protocol:control",
        state: ASSESSMENT_RUNTIME_CONTROL_STATES.running,
        contextJson: { assessmentId: controlAssessment },
      },
    });
    await prisma.assessmentRuntime.update({
      where: { assessmentId: controlAssessment },
      data: {
        currentExecutionId: controlRunId,
        executionState: AGENT_EXECUTION_STATES.RUNNING,
      },
    });
    const acknowledgeControl = (
      state: (typeof ASSESSMENT_RUNTIME_CONTROL_STATES)[keyof typeof ASSESSMENT_RUNTIME_CONTROL_STATES],
      targetRunId = controlRunId,
    ) =>
      controls.acknowledge({
        assessmentId: controlAssessment,
        targetRunId,
        state,
        threadId: initializedRuntime.threadId,
        boundary: controlBoundary,
        logicalRunId: controlLogicalRunId,
        correlationId: "protocol:control",
        checkpoint: { checkpointId: "checkpoint-proof" },
      });

    await assertProblem(
      acknowledgeControl(ASSESSMENT_RUNTIME_CONTROL_STATES.stopped),
      409,
    );
    assert.equal(
      (
        await prisma.assessmentRuntimeTurn.findUniqueOrThrow({
          where: { id: controlRunId },
          select: { state: true },
        })
      ).state,
      ASSESSMENT_RUNTIME_CONTROL_STATES.running,
    );
    await controls.request({
      assessmentId: controlAssessment,
      actor: controlActor,
      correlationId: "protocol:control",
      action: ASSESSMENT_RUNTIME_CONTROL_ACTIONS.stop,
      targetRunId: controlRunId,
    });
    await prisma.assessmentRuntime.update({
      where: { assessmentId: controlAssessment },
      data: { executionState: AGENT_EXECUTION_STATES.INTERRUPTED },
    });
    await assertProblem(
      acknowledgeControl(ASSESSMENT_RUNTIME_CONTROL_STATES.stopped),
      409,
    );
    assert.equal(
      (
        await prisma.assessmentRuntimeTurn.findUniqueOrThrow({
          where: { id: controlRunId },
          select: { state: true },
        })
      ).state,
      ASSESSMENT_RUNTIME_CONTROL_STATES.stopRequested,
    );
    await prisma.assessmentRuntime.update({
      where: { assessmentId: controlAssessment },
      data: { executionState: AGENT_EXECUTION_STATES.PAUSED },
    });
    await acknowledgeControl(ASSESSMENT_RUNTIME_CONTROL_STATES.stopped);
    assert.equal(
      (
        await prisma.assessmentRuntimeTurn.findUniqueOrThrow({
          where: { id: controlRunId },
          select: { state: true },
        })
      ).state,
      ASSESSMENT_RUNTIME_CONTROL_STATES.stopped,
    );
    const lifecycleOutbox = await prisma.outboxMessage.findFirstOrThrow({
      where: {
        aggregateId: controlAssessment,
        eventType: ASSESSMENT_EVENT_TYPES.lifecycleChangedOutbox,
      },
      orderBy: { createdAt: "desc" },
    });
    assert.deepEqual(
      (lifecycleOutbox.payload as Record<string, unknown>).actor,
      {
        id: AUDIT_ACTOR_IDS.assessmentOrchestrator,
        type: AUDIT_ACTOR_TYPES.service,
      },
    );
    const controlOutboxCount = await prisma.outboxMessage.count({
      where: { aggregateId: controlAssessment },
    });
    await assertProblem(
      controls.request({
        assessmentId: controlAssessment,
        actor: controlActor,
        correlationId: "protocol:resume-unavailable",
        action: ASSESSMENT_RUNTIME_CONTROL_ACTIONS.resume,
        targetRunId: controlRunId,
      }),
      409,
    );
    assert.equal(
      await prisma.outboxMessage.count({
        where: { aggregateId: controlAssessment },
      }),
      controlOutboxCount,
    );
    assert.equal(
      (
        await prisma.assessmentRuntimeTurn.findUniqueOrThrow({
          where: { id: controlRunId },
          select: { state: true },
        })
      ).state,
      ASSESSMENT_RUNTIME_CONTROL_STATES.stopped,
    );

    const unrelatedRunId = randomUUID();
    const unrelatedThreadId = randomUUID();
    await prisma.assessmentRuntimeTurn.create({
      data: {
        id: unrelatedRunId,
        assessmentId: controlAssessment,
        threadId: unrelatedThreadId,
        boundary: controlBoundary,
        logicalRunId: randomUUID(),
        correlationId: "protocol:unrelated",
        state: ASSESSMENT_RUNTIME_CONTROL_STATES.running,
        contextJson: {},
      },
    });
    await assertProblem(
      controls.request({
        assessmentId: controlAssessment,
        actor: controlActor,
        correlationId: "protocol:unrelated",
        action: ASSESSMENT_RUNTIME_CONTROL_ACTIONS.stop,
        targetRunId: unrelatedRunId,
      }),
      409,
    );
    await prisma.assessmentRuntime.update({
      where: { assessmentId: controlAssessment },
      data: {
        currentExecutionId: unrelatedRunId,
        executionState: AGENT_EXECUTION_STATES.RUNNING,
      },
    });
    await assertProblem(
      acknowledgeControl(ASSESSMENT_RUNTIME_CONTROL_STATES.stopped),
      409,
    );
  } finally {
    await prisma.assessment.deleteMany({
      where: { id: { in: assessmentIds } },
    });
    await prisma.outboxMessage.deleteMany({
      where: { aggregateId: { in: assessmentIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }
});
