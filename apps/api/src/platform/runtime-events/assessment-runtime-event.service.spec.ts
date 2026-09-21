import { describe, expect, it, jest } from "@jest/globals";
import {
  ASSESSMENT_AGENT_STREAM_DURABILITY,
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES,
  ASSESSMENT_AGENT_STREAM_SCHEMA_VERSIONS,
  ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS,
  ASSESSMENT_RUNTIME_EVENT_TYPES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  ASSESSMENT_RUNTIME_STAGE_CODES,
  POST_FINDING_RUNTIME_PHASES,
  REMEDIATION_APPROVAL_STATUSES,
  REMEDIATION_DECISIONS,
} from "@lcsp/contracts/evidence";
import { firstValueFrom } from "rxjs";

import { AssessmentRuntimeEventService } from "./assessment-runtime-event.service.js";

const freshRuntimeEvent = () =>
  Promise.resolve({ createdAt: new Date("2099-01-01T00:00:00.000Z") });

const emptyRepositorySnapshots = () => ({
  findMany: jest
    .fn<(args?: unknown) => Promise<unknown[]>>()
    .mockResolvedValue([]),
});

const assessmentOwner = () => ({
  findUnique: jest
    .fn<(args?: unknown) => Promise<{ ownerId: string }>>()
    .mockResolvedValue({ ownerId: "user-1" }),
});

function durableAgentStreamRow(
  sequence: number,
  assessmentId = "assessment-a",
  runId = "run-a",
) {
  const emittedAt = new Date(1_800_000_000_000 + sequence).toISOString();
  return {
    id: `runtime-${sequence}`,
    assessmentId,
    runId,
    correlationId: "corr-a",
    sequence,
    eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
    runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
    stage: ASSESSMENT_RUNTIME_STAGE_CODES.technicalEvidence,
    toolName: "agent_stream_semantic",
    summary: `Agent stream semantic-${sequence}`,
    inputSummaryJson: null,
    outputSummaryJson: {
      agentStreamEvent: {
        eventId: `${assessmentId}-semantic-${sequence}`,
        sequence,
        clientSequence: null,
        emittedAt,
        assessmentId,
        runId,
        correlationId: "corr-a",
        eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.semanticToolCall,
        source: "engineering",
        agentName: "investigator",
        subagentName: null,
        namespace: [],
        nodeName: "model",
        messageId: `${assessmentId}-message-${sequence}`,
        toolName: "search_nodes",
        toolCallId: `${assessmentId}-call-${sequence}`,
        status: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
        text: null,
        data: {
          schemaVersion: ASSESSMENT_AGENT_STREAM_SCHEMA_VERSIONS.semanticV1,
          kind: ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.toolCall,
          durability: ASSESSMENT_AGENT_STREAM_DURABILITY.durable,
          toolName: "search_nodes",
          toolCallId: `${assessmentId}-call-${sequence}`,
          parameters: { index: sequence },
        },
      },
    },
    errorSummary: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    attempt: null,
    waitingReason: null,
    createdAt: new Date(emittedAt),
  };
}

function agentStreamPersistenceMock(persistedRows: unknown[] = []) {
  return {
    findFirst: jest.fn(({ where }: { where?: { runId?: string } }) => {
      const rows = persistedRows as Array<{
        runId?: string;
        sequence?: number;
      }>;
      const latest = rows
        .filter((row) => row.runId === where?.runId)
        .sort((left, right) => (right.sequence ?? 0) - (left.sequence ?? 0))[0];
      return Promise.resolve(
        latest?.sequence === undefined ? null : { sequence: latest.sequence },
      );
    }),
    create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
      const row = {
        id: `runtime-agent-${persistedRows.length + 1}`,
        ...data,
        createdAt: new Date("2026-09-20T00:00:00.000Z"),
      };
      persistedRows.push(row);
      return Promise.resolve(row);
    }),
  };
}

function withTransaction<T extends object>(
  prisma: T,
): T & {
  $transaction: jest.Mock<
    (callback: (tx: T) => Promise<void>) => Promise<void>
  >;
} {
  return Object.assign(prisma, {
    $transaction: jest.fn((callback: (tx: T) => Promise<void>) =>
      callback(prisma),
    ),
  });
}

