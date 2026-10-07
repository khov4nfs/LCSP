import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { randomUUID } from "node:crypto";
import { firstValueFrom, Observable, take, toArray } from "rxjs";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  ASSESSMENT_RUNTIME_CONTROL_ACTIONS as Actions,
  ASSESSMENT_RUNTIME_CONTROL_STATES as States,
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES as Events,
  type AssessmentRuntimeControlState,
} from "@lcsp/contracts/evidence";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import { OutboxRepository } from "../src/platform/outbox/outbox.repository.js";
import { AssessmentRuntimeControlService } from "../src/platform/runtime-events/assessment-runtime-control.service.js";
import { AssessmentRuntimeEventService } from "../src/platform/runtime-events/assessment-runtime-event.service.js";
import { AssessmentLifecycleCoordinator } from "../src/modules/assessment/application/services/assessment-lifecycle-coordinator.service.js";
import { RuntimeWriteFenceInterceptor } from "../src/platform/runtime-events/runtime-write-fence.interceptor.js";

describe("durable acknowledged runtime controls", () => {
  const prisma = new PrismaService();
  const ownerId = `runtime-control-test-${randomUUID()}`;
  const actor = {
    userId: ownerId,
    sessionId: ownerId,
    role: AUTH_USER_ROLES.customer,
    scope: null,
  };
  const assessmentIds: string[] = [];
  const events = new AssessmentRuntimeEventService(prisma);
  const outbox = new OutboxRepository(prisma);
  const lifecycle = new AssessmentLifecycleCoordinator(prisma, outbox);
  const controls = new AssessmentRuntimeControlService(
    prisma,
    outbox,
    events,
    lifecycle,
  );
  let assessmentId: string;
  let runId: string;
  let threadId: string;
  let fixtureCreated = false;

  const registerRun = async (id: string, logicalRunId = id) => {
    await prisma.assessmentRuntimeTurn.create({
      data: {
        id,
        assessmentId,
        threadId,
        boundary: "interview_context_updated",
        logicalRunId,
        correlationId: "control-test",
        state: States.running,
        contextJson: { assessment_id: assessmentId },
      },
    });
    await prisma.assessmentRuntime.update({
      where: { assessmentId },
      data: {
        currentExecutionId: id,
        executionState: AGENT_EXECUTION_STATES.RUNNING,
      },
    });
  };

  const request = (
    action: (typeof Actions)[keyof typeof Actions],
    targetRunId = runId,
  ) =>
    controls.request({
      assessmentId,
      actor,
      correlationId: "control-test",
      action,
      targetRunId,
    });
  const acknowledge = (
    state: AssessmentRuntimeControlState,
    targetRunId = runId,
  ) =>
    (async () => {
      if (state === States.stopped) {
        const turn = await prisma.assessmentRuntimeTurn.findUnique({
          where: { id: targetRunId },
          select: { state: true },
        });
        if (turn?.state === States.stopRequested) {
          await prisma.assessmentRuntime.update({
            where: { assessmentId },
            data: { executionState: AGENT_EXECUTION_STATES.PAUSED },
          });
        }
      }
      return controls.acknowledge({
        assessmentId,
        targetRunId,
        state,
        threadId,
        boundary: "interview_context_updated",
        logicalRunId: targetRunId,
        correlationId: "control-test",
        checkpoint: {
          thread_id: threadId,
          checkpoint_id: "exact-checkpoint",
        },
      });
    })();

  beforeAll(async () => {
    // This suite never resets a database or touches a pre-existing assessment.
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== "127.0.0.1" || !url.pathname.startsWith("/lcsp_api_"))
      throw new Error(
        "Runtime control tests require a disposable local database",
      );
    await prisma.user.create({
      data: {
        id: ownerId,
        email: `${ownerId}@example.test`,
        passwordHash: "not-a-login",
        emailVerified: true,
        failedLoginCount: 0,
      },
    });
    fixtureCreated = true;
  });
  beforeEach(async () => {
    assessmentId = randomUUID();
    runId = randomUUID();
    assessmentIds.push(assessmentId);
    await prisma.assessment.create({
      data: { id: assessmentId, ownerId, name: "Runtime control test" },
    });
    const initialized = await lifecycle.initialize({
      assessmentId,
      ownerId,
      rootAgentVersion: "assessment-root-v2",
      checkpointNamespace: assessmentId,
      correlationId: "control-test",
    });
    threadId = initialized.threadId;
    await prisma.assessment.update({
      where: { id: assessmentId },
      data: {
        lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
        lifecycleRevision: 0,
      },
    });
    await registerRun(runId);
  });
  afterAll(async () => {
    try {
      if (!fixtureCreated) return;
      await prisma.assessmentEvent.deleteMany({
        where: { assessmentId: { in: assessmentIds } },
      });
      await prisma.outboxMessage.deleteMany({
        where: { aggregateId: { in: assessmentIds } },
      });
      await prisma.assessment.deleteMany({
        where: { id: { in: assessmentIds }, ownerId },
      });
      await prisma.user.deleteMany({ where: { id: ownerId } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("queues one exact Stop and fails closed for unavailable Continue authority", async () => {
    const [first, duplicate] = await Promise.all([
      request(Actions.stop),
      request(Actions.stop),
    ]);
    expect(first.state).toBe(States.stopRequested);
    expect(duplicate).toEqual(first);
    await expect(request(Actions.resume)).rejects.toMatchObject({
      status: 409,
    });
    const stopOutbox = await prisma.outboxMessage.findMany({
      where: { aggregateId: assessmentId },
    });
    expect(stopOutbox).toHaveLength(1);
    expect(JSON.stringify(stopOutbox[0].payload)).toContain(runId);
    await acknowledge(States.stopped);
    await expect(request(Actions.resume)).rejects.toMatchObject({
      status: 409,
    });
    await expect(request(Actions.resume)).rejects.toMatchObject({
      status: 409,
    });
    expect(
      await prisma.outboxMessage.count({
        where: { aggregateId: assessmentId },
      }),
    ).toBe(2);
    const row = await prisma.assessmentRuntimeTurn.findUniqueOrThrow({
      where: { id: runId },
    });
    expect(row.state).toBe(States.stopped);
    expect(row.checkpointJson).toEqual({
      thread_id: threadId,
      checkpoint_id: "exact-checkpoint",
    });
    const newRun = randomUUID();
    await registerRun(newRun, runId);
    await expect(request(Actions.resume)).rejects.toMatchObject({
      status: 409,
    });
    expect(
      await prisma.outboxMessage.count({
        where: { aggregateId: assessmentId },
      }),
    ).toBe(2);
    // A delayed old Stop cannot interrupt the new generation.
    await expect(request(Actions.stop)).rejects.toMatchObject({ status: 409 });
  });

  it("natural completion wins and duplicate terminal callbacks cannot reopen it", async () => {
    await request(Actions.stop);
    await acknowledge(States.completed);
    expect((await acknowledge(States.stopped)).state).toBe(States.completed);
    expect((await request(Actions.stop)).state).toBe(States.completed);
    expect((await request(Actions.resume)).state).toBe(States.completed);
  });

  it("repairs failed lifecycle publication on retry without duplicate journal rows", async () => {
    const publish = jest.spyOn(events, "publishAgentStreamEvent");
    try {
      publish.mockRejectedValueOnce(
        new Error("journal temporarily unavailable"),
      );
      await expect(request(Actions.stop)).rejects.toThrow(
        "journal temporarily unavailable",
      );
      expect((await controls.current(assessmentId))?.state).toBe(
        States.stopRequested,
      );
      await request(Actions.stop);
      expect(
        await prisma.outboxMessage.count({
          where: { aggregateId: assessmentId },
        }),
      ).toBe(1);
      publish.mockRejectedValueOnce(
        new Error("journal temporarily unavailable"),
      );
      await expect(acknowledge(States.stopped)).rejects.toThrow(
        "journal temporarily unavailable",
      );
      expect((await controls.current(assessmentId))?.state).toBe(
        States.stopped,
      );
      await acknowledge(States.stopped);
      await acknowledge(States.stopped);
      const rows = await prisma.assessmentRuntimeEvent.findMany({
        where: { assessmentId },
      });
      expect(rows).toHaveLength(2);
      const replay = await firstValueFrom(
        events
          .observeAgentStreamEvents(ownerId, { assessmentId })
          .pipe(take(2), toArray()),
      );
      expect(
        replay.filter((event) => event.eventType === Events.runtimeStopped),
      ).toHaveLength(1);
    } finally {
      publish.mockRestore();
    }
  });

  it("quarantines late model output and heartbeats after acknowledgement", async () => {
    await request(Actions.stop);
    await acknowledge(States.stopped);
    for (const eventType of [
      Events.modelCallCompleted,
      Events.modelCallHeartbeat,
      Events.toolResult,
      Events.agentCompleted,
    ]) {
      await expect(
        events.publishAgentStreamEvent({
          assessmentId,
          runId,
          correlationId: "old",
          eventType,
          data: { runtimeRunId: runId },
        }),
      ).resolves.toBeNull();
    }
    expect((await events.getPipelineLiveness(assessmentId, 90_000)).live).toBe(
      false,
    );
    const replay = await firstValueFrom(
      events
        .observeAgentStreamEvents(ownerId, { assessmentId })
        .pipe(take(2), toArray()),
    );
    expect(
      replay.filter((event) => event.eventType === Events.runtimeStopped),
    ).toHaveLength(1);
    expect(replay.at(-1)?.data).toMatchObject({
      runtimeControl: { state: States.stopped },
    });
  });

  it("waits for admitted writes, then fences an old tool even after resume", async () => {
    await request(Actions.stop);
    const fence = new RuntimeWriteFenceInterceptor(prisma);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: "POST",
          originalUrl: "/internal/assessments/tool-result",
          headers: { "x-lcsp-runtime-run-id": runId },
        }),
      }),
    } as unknown as ExecutionContext;
    let release!: () => void;
    let admit!: () => void;
    const admitted = new Promise<void>((resolve) => {
      admit = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = {
      handle: () =>
        new Observable((subscriber) => {
          admit();
          void held.then(() => {
            subscriber.next(true);
            subscriber.complete();
          });
        }),
    } as CallHandler;
    const write = firstValueFrom(fence.intercept(context, next));
    await admitted;
    let acknowledged = false;
    const stopped = acknowledge(States.stopped).then(() => {
      acknowledged = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(acknowledged).toBe(false);
    release();
    await write;
    await stopped;
    await expect(request(Actions.resume)).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      firstValueFrom(fence.intercept(context, next)),
    ).rejects.toMatchObject({ status: 409 });
  });
});
