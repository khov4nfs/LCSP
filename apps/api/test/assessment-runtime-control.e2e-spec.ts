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
  ASSESSMENT_RUNTIME_CONTROL_ACTIONS as Actions,
  ASSESSMENT_RUNTIME_CONTROL_STATES as States,
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES as Events,
  type AssessmentRuntimeControlState,
} from "@lcsp/contracts/evidence";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import { OutboxRepository } from "../src/platform/outbox/outbox.repository.js";
import { AssessmentRuntimeControlService } from "../src/platform/runtime-events/assessment-runtime-control.service.js";
import { AssessmentRuntimeEventService } from "../src/platform/runtime-events/assessment-runtime-event.service.js";
import { RuntimeWriteFenceInterceptor } from "../src/platform/runtime-events/runtime-write-fence.interceptor.js";

describe("durable acknowledged runtime controls", () => {
  const prisma = new PrismaService();
  const ownerId = `runtime-control-test-${randomUUID()}`;
  const assessmentIds: string[] = [];
  const events = new AssessmentRuntimeEventService(prisma);
  const controls = new AssessmentRuntimeControlService(
    prisma,
    new OutboxRepository(prisma),
    events,
  );
  let assessmentId: string;
  let runId: string;

  const request = (
    action: (typeof Actions)[keyof typeof Actions],
    targetRunId = runId,
  ) =>
    controls.request({
      assessmentId,
      actorId: ownerId,
      correlationId: "control-test",
      action,
      targetRunId,
    });
  const acknowledge = (
    state: AssessmentRuntimeControlState,
    targetRunId = runId,
  ) =>
    controls.acknowledge({
      assessmentId,
      targetRunId,
      state,
      correlationId: "control-test",
      checkpoint: {
        thread_id: "exact-thread",
        checkpoint_id: "exact-checkpoint",
      },
    });

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
  });
  beforeEach(async () => {
    assessmentId = `runtime-control-test-${randomUUID()}`;
    runId = randomUUID();
    assessmentIds.push(assessmentId);
    await prisma.assessment.create({
      data: { id: assessmentId, ownerId, name: "Runtime control test" },
    });
    await controls.acknowledge({
      assessmentId,
      targetRunId: runId,
      state: States.running,
      threadId: "exact-thread",
      boundary: "interview_context_updated",
      logicalRunId: runId,
      correlationId: "control-test",
      context: {
        assessment_id: assessmentId,
        system_event: { original: true },
      },
    });
  });
  afterAll(async () => {
    await prisma.outboxMessage.deleteMany({
      where: { aggregateId: { in: assessmentIds } },
    });
    await prisma.assessment.deleteMany({
      where: { id: { in: assessmentIds }, ownerId },
    });
    await prisma.user.delete({ where: { id: ownerId } });
    await prisma.$disconnect();
  });

  it("queues one exact Stop, rejects early Continue, and resumes one checkpoint", async () => {
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
    const [resume, duplicateResume] = await Promise.all([
      request(Actions.resume),
      request(Actions.resume),
    ]);
    expect(resume.state).toBe(States.resumeRequested);
    expect(duplicateResume).toEqual(resume);
    expect(
      await prisma.outboxMessage.count({
        where: { aggregateId: assessmentId },
      }),
    ).toBe(2);
    const row = await prisma.assessmentRuntimeTurn.findUniqueOrThrow({
      where: { id: runId },
    });
    expect(row.checkpointJson).toEqual({
      thread_id: "exact-thread",
      checkpoint_id: "exact-checkpoint",
    });
    const newRun = randomUUID();
    await controls.acknowledge({
      assessmentId,
      targetRunId: newRun,
      state: States.running,
      threadId: "exact-thread",
      boundary: "interview_context_updated",
      logicalRunId: runId,
      correlationId: "control-test",
      context: { assessment_id: assessmentId },
    });
    expect((await request(Actions.resume)).targetRunId).toBe(newRun);
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
      expect(rows).toHaveLength(3);
      const replay = await firstValueFrom(
        events
          .observeAgentStreamEvents(ownerId, { assessmentId })
          .pipe(take(3), toArray()),
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
        .pipe(take(3), toArray()),
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
    await request(Actions.resume);
    await expect(
      firstValueFrom(fence.intercept(context, next)),
    ).rejects.toMatchObject({ status: 409 });
  });
});