describe("AssessmentRuntimeEventService", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("isolates live agent events by assessment owner", async () => {
    const prisma = withTransaction({
      assessment: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(
            where.id === "assessment-a"
              ? { ownerId: "user-a" }
              : where.id === "assessment-b"
                ? { ownerId: "user-b" }
                : null,
          ),
        ),
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([]),
      },
      assessmentRuntimeEvent: {
        ...agentStreamPersistenceMock(),
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([]),
      },
    });
    const service = new AssessmentRuntimeEventService(prisma as never);
    const ownerAEvents: string[] = [];
    const ownerBEvents: string[] = [];
    const ownerASubscription = service
      .observeAgentStreamEvents("user-a")
      .subscribe((event) => ownerAEvents.push(event.assessmentId));
    const ownerBSubscription = service
      .observeAgentStreamEvents("user-b")
      .subscribe((event) => ownerBEvents.push(event.assessmentId));

    await service.publishAgentStreamEvent({
      assessmentId: "assessment-a",
      runId: "run-a",
      correlationId: "corr-a",
      eventType: "MODEL_CONTENT_DELTA",
      text: "A",
    });
    await service.publishAgentStreamEvent({
      assessmentId: "assessment-b",
      runId: "run-b",
      correlationId: "corr-b",
      eventType: "MODEL_CONTENT_DELTA",
      text: "B",
    });

    expect(ownerAEvents).toEqual(["assessment-a"]);
    expect(ownerBEvents).toEqual(["assessment-b"]);
    expect(prisma.assessment.findUnique).toHaveBeenCalledTimes(2);
    ownerASubscription.unsubscribe();
    ownerBSubscription.unsubscribe();
  });

  it("filters assessment-scoped live agent events", async () => {
    const prisma = withTransaction({
      assessment: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(
            where.id === "assessment-a" || where.id === "assessment-b"
              ? { ownerId: "user-a" }
              : null,
          ),
        ),
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([]),
      },
      assessmentRuntimeEvent: {
        ...agentStreamPersistenceMock(),
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([]),
      },
    });
    const service = new AssessmentRuntimeEventService(prisma as never);
    const events: string[] = [];
    const subscription = service
      .observeAgentStreamEvents("user-a", { assessmentId: "assessment-b" })
      .subscribe((event) => events.push(event.assessmentId));

    await service.publishAgentStreamEvent({
      assessmentId: "assessment-a",
      runId: "run-a",
      correlationId: "corr-a",
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelContentDelta,
      text: "A",
    });
    await service.publishAgentStreamEvent({
      assessmentId: "assessment-b",
      runId: "run-b",
      correlationId: "corr-b",
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelContentDelta,
      text: "B",
    });

    expect(events).toEqual(["assessment-b"]);
    subscription.unsubscribe();
  });

  it("persists durable semantic agent stream events for replay after service recreation", async () => {
    const persistedRows: unknown[] = [];
    const prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => Promise<void>) =>
        callback(prisma),
      ),
      assessment: {
        findUnique: jest
          .fn<
            (args: { where: { id: string } }) => Promise<{ ownerId: string }>
          >()
          .mockResolvedValue({ ownerId: "user-a" }),
        findMany: jest
          .fn<(args?: unknown) => Promise<Array<{ id: string }>>>()
          .mockResolvedValue([{ id: "assessment-a" }]),
      },
      assessmentRuntimeEvent: {
        findFirst: jest
          .fn<(args?: unknown) => Promise<{ sequence: number } | null>>()
          .mockResolvedValue(null),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          const row = {
            id: "runtime-agent-1",
            ...data,
            createdAt: new Date("2026-09-20T00:00:00.000Z"),
          };
          persistedRows.push(row);
          return Promise.resolve(row);
        }),
        findMany: jest.fn(({ where }: { where?: unknown }) => {
          expect(where).toMatchObject({
            assessmentId: "assessment-a",
            assessment: { ownerId: "user-a" },
            toolName: "agent_stream_semantic",
          });
          return Promise.resolve(persistedRows);
        }),
      },
    };
    const firstService = new AssessmentRuntimeEventService(prisma as never);

    await firstService.publishAgentStreamEvent({
      eventId: "semantic-event-1",
      assessmentId: "assessment-a",
      runId: "run-a",
      correlationId: "corr-a",
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.semanticToolCall,
      agentName: "investigator",
      toolName: "search_nodes",
      toolCallId: "call-1",
      status: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
      data: {
        schemaVersion: ASSESSMENT_AGENT_STREAM_SCHEMA_VERSIONS.semanticV1,
        kind: ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.toolCall,
        durability: ASSESSMENT_AGENT_STREAM_DURABILITY.durable,
        toolName: "search_nodes",
        toolCallId: "call-1",
        parameters: { nodeType: "AI_MODEL_INVOCATION" },
      },
    });

    expect(prisma.assessmentRuntimeEvent.create).toHaveBeenCalledTimes(1);
    expect(persistedRows).toHaveLength(1);
    const replayService = new AssessmentRuntimeEventService(prisma as never);
    const directReplay = await (
      replayService as unknown as {
        getDurableAgentStreamEvents: (ownerId: string) => Promise<unknown[]>;
      }
    ).getDurableAgentStreamEvents("user-a");
    expect(directReplay).toHaveLength(1);
    const replayed = await firstValueFrom(
      replayService.observeAgentStreamEvents("user-a"),
    );

    expect(replayed).toMatchObject({
      eventId: "semantic-event-1",
      assessmentId: "assessment-a",
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.semanticToolCall,
      data: {
        kind: ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.toolCall,
        durability: ASSESSMENT_AGENT_STREAM_DURABILITY.durable,
        parameters: { nodeType: "AI_MODEL_INVOCATION" },
      },
    });
  });

  it("persists and replays UI-visible agent stream activity after service recreation", async () => {
    const persistedRows: unknown[] = [];
    const prisma = withTransaction({
      assessment: {
        findUnique: jest
          .fn<
            (args: { where: { id: string } }) => Promise<{ ownerId: string }>
          >()
          .mockResolvedValue({ ownerId: "user-a" }),
        findMany: jest
          .fn<(args?: unknown) => Promise<Array<{ id: string }>>>()
          .mockResolvedValue([{ id: "assessment-a" }]),
      },
      assessmentRuntimeEvent: {
        ...agentStreamPersistenceMock(persistedRows),
        findMany: jest.fn(
          ({ take, where }: { take?: number; where?: unknown }) => {
            expect(take).toBe(5_001);
            expect(JSON.stringify(where)).toContain("assessment-a");
            expect(JSON.stringify(where)).toContain("agent_stream_semantic");
            return Promise.resolve(
              [...persistedRows]
                .sort(
                  (left, right) =>
                    ((right as { sequence?: number }).sequence ?? 0) -
                    ((left as { sequence?: number }).sequence ?? 0),
                )
                .slice(0, take),
            );
          },
        ),
      },
    });
    const firstService = new AssessmentRuntimeEventService(prisma as never);
    const baseInput = {
      assessmentId: "assessment-a",
      runId: "run-a",
      correlationId: "corr-a",
      source: "engineering",
      agentName: "investigator",
    };
    const expectedEventIds = [
      "agent-start",
      "reasoning-delta",
      "reasoning-summary",
      "model-delta",
      "runtime-log",
      "graph-update",
      "semantic-tool-call",
      "agent-complete",
    ];

    await firstService.publishAgentStreamEvent({
      ...baseInput,
      eventId: "agent-start",
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentStarted,
      status: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
      text: "Investigator started",
    });
    await firstService.publishAgentStreamEvent({
      ...baseInput,
      eventId: "reasoning-delta",
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelReasoningDelta,
      messageId: "message-1",
      text: "Provider reasoning summary delta",
    });
    await firstService.publishAgentStreamEvent({
      ...baseInput,
      eventId: "reasoning-summary",
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.customProgress,
      data: {
        schemaVersion: ASSESSMENT_AGENT_STREAM_SCHEMA_VERSIONS.semanticV1,
        kind: ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.reasoningSummary,
        durability: ASSESSMENT_AGENT_STREAM_DURABILITY.bestEffort,
        summary: "Provider-approved reasoning summary",
      },
    });
    await firstService.publishAgentStreamEvent({
      ...baseInput,
      eventId: "model-delta",
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelContentDelta,
      messageId: "message-1",
      text: "Visible answer chunk",
    });
    await firstService.publishAgentStreamEvent({
      ...baseInput,
      eventId: "runtime-log",
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.log,
      text: "Runtime log row",
    });
    await firstService.publishAgentStreamEvent({
      ...baseInput,
      eventId: "graph-update",
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.graphUpdate,
      data: { nodeId: "node-1", status: "OBSERVED" },
    });
    await firstService.publishAgentStreamEvent({
      ...baseInput,
      eventId: "semantic-tool-call",
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.semanticToolCall,
      toolName: "search_nodes",
      toolCallId: "call-1",
      data: {
        schemaVersion: ASSESSMENT_AGENT_STREAM_SCHEMA_VERSIONS.semanticV1,
        kind: ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.toolCall,
        durability: ASSESSMENT_AGENT_STREAM_DURABILITY.durable,
        toolName: "search_nodes",
        toolCallId: "call-1",
        parameters: { nodeType: "AI_MODEL_INVOCATION" },
      },
    });
    await firstService.publishAgentStreamEvent({
      ...baseInput,
      eventId: "agent-complete",
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentCompleted,
      status: ASSESSMENT_RUNTIME_RUN_STATUSES.completed,
      text: "Investigator completed",
    });

    expect(prisma.assessmentRuntimeEvent.create).toHaveBeenCalledTimes(
      expectedEventIds.length,
    );
    const replayService = new AssessmentRuntimeEventService(prisma as never);
    const replay = await (
      replayService as unknown as {
        getDurableAgentStreamEvents: (
          ownerId: string,
          assessmentId: string,
        ) => Promise<Array<{ eventId: string; eventType: string }>>;
      }
    ).getDurableAgentStreamEvents("user-a", "assessment-a");

    expect(replay.map((event) => event.eventId)).toEqual(expectedEventIds);
    expect(replay.map((event) => event.eventType)).toEqual([
      ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentStarted,
      ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelReasoningDelta,
      ASSESSMENT_AGENT_STREAM_EVENT_TYPES.customProgress,
      ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelContentDelta,
      ASSESSMENT_AGENT_STREAM_EVENT_TYPES.log,
      ASSESSMENT_AGENT_STREAM_EVENT_TYPES.graphUpdate,
      ASSESSMENT_AGENT_STREAM_EVENT_TYPES.semanticToolCall,
      ASSESSMENT_AGENT_STREAM_EVENT_TYPES.agentCompleted,
    ]);
    expect(replay[2]).toMatchObject({
      data: {
        kind: ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS.reasoningSummary,
        durability: ASSESSMENT_AGENT_STREAM_DURABILITY.bestEffort,
      },
    });
  });

  it("replays the newest durable semantic history in chronological order", async () => {
    const persistedRows = Array.from({ length: 6_001 }, (_, index) =>
      durableAgentStreamRow(index + 1),
    );
    const prisma = {
      assessment: {
        findMany: jest
          .fn<(args?: unknown) => Promise<Array<{ id: string }>>>()
          .mockResolvedValue([{ id: "assessment-a" }]),
      },
      assessmentRuntimeEvent: {
        findMany: jest.fn(
          ({
            orderBy,
            take,
            where,
          }: {
            orderBy?: unknown;
            take?: number;
            where?: { assessmentId?: string };
          }) => {
            expect(JSON.stringify(where)).toContain("assessment-a");
            expect(JSON.stringify(where)).toContain("agent_stream_semantic");
            expect(orderBy).toEqual([
              { createdAt: "desc" },
              { sequence: "desc" },
            ]);
            expect(take).toBe(5_000);
            return Promise.resolve(
              [...persistedRows]
                .sort((left, right) => right.sequence - left.sequence)
                .slice(0, take),
            );
          },
        ),
      },
    };
    const service = new AssessmentRuntimeEventService(prisma as never);

    const replay = await (
      service as unknown as {
        getDurableAgentStreamEvents: (
          ownerId: string,
        ) => Promise<Array<{ eventId: string; sequence: number }>>;
      }
    ).getDurableAgentStreamEvents("user-a");

    expect(replay).toHaveLength(5_000);
    expect(replay[0]).toMatchObject({
      eventId: "assessment-a-semantic-1002",
      sequence: 1002,
    });
    expect(replay.at(-1)).toMatchObject({
      eventId: "assessment-a-semantic-6001",
      sequence: 6001,
    });
  });

  it("bounds assessment-scoped journal replay and leaves older history to cursor pages", async () => {
    const persistedRows = Array.from({ length: 6_001 }, (_, index) =>
      durableAgentStreamRow(index + 1),
    );
    const prisma = {
      assessment: {
        findUnique: jest
          .fn<
            (args: { where: { id: string } }) => Promise<{ ownerId: string }>
          >()
          .mockResolvedValue({ ownerId: "user-a" }),
      },
      assessmentRuntimeEvent: {
        findMany: jest.fn(
          ({
            orderBy,
            take,
            where,
          }: {
            orderBy?: unknown;
            take?: number;
            where?: unknown;
          }) => {
            expect(JSON.stringify(where)).toContain("assessment-a");
            expect(JSON.stringify(where)).toContain("agent_stream_semantic");
            expect(orderBy).toEqual([
              { createdAt: "desc" },
              { sequence: "desc" },
              { id: "desc" },
            ]);
            expect(take).toBe(5_001);
            return Promise.resolve(
              [...persistedRows]
                .sort((left, right) => right.sequence - left.sequence)
                .slice(0, take),
            );
          },
        ),
      },
    };
    const service = new AssessmentRuntimeEventService(prisma as never);

    const replay = await (
      service as unknown as {
        getDurableAgentStreamEvents: (
          ownerId: string,
          assessmentId: string,
        ) => Promise<Array<{ eventId: string; sequence: number }>>;
      }
    ).getDurableAgentStreamEvents("user-a", "assessment-a");

    expect(replay).toHaveLength(5_000);
    expect(replay[0]).toMatchObject({
      eventId: "assessment-a-semantic-1002",
      sequence: 1002,
    });
    expect(replay.at(-1)).toMatchObject({
      eventId: "assessment-a-semantic-6001",
      sequence: 6001,
    });
  });

  it("paginates complete assessment-scoped journal history with an opaque cursor", async () => {
    const persistedRows = Array.from({ length: 6 }, (_, index) =>
      durableAgentStreamRow(index + 1),
    );
    const prisma = {
      assessment: {
        findUnique: jest
          .fn<
            (args: { where: { id: string } }) => Promise<{ ownerId: string }>
          >()
          .mockResolvedValue({ ownerId: "user-a" }),
      },
      assessmentRuntimeEvent: {
        findMany: jest.fn(
          ({ take, where }: { take?: number; where?: { AND?: unknown[] } }) => {
            const hasCursor = JSON.stringify(where).includes('"OR"');
            const rows = hasCursor
              ? persistedRows.filter((row) => row.sequence < 4)
              : persistedRows;
            return Promise.resolve(
              [...rows]
                .sort((left, right) => right.sequence - left.sequence)
                .slice(0, take),
            );
          },
        ),
      },
    };
    const service = new AssessmentRuntimeEventService(prisma as never);

    const firstPage = await service.getAgentStreamHistoryPage(
      "user-a",
      "assessment-a",
      { limit: 3 },
    );
    const secondPage = await service.getAgentStreamHistoryPage(
      "user-a",
      "assessment-a",
      { cursor: firstPage.nextCursor, limit: 3 },
    );

    expect(firstPage.events.map((event) => event.sequence)).toEqual([4, 5, 6]);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(secondPage.events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(secondPage.hasMore).toBe(false);
    expect(secondPage.nextCursor).toBeNull();
    expect(prisma.assessmentRuntimeEvent.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ take: 4 }),
    );
    expect(prisma.assessmentRuntimeEvent.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        take: 4,
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({ OR: expect.any(Array) }),
          ]),
        }),
      }),
    );
  });

  it("keeps independent durable replay windows per assessment", async () => {
    const assessmentARow = durableAgentStreamRow(1, "assessment-a", "run-a");
    const assessmentBRows = Array.from({ length: 5_001 }, (_, index) =>
      durableAgentStreamRow(index + 1, "assessment-b", "run-b"),
    );
    const prisma = {
      assessment: {
        findMany: jest
          .fn<(args?: unknown) => Promise<Array<{ id: string }>>>()
          .mockResolvedValue([{ id: "assessment-a" }, { id: "assessment-b" }]),
      },
      assessmentRuntimeEvent: {
        findMany: jest.fn(
          ({
            take,
            where,
          }: {
            take?: number;
            where?: { assessmentId?: string };
          }) => {
            expect(take).toBe(2_500);
            const rows =
              where?.assessmentId === "assessment-a"
                ? [assessmentARow]
                : assessmentBRows;
            return Promise.resolve(
              [...rows]
                .sort((left, right) => right.sequence - left.sequence)
                .slice(0, take),
            );
          },
        ),
      },
    };
    const service = new AssessmentRuntimeEventService(prisma as never);

    const replay = await (
      service as unknown as {
        getDurableAgentStreamEvents: (
          ownerId: string,
        ) => Promise<Array<{ assessmentId: string; eventId: string }>>;
      }
    ).getDurableAgentStreamEvents("user-a");

    expect(replay).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assessmentId: "assessment-a",
          eventId: "assessment-a-semantic-1",
        }),
      ]),
    );
    expect(
      replay.filter((event) => event.assessmentId === "assessment-b"),
    ).toHaveLength(2_500);
    expect(replay).toHaveLength(2_501);
  });

  it("caps durable replay work across many assessments and bounds query concurrency", async () => {
    const assessmentIds = Array.from(
      { length: 20 },
      (_, index) => `assessment-${index + 1}`,
    );
    const queryTakes: number[] = [];
    let inFlightQueries = 0;
    let maxInFlightQueries = 0;
    const prisma = {
      assessment: {
        findMany: jest
          .fn<(args?: unknown) => Promise<Array<{ id: string }>>>()
          .mockResolvedValue(assessmentIds.map((id) => ({ id }))),
      },
      assessmentRuntimeEvent: {
        findMany: jest.fn(
          async ({
            take,
            where,
          }: {
            take?: number;
            where?: { assessmentId?: string };
          }) => {
            inFlightQueries += 1;
            maxInFlightQueries = Math.max(maxInFlightQueries, inFlightQueries);
            queryTakes.push(take ?? 0);
            await Promise.resolve();
            inFlightQueries -= 1;
            return Array.from({ length: take ?? 0 }, (_, index) =>
              durableAgentStreamRow(
                index + 1,
                where?.assessmentId ?? "assessment-unknown",
                `${where?.assessmentId ?? "assessment-unknown"}-run`,
              ),
            );
          },
        ),
      },
    };
    const service = new AssessmentRuntimeEventService(prisma as never);

    const replay = await (
      service as unknown as {
        getDurableAgentStreamEvents: (
          ownerId: string,
        ) => Promise<Array<{ assessmentId: string; eventId: string }>>;
      }
    ).getDurableAgentStreamEvents("user-a");

    expect(prisma.assessmentRuntimeEvent.findMany).toHaveBeenCalledTimes(20);
    expect(queryTakes).toEqual(Array.from({ length: 20 }, () => 250));
    expect(maxInFlightQueries).toBeLessThanOrEqual(4);
    expect(replay).toHaveLength(5_000);
    expect(new Set(replay.map((event) => event.assessmentId)).size).toBe(20);
  });

  it("replays explicitly requested durable history beyond the owner-wide assessment cap", async () => {
    const assessmentIds = Array.from(
      { length: 101 },
      (_, index) => `assessment-${index + 1}`,
    );
    const prisma = {
      assessment: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(
            assessmentIds.includes(where.id) ? { ownerId: "user-a" } : null,
          ),
        ),
        findMany: jest.fn(({ take }: { take?: number }) =>
          Promise.resolve(assessmentIds.slice(0, take).map((id) => ({ id }))),
        ),
      },
      assessmentRuntimeEvent: {
        findMany: jest.fn(({ where }: { where?: unknown }) => {
          const assessmentId =
            typeof where === "object" && where !== null
              ? JSON.stringify(where).match(/assessment-\d+/)?.[0]
              : null;
          return Promise.resolve(
            assessmentId ? [durableAgentStreamRow(1, assessmentId)] : [],
          );
        }),
      },
    };
    const service = new AssessmentRuntimeEventService(prisma as never);
    const serviceAccess = service as unknown as {
      getDurableAgentStreamEvents: (
        ownerId: string,
        assessmentId?: string | null,
      ) => Promise<Array<{ assessmentId: string; eventId: string }>>;
    };

    const ownerWideReplay =
      await serviceAccess.getDurableAgentStreamEvents("user-a");
    const scopedReplay = await serviceAccess.getDurableAgentStreamEvents(
      "user-a",
      "assessment-101",
    );

    expect(prisma.assessment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { updatedAt: "desc" },
        take: 100,
      }),
    );
    expect(
      ownerWideReplay.some((event) => event.assessmentId === "assessment-101"),
    ).toBe(false);
    expect(scopedReplay).toEqual([
      expect.objectContaining({
        assessmentId: "assessment-101",
        eventId: "assessment-101-semantic-1",
      }),
    ]);
  });

  it("deduplicates durable replay and live-buffer overlap by event id", async () => {
    const persisted = durableAgentStreamRow(100);
    const prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => Promise<void>) =>
        callback(prisma),
      ),
      assessment: {
        findUnique: jest
          .fn<
            (args: { where: { id: string } }) => Promise<{ ownerId: string }>
          >()
          .mockResolvedValue({ ownerId: "user-a" }),
        findMany: jest
          .fn<(args?: unknown) => Promise<Array<{ id: string }>>>()
          .mockResolvedValue([{ id: "assessment-a" }]),
      },
      assessmentRuntimeEvent: {
        findFirst: jest
          .fn<(args?: unknown) => Promise<{ sequence: number } | null>>()
          .mockResolvedValue({ sequence: 99 }),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({
            id: "runtime-agent-overlap",
            ...data,
            createdAt: new Date("2026-09-20T00:00:00.000Z"),
          }),
        ),
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([persisted]),
      },
    };
    const service = new AssessmentRuntimeEventService(prisma as never);
    const events: string[] = [];

    await service.publishAgentStreamEvent({
      eventId: "assessment-a-semantic-100",
      assessmentId: "assessment-a",
      runId: "run-a",
      correlationId: "corr-a",
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.semanticToolCall,
      agentName: "investigator",
      toolName: "search_nodes",
      toolCallId: "assessment-a-call-100",
      status: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
      data: persisted.outputSummaryJson.agentStreamEvent.data,
    });
    const subscription = service
      .observeAgentStreamEvents("user-a")
      .subscribe((event) => events.push(event.eventId));
    await Promise.resolve();

    expect(events).toEqual(["assessment-a-semantic-100"]);
    subscription.unsubscribe();
  });

  it("bounds long-lived stream dedup state", async () => {
    const prisma = withTransaction({
      assessment: {
        findUnique: jest
          .fn<
            (args: { where: { id: string } }) => Promise<{ ownerId: string }>
          >()
          .mockResolvedValue({ ownerId: "user-a" }),
        findMany: jest
          .fn<(args?: unknown) => Promise<Array<{ id: string }>>>()
          .mockResolvedValue([]),
      },
      assessmentRuntimeEvent: {
        ...agentStreamPersistenceMock(),
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([]),
      },
    });
    const service = new AssessmentRuntimeEventService(prisma as never);
    let duplicateDeliveryCount = 0;
    const subscription = service
      .observeAgentStreamEvents("user-a")
      .subscribe((event) => {
        if (event.eventId === "bounded-duplicate") {
          duplicateDeliveryCount += 1;
        }
      });

    await service.publishAgentStreamEvent({
      eventId: "bounded-duplicate",
      assessmentId: "assessment-a",
      runId: "run-a",
      correlationId: "corr-a",
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelContentDelta,
      text: "first duplicate",
    });
    for (let index = 0; index < 6_000; index += 1) {
      await service.publishAgentStreamEvent({
        eventId: `bounded-unique-${index}`,
        assessmentId: "assessment-a",
        runId: "run-a",
        correlationId: "corr-a",
        eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelContentDelta,
        text: "unique event",
      });
    }
    await service.publishAgentStreamEvent({
      eventId: "bounded-duplicate",
      assessmentId: "assessment-a",
      runId: "run-a",
      correlationId: "corr-a",
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelContentDelta,
      text: "duplicate after eviction",
    });

    expect(duplicateDeliveryCount).toBe(2);
    subscription.unsubscribe();
  });

  it("uses restart-stable live sequence values after persisted replay", async () => {
    const prisma = withTransaction({
      assessment: {
        findUnique: jest
          .fn<
            (args: { where: { id: string } }) => Promise<{ ownerId: string }>
          >()
          .mockResolvedValue({ ownerId: "user-a" }),
        findMany: jest
          .fn<(args?: unknown) => Promise<Array<{ id: string }>>>()
          .mockResolvedValue([{ id: "assessment-a" }]),
      },
      assessmentRuntimeEvent: {
        ...agentStreamPersistenceMock(),
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([durableAgentStreamRow(100)]),
      },
    });
    const service = new AssessmentRuntimeEventService(prisma as never);
    const replay = await (
      service as unknown as {
        getDurableAgentStreamEvents: (
          ownerId: string,
        ) => Promise<Array<{ sequence: number }>>;
      }
    ).getDurableAgentStreamEvents("user-a");

    const live = await service.publishAgentStreamEvent({
      assessmentId: "assessment-a",
      runId: "run-a",
      correlationId: "corr-a",
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelContentDelta,
      text: "after restart",
    });

    expect(live?.sequence).toBeGreaterThan(replay[0]?.sequence ?? 0);
  });

  it("excludes agent stream journal rows from canonical workflow run projections", async () => {
    const canonicalCompletedScanRow = {
      id: "runtime-canonical-completed",
      assessmentId: "assessment-1",
      runId: "scan-1",
      correlationId: "corr-1",
      sequence: 1,
      eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.runCompleted,
      runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.completed,
      stage: ASSESSMENT_RUNTIME_STAGE_CODES.scan,
      toolName: "repository_scan",
      summary: "Repository scan completed",
      inputSummaryJson: null,
      outputSummaryJson: null,
      errorSummary: null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      attempt: null,
      waitingReason: null,
      createdAt: new Date("2026-09-20T00:00:00.000Z"),
    };
    const newerJournalRow = durableAgentStreamRow(2, "assessment-1", "scan-1");
    newerJournalRow.createdAt = new Date("2026-09-20T00:01:00.000Z");
    const prisma = {
      assessmentRuntimeEvent: {
        findMany: jest.fn(({ where }: { where?: unknown }) => {
          const serializedWhere = JSON.stringify(where);
          if (serializedWhere.includes("engineering_rule_plan_summary")) {
            return Promise.resolve([]);
          }
          expect(serializedWhere).toContain("agent_stream_semantic");
          return Promise.resolve([canonicalCompletedScanRow]);
        }),
        findFirst: jest.fn().mockImplementation(freshRuntimeEvent),
      },
      repositorySnapshot: emptyRepositorySnapshots(),
      assessment: assessmentOwner(),
      repositoryScanJob: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([]),
      },
      technicalEvidenceReport: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([]),
      },
    };
    const service = new AssessmentRuntimeEventService(prisma as never);

    const snapshot = await service.buildWorkspaceSnapshot("user-1");

    expect(snapshot.runs).toEqual([
      expect.objectContaining({
        assessmentId: "assessment-1",
        runId: "scan-1",
        status: ASSESSMENT_RUNTIME_RUN_STATUSES.completed,
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.scan,
      }),
    ]);
    expect(snapshot.recentActivity).toEqual([
      expect.objectContaining({
        eventId: "runtime-canonical-completed",
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.completed,
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.scan,
      }),
    ]);
  });

  it("builds orchestration activity from scan jobs and evidence reports when runtime events are absent", async () => {
    const prisma = {
      assessmentRuntimeEvent: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([]),
        findFirst: jest.fn().mockImplementation(freshRuntimeEvent),
      },
      repositorySnapshot: emptyRepositorySnapshots(),
      assessment: assessmentOwner(),
      repositoryScanJob: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([
            {
              id: "scan-1",
              assessmentId: "assessment-1",
              snapshotId: "snapshot-1",
              status: "COMPLETED",
              attemptCount: 1,
              blockedReason: null,
              updatedAt: new Date("2026-08-14T08:00:00.000Z"),
            },
          ]),
      },
      technicalEvidenceReport: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([
            {
              id: "report-1",
              assessmentId: "assessment-1",
              scanJobId: "scan-1",
              snapshotId: "snapshot-1",
              status: "ACCEPTED",
              rejectionReason: null,
              createdAt: new Date("2026-08-14T08:01:00.000Z"),
            },
          ]),
      },
    };
    const service = new AssessmentRuntimeEventService(prisma as never);

    const snapshot = await service.buildWorkspaceSnapshot("user-1");

    expect(prisma.assessmentRuntimeEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { assessment: { ownerId: "user-1" } },
            { NOT: { toolName: "agent_stream_semantic" } },
          ],
        },
      }),
    );
    expect(prisma.repositorySnapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { assessment: { ownerId: "user-1" } } }),
    );
    expect(prisma.repositoryScanJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { assessment: { ownerId: "user-1" } } }),
    );
    expect(prisma.technicalEvidenceReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { assessment: { ownerId: "user-1" } } }),
    );

    expect(snapshot.recentActivity).toEqual([
      expect.objectContaining({
        eventId: "technical-evidence-report:report-1:ACCEPTED",
        assessmentId: "assessment-1",
        runId: "scan-1",
        eventType: "TOOL_COMPLETED",
        runStatus: "COMPLETED",
        stage: "TECHNICAL_EVIDENCE",
        toolName: "technical_evidence_report",
        summary: "Technical evidence report was accepted",
      }),
      expect.objectContaining({
        eventId: "scan-job:scan-1:COMPLETED",
        assessmentId: "assessment-1",
        runId: "scan-1",
        eventType: "TOOL_COMPLETED",
        runStatus: "COMPLETED",
        stage: "SCAN",
        toolName: "repository_scan",
        summary: "Repository scan completed",
      }),
    ]);
  });

  it("refreshes running synthetic scan activity on each workspace snapshot", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-14T08:02:00.000Z"));
    const prisma = {
      assessmentRuntimeEvent: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([]),
        findFirst: jest.fn().mockImplementation(freshRuntimeEvent),
      },
      repositorySnapshot: emptyRepositorySnapshots(),
      assessment: assessmentOwner(),
      repositoryScanJob: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([
            {
              id: "scan-1",
              assessmentId: "assessment-1",
              snapshotId: "snapshot-1",
              status: "RUNNING",
              attemptCount: 1,
              blockedReason: null,
              updatedAt: new Date("2026-08-14T08:00:00.000Z"),
            },
          ]),
      },
      technicalEvidenceReport: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([]),
      },
    };
    const service = new AssessmentRuntimeEventService(prisma as never);

    const snapshot = await service.buildWorkspaceSnapshot();

    expect(snapshot.recentActivity).toEqual([
      expect.objectContaining({
        eventId: "scan-job:scan-1:RUNNING",
        emittedAt: "2026-08-14T08:02:00.000Z",
        outputSummary: {
          status: "RUNNING",
          observedAt: "2026-08-14T08:02:00.000Z",
        },
      }),
    ]);
  });

  it("projects canonical engineering progress independently of the recent activity cap", async () => {
    const events = [
      {
        id: "evt-plan-summary",
        assessmentId: "assessment-1",
        runId: "scan-1",
        correlationId: "corr-1",
        sequence: 1,
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.waiting,
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.technicalEvidence,
        toolName: "engineering_rule_plan_summary",
        summary: "ENGINEERING_RULE_PLANNER_DECISION",
        inputSummaryJson: null,
        outputSummaryJson: {
          planningBatchId: "scan-1:context:12",
          contextRevisionUsed: 12,
          candidateCount: 41,
          selectedCount: 19,
          skippedCount: 22,
          targeted: false,
        },
        errorSummary: null,
        startedAt: null,
        completedAt: null,
        durationMs: null,
        attempt: null,
        waitingReason: null,
        createdAt: new Date("2026-08-14T08:00:00.000Z"),
      },
      ...Array.from({ length: 13 }, (_, index) => ({
        id: `evt-investigated-${index + 1}`,
        assessmentId: "assessment-1",
        runId: "scan-1",
        correlationId: "corr-1",
        sequence: index + 2,
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.waiting,
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.technicalEvidence,
        toolName: `engineering_rule_investigation:eng-${index + 1}`,
        summary: "ENGINEERING_RULE_INVESTIGATED",
        inputSummaryJson: null,
        outputSummaryJson: { evaluationStatus: "MET" },
        errorSummary: null,
        startedAt: null,
        completedAt: null,
        durationMs: null,
        attempt: null,
        waitingReason: null,
        createdAt: new Date(
          `2026-08-14T08:00:${String(index + 1).padStart(2, "0")}.000Z`,
        ),
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        id: `evt-limited-${index + 1}`,
        assessmentId: "assessment-1",
        runId: "scan-1",
        correlationId: "corr-1",
        sequence: index + 20,
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolFailed,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.technicalEvidence,
        toolName: `engineering_rule_investigation:eng-${index + 14}`,
        summary: "ENGINEERING_RULE_INVESTIGATION_FAILED",
        inputSummaryJson: null,
        outputSummaryJson: {},
        errorSummary: "EvidenceUnavailable",
        startedAt: null,
        completedAt: null,
        durationMs: null,
        attempt: null,
        waitingReason: null,
        createdAt: new Date(`2026-08-14T08:01:0${index}.000Z`),
      })),
      ...Array.from({ length: 55 }, (_, index) => ({
        id: `evt-noise-${index + 1}`,
        assessmentId: "assessment-1",
        runId: "scan-1",
        correlationId: "corr-1",
        sequence: index + 100,
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolStarted,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.technicalEvidence,
        toolName: `non_progress:${index + 1}`,
        summary: "Noise",
        inputSummaryJson: null,
        outputSummaryJson: null,
        errorSummary: null,
        startedAt: null,
        completedAt: null,
        durationMs: null,
        attempt: null,
        waitingReason: null,
        createdAt: new Date(
          `2026-08-14T08:02:${String(index).padStart(2, "0")}.000Z`,
        ),
      })),
    ];
    const prisma = {
      assessmentRuntimeEvent: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue(events),
        findFirst: jest.fn().mockImplementation(freshRuntimeEvent),
      },
      repositorySnapshot: emptyRepositorySnapshots(),
      assessment: assessmentOwner(),
      repositoryScanJob: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([]),
      },
      technicalEvidenceReport: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([]),
      },
    };
    const service = new AssessmentRuntimeEventService(prisma as never);

    const snapshot = await service.buildWorkspaceSnapshot();

    expect(snapshot.recentActivity).toHaveLength(50);
    expect(snapshot.engineeringProgress).toEqual([
      expect.objectContaining({
        assessmentId: "assessment-1",
        runId: "scan-1",
        planningBatchId: "scan-1:context:12",
        approximate: false,
        planner: {
          candidateCount: 41,
          selectedCount: 19,
          skippedCount: 22,
        },
        investigator: expect.objectContaining({
          selectedCount: 19,
          completedCount: 13,
          domainLimitedCount: 3,
          runtimeFailedCount: 0,
          pendingCount: 3,
        }),
      }),
    ]);
  });

  it("derives the latest post-finding state from runtime event output summaries", async () => {
    const prisma = {
      assessmentRuntimeEvent: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([
            {
              id: "evt-latest",
              assessmentId: "assessment-1",
              runId: "interview:assessment-1",
              correlationId: "corr-1",
              sequence: 2,
              eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolWaitingInput,
              runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.waiting,
              stage: ASSESSMENT_RUNTIME_STAGE_CODES.remediation,
              toolName: "post_finding_remediation_decision",
              summary: "Customer remediation decision persisted",
              inputSummaryJson: null,
              outputSummaryJson: {
                postFinding: {
                  assessmentId: "assessment-1",
                  phase: POST_FINDING_RUNTIME_PHASES.createPr,
                  codeReviewActivities: [],
                  decisionAvailability: [
                    REMEDIATION_DECISIONS.createRemediationPr,
                  ],
                  selectedDecision: REMEDIATION_DECISIONS.createRemediationPr,
                  selectedDecisionAt: "2026-09-07T01:02:03.000Z",
                  approvalStatus: REMEDIATION_APPROVAL_STATUSES.pendingCustomer,
                  verificationActivities: [],
                },
              },
              errorSummary: null,
              startedAt: null,
              completedAt: null,
              durationMs: null,
              attempt: null,
              waitingReason: null,
              createdAt: new Date("2026-09-07T01:02:03.000Z"),
            },
          ]),
        findFirst: jest.fn().mockImplementation(freshRuntimeEvent),
      },
      repositorySnapshot: emptyRepositorySnapshots(),
      assessment: assessmentOwner(),
      repositoryScanJob: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([]),
      },
      technicalEvidenceReport: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([]),
      },
    };
    const service = new AssessmentRuntimeEventService(prisma as never);

    const snapshot = await service.buildWorkspaceSnapshot();

    expect(snapshot.postFindingStates).toEqual([
      expect.objectContaining({
        assessmentId: "assessment-1",
        phase: POST_FINDING_RUNTIME_PHASES.createPr,
        selectedDecision: REMEDIATION_DECISIONS.createRemediationPr,
      }),
    ]);
  });

  it("records waiting-input on a caller transaction without nesting", async () => {
    const assessmentRuntimeEvent = {
      findFirst: jest
        .fn<(args: unknown) => Promise<{ sequence: number } | null>>()
        .mockResolvedValue({ sequence: 6 }),
      create: jest
        .fn<(args: unknown) => Promise<Record<string, never>>>()
        .mockResolvedValue({}),
    };
    const tx = { assessmentRuntimeEvent };
    const prisma = {
      $transaction: jest.fn(),
    };
    const service = new AssessmentRuntimeEventService(prisma as never);

    await service.recordToolWaitingInput(
      {
        assessmentId: "assessment-1",
        runId: "run-1",
        correlationId: "corr-1",
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.interview,
        toolName: "interview",
        summary: "Waiting for Customer input.",
        waitingReason: "INTERVIEW_STARTED",
      },
      tx as never,
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(assessmentRuntimeEvent.findFirst).toHaveBeenCalledWith({
      where: { runId: "run-1" },
      orderBy: [{ sequence: "desc" }],
      select: { sequence: true },
    });
    expect(assessmentRuntimeEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assessmentId: "assessment-1",
        runId: "run-1",
        sequence: 7,
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolWaitingInput,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.waiting,
        waitingReason: "INTERVIEW_STARTED",
      }),
    });
  });

  it("records scanner-worker runtime events using scan-job tenant context", async () => {
    const assessmentRuntimeEvent = {
      findFirst: jest.fn().mockImplementation(() => Promise.resolve(null)),
      create: jest.fn().mockImplementation(() => Promise.resolve({})),
    };
    const prisma = {
      assessment: assessmentOwner(),
      repositoryScanJob: {
        findUnique: jest.fn().mockImplementation(() =>
          Promise.resolve({
            id: "scan-1",
            assessmentId: "assessment-1",
            correlationId: "corr-1",
            status: "RUNNING",
          }),
        ),
      },
      $transaction: jest.fn(
        (
          handler: (tx: {
            assessmentRuntimeEvent: typeof assessmentRuntimeEvent;
          }) => unknown,
        ) => Promise.resolve(handler({ assessmentRuntimeEvent })),
      ),
    };
    const service = new AssessmentRuntimeEventService(prisma as never);

    await expect(
      service.recordScanWorkerEvent({
        scanJobId: "scan-1",
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.scan,
        toolName: "syft",
        summary: "syft completed with non-blocking failure",
        outputSummary: { outcome: "tool_failure" },
        errorSummary: "syft not available",
        startedAt: new Date("2026-08-14T08:00:00.000Z"),
        completedAt: new Date("2026-08-14T08:00:01.000Z"),
        durationMs: 1000,
      }),
    ).resolves.toEqual({ recorded: true });

    expect(assessmentRuntimeEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assessmentId: "assessment-1",
        runId: "scan-1",
        correlationId: "corr-1",
        sequence: 1,
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.scan,
        toolName: "syft",
        outputSummaryJson: { outcome: "tool_failure" },
        errorSummary: "syft not available",
        durationMs: 1000,
      }),
    });
  });

  it("retries scanner-worker runtime event sequence collisions", async () => {
    const sequenceCollision = Object.assign(
      new Error(
        'Unique constraint failed on the fields: ("runId", "sequence")',
      ),
      {
        code: "P2002",
        meta: { target: ["runId", "sequence"] },
      },
    );
    const assessmentRuntimeEvent = {
      findFirst: jest
        .fn<() => Promise<{ sequence: number } | null>>()
        .mockResolvedValueOnce({ sequence: 4 })
        .mockResolvedValueOnce({ sequence: 5 })
        .mockResolvedValueOnce({ sequence: 6 }),
      create: jest
        .fn<(args: unknown) => Promise<unknown>>()
        .mockRejectedValueOnce(sequenceCollision)
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({}),
    };
    const prisma = {
      assessment: assessmentOwner(),
      repositoryScanJob: {
        findUnique: jest.fn().mockImplementation(() =>
          Promise.resolve({
            id: "scan-1",
            assessmentId: "assessment-1",
            correlationId: "corr-1",
            status: "RUNNING",
          }),
        ),
      },
      $transaction: jest.fn(
        (
          handler: (tx: {
            assessmentRuntimeEvent: typeof assessmentRuntimeEvent;
          }) => unknown,
        ) => Promise.resolve(handler({ assessmentRuntimeEvent })),
      ),
    };
    const service = new AssessmentRuntimeEventService(prisma as never);

    await expect(
      service.recordScanWorkerEvent({
        scanJobId: "scan-1",
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolStarted,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.scan,
        toolName: "semgrep",
        summary: "Running semgrep analysis",
      }),
    ).resolves.toEqual({ recorded: true });

    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(assessmentRuntimeEvent.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        runId: "scan-1",
        sequence: 5,
      }),
    });
    expect(assessmentRuntimeEvent.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        runId: "scan-1",
        sequence: 6,
      }),
    });
    expect(assessmentRuntimeEvent.create).toHaveBeenNthCalledWith(3, {
      data: expect.objectContaining({
        runId: "scan-1",
        sequence: 7,
        toolName: "agent_stream_semantic",
      }),
    });
  });

  it("skips late scanner-worker start events after the scan job is terminal", async () => {
    const assessmentRuntimeEvent = {
      findFirst: jest.fn().mockImplementation(() => Promise.resolve(null)),
      create: jest.fn().mockImplementation(() => Promise.resolve({})),
    };
    const prisma = {
      assessment: assessmentOwner(),
      repositoryScanJob: {
        findUnique: jest.fn().mockImplementation(() =>
          Promise.resolve({
            id: "scan-1",
            assessmentId: "assessment-1",
            correlationId: "corr-1",
            status: "COMPLETED",
          }),
        ),
      },
      $transaction: jest.fn(
        (
          handler: (tx: {
            assessmentRuntimeEvent: typeof assessmentRuntimeEvent;
          }) => unknown,
        ) => Promise.resolve(handler({ assessmentRuntimeEvent })),
      ),
    };
    const service = new AssessmentRuntimeEventService(prisma as never);

    await expect(
      service.recordScanWorkerEvent({
        scanJobId: "scan-1",
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolStarted,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.scan,
        toolName: "late_tool",
        summary: "Late tool started",
      }),
    ).resolves.toEqual({ recorded: false, reason: "terminal" });

    expect(assessmentRuntimeEvent.create).not.toHaveBeenCalled();
  });

  it("records scanner-worker terminal close events after the scan job is terminal", async () => {
    const assessmentRuntimeEvent = {
      findFirst: jest.fn().mockImplementation(() => Promise.resolve(null)),
      create: jest.fn().mockImplementation(() => Promise.resolve({})),
    };
    const prisma = {
      assessment: assessmentOwner(),
      repositoryScanJob: {
        findUnique: jest.fn().mockImplementation(() =>
          Promise.resolve({
            id: "scan-1",
            assessmentId: "assessment-1",
            correlationId: "corr-1",
            status: "COMPLETED",
          }),
        ),
      },
      $transaction: jest.fn(
        (
          handler: (tx: {
            assessmentRuntimeEvent: typeof assessmentRuntimeEvent;
          }) => unknown,
        ) => Promise.resolve(handler({ assessmentRuntimeEvent })),
      ),
    };
    const service = new AssessmentRuntimeEventService(prisma as never);

    await expect(
      service.recordScanWorkerEvent({
        scanJobId: "scan-1",
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.runCompleted,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.completed,
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.scan,
        toolName: "repository_scan",
        summary: "Repository scan completed",
      }),
    ).resolves.toEqual({ recorded: true });

    expect(assessmentRuntimeEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assessmentId: "assessment-1",
        runId: "scan-1",
        correlationId: "corr-1",
        sequence: 1,
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.runCompleted,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.completed,
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.scan,
        toolName: "repository_scan",
      }),
    });
  });

  it("does not build synthetic scan activity when persisted worker activity exists", async () => {
    const prisma = {
      assessmentRuntimeEvent: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([
            {
              id: "evt-1",
              assessmentId: "assessment-1",
              runId: "scan-1",
              correlationId: "corr-1",
              sequence: 1,
              eventType: "TOOL_STARTED",
              runStatus: "RUNNING",
              stage: "SCAN",
              toolName: "materialize_snapshot",
              summary: "Materializing repository snapshot",
              inputSummaryJson: null,
              outputSummaryJson: null,
              errorSummary: null,
              startedAt: null,
              completedAt: null,
              durationMs: null,
              attempt: null,
              waitingReason: null,
              createdAt: new Date("2026-08-14T08:00:00.000Z"),
            },
          ]),
        findFirst: jest.fn().mockImplementation(freshRuntimeEvent),
      },
      repositorySnapshot: emptyRepositorySnapshots(),
      assessment: assessmentOwner(),
      repositoryScanJob: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([
            {
              id: "scan-1",
              assessmentId: "assessment-1",
              snapshotId: "snapshot-1",
              status: "RUNNING",
              attemptCount: 1,
              blockedReason: null,
              updatedAt: new Date("2026-08-14T07:59:00.000Z"),
            },
          ]),
      },
      technicalEvidenceReport: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([]),
      },
    };
    const service = new AssessmentRuntimeEventService(prisma as never);

    const snapshot = await service.buildWorkspaceSnapshot();

    expect(snapshot.recentActivity).toHaveLength(1);
    expect(snapshot.recentActivity[0]).toEqual(
      expect.objectContaining({
        eventId: "evt-1",
        toolName: "materialize_snapshot",
      }),
    );
  });

  describe("durable engineering progress", () => {
    type MockRuntimeEventRow = Record<string, unknown> & {
      assessmentId: string;
      runId: string;
      sequence: number;
      toolName: string | null;
      createdAt: Date;
    };

    const baseTime = new Date("2026-09-14T08:00:00.000Z");

    const runtimeEventRow = (
      overrides: Partial<MockRuntimeEventRow> &
        Pick<MockRuntimeEventRow, "id" | "sequence" | "eventType" | "toolName">,
    ): MockRuntimeEventRow => ({
      assessmentId: "assessment-live",
      runId: "scan-live",
      correlationId: "corr-live",
      runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.waiting,
      stage: ASSESSMENT_RUNTIME_STAGE_CODES.technicalEvidence,
      summary: "live scenario row",
      inputSummaryJson: null,
      outputSummaryJson: null,
      errorSummary: null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      attempt: null,
      waitingReason: null,
      createdAt: new Date(baseTime.getTime() + overrides.sequence * 1_000),
      ...overrides,
    });

    const liveScenarioEvents = (): MockRuntimeEventRow[] => {
      const events: MockRuntimeEventRow[] = [
        runtimeEventRow({
          id: "evt-live-summary",
          sequence: 1,
          eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
          toolName: "engineering_rule_plan_summary",
          outputSummaryJson: {
            planningBatchId: "scan-live:context:12",
            contextRevisionUsed: 12,
            candidateCount: 41,
            selectedCount: 19,
            skippedCount: 22,
            targeted: false,
          },
        }),
      ];
      for (let index = 1; index <= 41; index += 1) {
        events.push(
          runtimeEventRow({
            id: `evt-live-plan-${index}`,
            sequence: index + 1,
            eventType:
              index <= 19
                ? ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted
                : ASSESSMENT_RUNTIME_EVENT_TYPES.toolSkipped,
            toolName: `engineering_rule_plan:eng-${index}`,
          }),
        );
      }
      for (let index = 1; index <= 13; index += 1) {
        events.push(
          runtimeEventRow({
            id: `evt-live-investigated-${index}`,
            sequence: index + 42,
            eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
            toolName: `engineering_rule_investigation:eng-${index}`,
          }),
        );
      }
      for (let index = 14; index <= 16; index += 1) {
        events.push(
          runtimeEventRow({
            id: `evt-live-limited-${index}`,
            sequence: index + 42,
            eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolFailed,
            runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
            toolName: `engineering_rule_investigation:eng-${index}`,
            outputSummaryJson: {},
            errorSummary: "EvidenceUnavailable",
          }),
        );
      }
      return events;
    };

    const noiseEvent = (sequence: number): MockRuntimeEventRow =>
      runtimeEventRow({
        id: `evt-live-noise-${sequence}`,
        sequence,
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolStarted,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
        toolName: `non_progress:${sequence}`,
      });

    const buildFilteringPrisma = (
      allEvents: MockRuntimeEventRow[],
      windowRows: MockRuntimeEventRow[],
    ) => {
      const findMany = jest
        .fn<(args: Record<string, unknown>) => Promise<unknown[]>>()
        .mockImplementation((args) => {
          const where = (args.where ?? {}) as Record<string, unknown>;
          const take = typeof args.take === "number" ? args.take : undefined;
          const serializedWhere = JSON.stringify(where);
          if (
            Object.keys(where).length === 0 ||
            serializedWhere.includes("agent_stream_semantic")
          ) {
            return Promise.resolve(
              [...windowRows]
                .sort(
                  (left, right) =>
                    right.createdAt.getTime() - left.createdAt.getTime() ||
                    right.sequence - left.sequence,
                )
                .slice(0, take),
            );
          }
          let rows = allEvents;
          if (typeof where.runId === "string") {
            rows = rows.filter((row) => row.runId === where.runId);
          }
          const sequence = where.sequence as { gt?: number } | undefined;
          if (sequence && typeof sequence.gt === "number") {
            rows = rows.filter((row) => row.sequence > sequence.gt!);
          }
          const toolName = where.toolName;
          if (typeof toolName === "string") {
            rows = rows.filter((row) => row.toolName === toolName);
          } else if (
            toolName &&
            typeof toolName === "object" &&
            typeof (toolName as { startsWith?: unknown }).startsWith ===
              "string"
          ) {
            const prefix = (toolName as { startsWith: string }).startsWith;
            rows = rows.filter((row) => row.toolName?.startsWith(prefix));
          }
          if (typeof where.stage === "string") {
            rows = rows.filter((row) => row.stage === where.stage);
          }
          if (typeof where.assessmentId === "string") {
            rows = rows.filter(
              (row) => row.assessmentId === where.assessmentId,
            );
          }
          return Promise.resolve(
            [...rows].sort(
              (left, right) =>
                right.createdAt.getTime() - left.createdAt.getTime() ||
                right.sequence - left.sequence,
            ),
          );
        });
      return {
        assessmentRuntimeEvent: {
          findMany,
          findFirst: jest.fn().mockImplementation(freshRuntimeEvent),
        },
        repositorySnapshot: emptyRepositorySnapshots(),
        assessment: assessmentOwner(),
        repositoryScanJob: {
          findMany: jest
            .fn<(args?: unknown) => Promise<unknown[]>>()
            .mockResolvedValue([]),
        },
        technicalEvidenceReport: {
          findMany: jest
            .fn<(args?: unknown) => Promise<unknown[]>>()
            .mockResolvedValue([]),
        },
      };
    };

    it("keeps canonical planner and investigator totals when every planner event has been evicted from the recent-activity window", async () => {
      const events = liveScenarioEvents();
      const prisma = buildFilteringPrisma(
        events,
        Array.from({ length: 60 }, (_, index) => noiseEvent(index + 60)),
      );
      const service = new AssessmentRuntimeEventService(prisma as never);

      const snapshot = await service.buildWorkspaceSnapshot();

      expect(snapshot.recentActivity).toHaveLength(50);
      expect(
        snapshot.recentActivity.some((item) =>
          item.toolName?.startsWith("engineering_rule_plan"),
        ),
      ).toBe(false);

      expect(snapshot.engineeringProgress).toEqual([
        expect.objectContaining({
          assessmentId: "assessment-live",
          runId: "scan-live",
          planningBatchId: "scan-live:context:12",
          approximate: false,
          planner: {
            candidateCount: 41,
            selectedCount: 19,
            skippedCount: 22,
          },
          investigator: expect.objectContaining({
            selectedCount: 19,
            completedCount: 13,
            domainLimitedCount: 3,
            runtimeFailedCount: 0,
            waitingForInputCount: 0,
            pendingCount: 3,
          }),
        }),
      ]);
    });

    it("advances investigator progress without changing the planner denominator", async () => {
      const events = [
        ...liveScenarioEvents(),
        runtimeEventRow({
          id: "evt-live-investigated-14",
          sequence: 60,
          eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
          toolName: "engineering_rule_investigation:eng-17",
        }),
      ];
      const prisma = buildFilteringPrisma(
        events,
        Array.from({ length: 60 }, (_, index) => noiseEvent(index + 61)),
      );
      const service = new AssessmentRuntimeEventService(prisma as never);

      const snapshot = await service.buildWorkspaceSnapshot();

      expect(snapshot.engineeringProgress[0]?.planner).toEqual({
        candidateCount: 41,
        selectedCount: 19,
        skippedCount: 22,
      });
      expect(snapshot.engineeringProgress[0]?.investigator).toEqual(
        expect.objectContaining({
          selectedCount: 19,
          completedCount: 14,
          domainLimitedCount: 3,
          runtimeFailedCount: 0,
          pendingCount: 2,
        }),
      );
    });

    it("separates runtime failures from domain limitations and counts waiting-for-input", async () => {
      const events = [
        runtimeEventRow({
          id: "evt-rt-summary",
          sequence: 1,
          eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
          toolName: "engineering_rule_plan_summary",
          outputSummaryJson: {
            planningBatchId: "scan-live:context:2",
            candidateCount: 4,
            selectedCount: 4,
            skippedCount: 0,
          },
        }),
        runtimeEventRow({
          id: "evt-rt-ok",
          sequence: 2,
          eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
          toolName: "engineering_rule_investigation:eng-1",
        }),
        runtimeEventRow({
          id: "evt-rt-limited",
          sequence: 3,
          eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolFailed,
          runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
          toolName: "engineering_rule_investigation:eng-2",
          outputSummaryJson: {},
        }),
        runtimeEventRow({
          id: "evt-rt-runtime-failed",
          sequence: 4,
          eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolFailed,
          runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
          toolName: "engineering_rule_investigation:eng-3",
          outputSummaryJson: {
            failureKind: "RUNTIME_ERROR",
            executionFailure: "CALLBACK_ERROR",
          },
        }),
        runtimeEventRow({
          id: "evt-rt-waiting",
          sequence: 5,
          eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolWaitingInput,
          toolName: "engineering_rule_investigation:eng-4",
          outputSummaryJson: { outcome: "NEEDS_INPUT" },
        }),
      ];
      const prisma = buildFilteringPrisma(events, []);
      const service = new AssessmentRuntimeEventService(prisma as never);

      const snapshot = await service.buildWorkspaceSnapshot();

      expect(snapshot.engineeringProgress[0]?.investigator).toEqual({
        selectedCount: 4,
        completedCount: 1,
        domainLimitedCount: 1,
        limitedOrFailedCount: 2,
        waitingForInputCount: 1,
        runtimeFailedCount: 1,
        pendingCount: 0,
      });
    });

    it("prefers the newest planning batch for the run on targeted resume", async () => {
      const events = [
        ...liveScenarioEvents(),
        runtimeEventRow({
          id: "evt-targeted-summary",
          sequence: 200,
          eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
          toolName: "engineering_rule_plan_summary",
          outputSummaryJson: {
            planningBatchId: "scan-live:context:13",
            contextRevisionUsed: 13,
            candidateCount: 19,
            selectedCount: 1,
            skippedCount: 18,
            targeted: true,
          },
        }),
        runtimeEventRow({
          id: "evt-targeted-investigated",
          sequence: 201,
          eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
          toolName: "engineering_rule_investigation:eng-3",
        }),
      ];
      const prisma = buildFilteringPrisma(events, []);
      const service = new AssessmentRuntimeEventService(prisma as never);

      const snapshot = await service.buildWorkspaceSnapshot();

      expect(snapshot.engineeringProgress).toHaveLength(1);
      expect(snapshot.engineeringProgress[0]).toEqual(
        expect.objectContaining({
          planningBatchId: "scan-live:context:13",
          targeted: true,
          planner: {
            candidateCount: 19,
            selectedCount: 1,
            skippedCount: 18,
          },
          investigator: expect.objectContaining({
            selectedCount: 1,
            completedCount: 1,
            pendingCount: 0,
          }),
        }),
      );
    });

    it("keeps stale previous runs durable while newer runs sort first", async () => {
      const staleRun = liveScenarioEvents().map((row) => ({
        ...row,
        assessmentId: "assessment-stale",
        runId: "scan-stale",
      }));
      const currentRun = [
        runtimeEventRow({
          id: "evt-current-summary",
          sequence: 1,
          eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
          toolName: "engineering_rule_plan_summary",
          outputSummaryJson: {
            planningBatchId: "scan-live:context:5",
            candidateCount: 10,
            selectedCount: 5,
            skippedCount: 5,
          },
        }),
      ];
      const prisma = buildFilteringPrisma([...staleRun, ...currentRun], []);
      const service = new AssessmentRuntimeEventService(prisma as never);

      const snapshot = await service.buildWorkspaceSnapshot();

      expect(snapshot.engineeringProgress).toHaveLength(2);
      expect(snapshot.engineeringProgress[0]?.runId).toBe("scan-live");
      expect(snapshot.engineeringProgress[1]?.runId).toBe("scan-stale");
      expect(snapshot.engineeringProgress[1]?.planner).toEqual({
        candidateCount: 41,
        selectedCount: 19,
        skippedCount: 22,
      });
    });
  });
});
