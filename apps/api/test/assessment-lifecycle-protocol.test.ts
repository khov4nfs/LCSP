import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  ASSESSMENT_LIFECYCLE_STATES,
  type AssessmentLifecycleState,
} from "@lcsp/contracts/assessment";
import { ASSESSMENT_EVENT_TYPES } from "@lcsp/contracts/assessment";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import { AssessmentLifecycleCoordinator } from "../src/modules/assessment/application/services/assessment-lifecycle-coordinator.service.js";
import { OutboxRepository } from "../src/platform/outbox/outbox.repository.js";

const EXPECTED_DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${Number(process.env.LCSP_TEST_PG_PORT ?? 55437)}/lcsp_api_w13_r2_repair?schema=public`;

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

  const createAssessment = async (owner = ownerId): Promise<string> => {
    const assessmentId = randomUUID();
    assessmentIds.push(assessmentId);
    await prisma.assessment.create({
      data: {
        id: assessmentId,
        ownerId: owner,
        name: `CANONICAL.3 protocol ${assessmentId}`,
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
