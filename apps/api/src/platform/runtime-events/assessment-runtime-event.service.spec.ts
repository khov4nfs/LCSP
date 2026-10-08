import { describe, expect, it, jest } from "@jest/globals";
import {
  ASSESSMENT_AGENT_STREAM_DURABILITY,
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES,
  ASSESSMENT_AGENT_STREAM_SCHEMA_VERSIONS,
  ASSESSMENT_AGENT_STREAM_SEMANTIC_KINDS,
  ASSESSMENT_RUNTIME_EVENT_TYPES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  ASSESSMENT_RUNTIME_CONTROL_STATES,
  ASSESSMENT_RUNTIME_STAGE_CODES,
} from "@lcsp/contracts/evidence";
import {
  AGENT_EXECUTION_STATES,
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
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
  findMany: jest
    .fn<(args?: unknown) => Promise<unknown[]>>()
    .mockResolvedValue([]),
});

const emptyCanonicalProjection = () => ({
  assessmentRuntime: {
    findMany: jest
      .fn<(args?: unknown) => Promise<unknown[]>>()
      .mockResolvedValue([]),
  },
  assessmentEvent: {
    findMany: jest
      .fn<(args?: unknown) => Promise<unknown[]>>()
      .mockResolvedValue([]),
  },
});

function canonicalSnapshotPrisma(
  runtimeRows: unknown[] | Promise<unknown[]> = [],
  eventRows: unknown[] = [],
) {
  const assessmentRows = Array.isArray(runtimeRows)
    ? runtimeRows.map((runtimeRow) => {
        const row = runtimeRow as Record<string, unknown>;
        if ("runtime" in row) return row;
        const lifecycle = row.assessment as Record<string, unknown>;
        return {
          id: row.assessmentId,
          lifecycleState: lifecycle.lifecycleState ?? null,
          lifecycleRevision: lifecycle.lifecycleRevision ?? null,
          blockerReason: lifecycle.blockerReason ?? null,
          blockerReference: lifecycle.blockerReference ?? null,
          runtime: {
            threadId: row.threadId,
            rootAgentVersion: row.rootAgentVersion,
            checkpointNamespace: row.checkpointNamespace,
            checkpointId: row.checkpointId,
            currentExecutionId: row.currentExecutionId,
            executionState: row.executionState,
            eventSequence: row.eventSequence,
            startedAt: row.startedAt,
            lastResumedAt: row.lastResumedAt,
            updatedAt: row.updatedAt,
          },
        };
      })
    : runtimeRows;
  return {
    ...emptyCanonicalProjection(),
    assessmentRuntimeEvent: {
      findMany: jest
        .fn<(args?: unknown) => Promise<unknown[]>>()
        .mockResolvedValue([]),
    },
    assessmentRuntime: {
      findMany: jest
        .fn<(args?: unknown) => Promise<unknown[]>>()
        .mockImplementation(() => Promise.resolve(runtimeRows)),
    },
    assessmentEvent: {
      findMany: jest
        .fn<(args?: unknown) => Promise<unknown[]>>()
        .mockResolvedValue(eventRows),
    },
    repositorySnapshot: emptyRepositorySnapshots(),
    assessment: {
      ...assessmentOwner(),
      findMany: jest
        .fn<(args?: unknown) => Promise<unknown[]>>()
        .mockImplementation(() => Promise.resolve(assessmentRows)),
    },
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
}

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
      engineeringRuleId: "ER-7",
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
      engineeringRuleId: "ER-7",
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
      "model-call-timeout",
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
      eventId: "model-call-timeout",
      eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallTimeout,
      nodeName: "model",
      status: ASSESSMENT_RUNTIME_RUN_STATUSES.failed,
      text: "Model call timed out",
      data: {
        provider: "google_genai",
        model: "gemini-3.5-flash-lite",
        elapsed_seconds: 30,
        timeout_seconds: 30,
      },
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
      ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallTimeout,
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

  it("builds the workspace snapshot from canonical assessment authority only, without V1 run/activity projections", async () => {
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
          if (serializedWhere.includes("rule_analysis_summary")) {
            return Promise.resolve([]);
          }
          expect(serializedWhere).toContain("agent_stream_semantic");
          return Promise.resolve([canonicalCompletedScanRow]);
        }),
        findFirst: jest.fn().mockImplementation(freshRuntimeEvent),
      },
      assessmentRuntime: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([
            {
              assessmentId: "11111111-1111-4111-8111-111111111111",
              threadId: "22222222-2222-4222-8222-222222222222",
              rootAgentVersion: "assessment-root-v2",
              checkpointNamespace: "11111111-1111-4111-8111-111111111111",
              executionState: AGENT_EXECUTION_STATES.RUNNING,
              eventSequence: 4,
              currentExecutionId: "33333333-3333-4333-8333-333333333333",
              checkpointId: "44444444-4444-4444-8444-444444444444",
              startedAt: new Date("2026-09-20T00:00:00.000Z"),
              lastResumedAt: null,
              updatedAt: new Date("2026-09-20T00:02:00.000Z"),
              assessment: {
                lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
                lifecycleRevision: 3,
                blockerReason: null,
                blockerReference: null,
              },
            },
          ]),
      },
      assessmentEvent: {
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([
            {
              eventId: "55555555-5555-4555-8555-555555555555",
              assessmentId: "11111111-1111-4111-8111-111111111111",
              threadId: "22222222-2222-4222-8222-222222222222",
              sequence: 4,
              timestamp: new Date("2026-09-20T00:02:00.000Z"),
              eventType:
                AGENTIC_ASSESSMENT_EVENT_TYPES.ASSESSMENT_LIFECYCLE_CHANGED,
              actorType: ASSESSMENT_EVENT_ACTOR_TYPES.API,
              executionId: null,
              parentExecutionId: null,
              taskId: null,
              toolCallId: null,
              payload: {
                fromState: ASSESSMENT_LIFECYCLE_STATES.PREPARING,
                toState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
                assessmentRevision: 3,
              },
            },
          ]),
      },
      repositorySnapshot: emptyRepositorySnapshots(),
      assessment: {
        ...assessmentOwner(),
        findMany: jest
          .fn<(args?: unknown) => Promise<unknown[]>>()
          .mockResolvedValue([
            {
              id: "11111111-1111-4111-8111-111111111111",
              lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
              lifecycleRevision: 3,
              blockerReason: null,
              blockerReference: null,
              runtime: {
                threadId: "22222222-2222-4222-8222-222222222222",
                rootAgentVersion: "assessment-root-v2",
                checkpointNamespace: "11111111-1111-4111-8111-111111111111",
                checkpointId: "44444444-4444-4444-8444-444444444444",
                currentExecutionId: "33333333-3333-4333-8333-333333333333",
                executionState: AGENT_EXECUTION_STATES.RUNNING,
                eventSequence: 4,
                startedAt: new Date("2026-09-20T00:00:00.000Z"),
                lastResumedAt: null,
                updatedAt: new Date("2026-09-20T00:02:00.000Z"),
              },
            },
          ]),
      },
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

    expect(snapshot.runs).toEqual([]);
    expect(snapshot.recentActivity).toEqual([]);
    expect(snapshot.engineeringProgress).toEqual([]);
    expect(snapshot.scanJobs).toEqual([]);
    expect(snapshot.evidenceReports).toEqual([]);
    expect(snapshot.postFindingStates).toEqual([]);
    expect(prisma.assessmentRuntimeEvent.findMany).not.toHaveBeenCalled();
    expect(prisma.repositoryScanJob.findMany).not.toHaveBeenCalled();
    expect(prisma.technicalEvidenceReport.findMany).not.toHaveBeenCalled();
    expect(snapshot.stageLifecycles).toEqual([]);
    expect(snapshot.canonicalAssessments).toEqual([
      {
        assessmentId: "11111111-1111-4111-8111-111111111111",
        lifecycle: {
          state: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
          assessmentRevision: 3,
        },
        runtime: {
          threadId: "22222222-2222-4222-8222-222222222222",
          rootAgentVersion: "assessment-root-v2",
          checkpointNamespace: "11111111-1111-4111-8111-111111111111",
          checkpointId: "44444444-4444-4444-8444-444444444444",
          currentExecutionId: "33333333-3333-4333-8333-333333333333",
          executionState: AGENT_EXECUTION_STATES.RUNNING,
          eventSequence: 4,
          startedAt: "2026-09-20T00:00:00.000Z",
          lastResumedAt: null,
          updatedAt: "2026-09-20T00:02:00.000Z",
        },
      },
    ]);
    expect(snapshot.canonicalEvents).toEqual([
      expect.objectContaining({
        eventId: "55555555-5555-4555-8555-555555555555",
        assessmentId: "11111111-1111-4111-8111-111111111111",
        sequence: 4,
        eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.ASSESSMENT_LIFECYCLE_CHANGED,
        actorType: ASSESSMENT_EVENT_ACTOR_TYPES.API,
      }),
    ]);
  });

  it("fails closed on malformed non-null canonical snapshot lifecycle data", async () => {
    const prisma = canonicalSnapshotPrisma([
      {
        assessmentId: "11111111-1111-4111-8111-111111111111",
        threadId: "22222222-2222-4222-8222-222222222222",
        rootAgentVersion: "assessment-root-v2",
        checkpointNamespace: "11111111-1111-4111-8111-111111111111",
        checkpointId: null,
        currentExecutionId: null,
        executionState: AGENT_EXECUTION_STATES.QUEUED,
        eventSequence: 0,
        startedAt: null,
        lastResumedAt: null,
        updatedAt: new Date("2026-09-20T00:00:00.000Z"),
        assessment: {
          lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
          lifecycleRevision: null,
          blockerReason: null,
          blockerReference: null,
        },
      },
    ]);
    const service = new AssessmentRuntimeEventService(prisma as never);

    await expect(
      service.buildWorkspaceSnapshot("user-1"),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("keeps all-null V1 canonical rows explicitly unavailable", async () => {
    const assessmentId = "11111111-1111-4111-8111-111111111111";
    const prisma = canonicalSnapshotPrisma([
      {
        id: assessmentId,
        lifecycleState: null,
        lifecycleRevision: null,
        blockerReason: null,
        blockerReference: null,
        runtime: null,
      },
    ]);
    const service = new AssessmentRuntimeEventService(prisma as never);

    const snapshot = await service.buildWorkspaceSnapshot("user-1");

    expect(snapshot.canonicalAssessments).toEqual([
      { assessmentId, lifecycle: null, runtime: null },
    ]);
  });

  it.each([
    [
      "lifecycle-only",
      {
        id: "11111111-1111-4111-8111-111111111111",
        lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
        lifecycleRevision: 1,
        blockerReason: null,
        blockerReference: null,
        runtime: null,
      },
    ],
    [
      "runtime-only",
      {
        id: "11111111-1111-4111-8111-111111111111",
        lifecycleState: null,
        lifecycleRevision: null,
        blockerReason: null,
        blockerReference: null,
        runtime: {
          threadId: "22222222-2222-4222-8222-222222222222",
          rootAgentVersion: "assessment-root-v2",
          checkpointNamespace: "11111111-1111-4111-8111-111111111111",
          checkpointId: null,
          currentExecutionId: null,
          executionState: AGENT_EXECUTION_STATES.QUEUED,
          eventSequence: 0,
          startedAt: null,
          lastResumedAt: null,
          updatedAt: new Date("2026-09-20T00:00:00.000Z"),
        },
      },
    ],
  ])("rejects %s canonical pairs", async (_name, row) => {
    const service = new AssessmentRuntimeEventService(
      canonicalSnapshotPrisma([row]) as never,
    );

    await expect(
      service.buildWorkspaceSnapshot("user-1"),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("rejects a valid UUID checkpoint namespace belonging to another assessment", async () => {
    const prisma = canonicalSnapshotPrisma([
      {
        id: "11111111-1111-4111-8111-111111111111",
        lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
        lifecycleRevision: 1,
        blockerReason: null,
        blockerReference: null,
        runtime: {
          threadId: "22222222-2222-4222-8222-222222222222",
          rootAgentVersion: "assessment-root-v2",
          checkpointNamespace: "99999999-9999-4999-8999-999999999999",
          checkpointId: null,
          currentExecutionId: null,
          executionState: AGENT_EXECUTION_STATES.QUEUED,
          eventSequence: 0,
          startedAt: null,
          lastResumedAt: null,
          updatedAt: new Date("2026-09-20T00:00:00.000Z"),
        },
      },
    ]);
    const service = new AssessmentRuntimeEventService(prisma as never);

    await expect(
      service.buildWorkspaceSnapshot("user-1"),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("fails closed on malformed canonical runtime identity and sequence data", async () => {
    const prisma = canonicalSnapshotPrisma([
      {
        assessmentId: "11111111-1111-4111-8111-111111111111",
        threadId: "not-a-uuid",
        rootAgentVersion: "assessment-root-v2",
        checkpointNamespace: "not-a-uuid",
        checkpointId: null,
        currentExecutionId: null,
        executionState: AGENT_EXECUTION_STATES.QUEUED,
        eventSequence: -1,
        startedAt: null,
        lastResumedAt: null,
        updatedAt: new Date("2026-09-20T00:00:00.000Z"),
        assessment: {
          lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
          lifecycleRevision: 1,
          blockerReason: null,
          blockerReference: null,
        },
      },
    ]);
    const service = new AssessmentRuntimeEventService(prisma as never);

    await expect(
      service.buildWorkspaceSnapshot("user-1"),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("propagates canonical snapshot database failures", async () => {
    const failure = new Error("canonical snapshot database unavailable");
    const prisma = canonicalSnapshotPrisma(Promise.reject(failure));
    const service = new AssessmentRuntimeEventService(prisma as never);

    await expect(service.buildWorkspaceSnapshot("user-1")).rejects.toThrow(
      "canonical snapshot database unavailable",
    );
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

  it("records repository-analysis-worker runtime events using scan-job tenant context", async () => {
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
      service.recordRepositoryAnalysisEvent({
        scanJobId: "scan-1",
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolCompleted,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.scan,
        toolName: "codebase-memory-graph",
        summary: "Codebase Memory completed with non-blocking failure",
        outputSummary: { outcome: "tool_failure" },
        errorSummary: "Codebase Memory unavailable",
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
        toolName: "codebase-memory-graph",
        outputSummaryJson: { outcome: "tool_failure" },
        errorSummary: "Codebase Memory unavailable",
        durationMs: 1000,
      }),
    });
  });

  it("retries repository-analysis-worker runtime event sequence collisions", async () => {
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
      service.recordRepositoryAnalysisEvent({
        scanJobId: "scan-1",
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolStarted,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.scan,
        toolName: "repository-analysis",
        summary: "Running repository analysis",
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

  it("skips late repository-analysis-worker start events after the scan job is terminal", async () => {
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
      service.recordRepositoryAnalysisEvent({
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

  it("records a rule-analysis start after the scan job completed", async () => {
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

    // Downstream stages run after the scan, under the same scan job; their
    // progress keeps the Investigate step live instead of being dropped.
    await expect(
      service.recordRepositoryAnalysisEvent({
        scanJobId: "scan-1",
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolStarted,
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.technicalEvidence,
        toolName: "rule_analysis:eng-1",
        summary: "RULE_ANALYSIS_STARTED",
      }),
    ).resolves.toEqual({ recorded: true });
    expect(assessmentRuntimeEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: ASSESSMENT_RUNTIME_EVENT_TYPES.toolStarted,
        stage: ASSESSMENT_RUNTIME_STAGE_CODES.technicalEvidence,
      }),
    });
  });

  it("records repository-analysis-worker terminal close events after the scan job is terminal", async () => {
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
      service.recordRepositoryAnalysisEvent({
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
});

describe("AssessmentRuntimeEventService.getPipelineLiveness", () => {
  const WINDOW_MS = 90_000;

  function serviceWithLatest(
    latest: Record<string, unknown> | null,
    turn: Record<string, unknown> | null = null,
  ) {
    const findMany = jest
      .fn<(...args: unknown[]) => Promise<unknown[]>>()
      .mockResolvedValue(latest ? [latest] : []);
    const service = new AssessmentRuntimeEventService({
      assessmentRuntimeEvent: { findMany },
      assessmentRuntimeTurn: {
        findFirst: jest
          .fn<() => Promise<typeof turn>>()
          .mockResolvedValue(turn),
      },
    } as never);
    return { service, findMany };
  }

  it("treats a recent non-terminal event such as a model heartbeat as live", async () => {
    const createdAt = new Date(Date.now() - 5_000);
    const { service, findMany } = serviceWithLatest({
      runStatus: "RUNNING",
      createdAt,
      outputSummaryJson: {
        agentStreamEvent: { eventType: "MODEL_CALL_HEARTBEAT" },
      },
    });

    await expect(
      service.getPipelineLiveness("assessment-1", WINDOW_MS),
    ).resolves.toEqual({ live: true, lastActivityAt: createdAt });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assessmentId: "assessment-1" },
        take: 1,
      }),
    );
  });

  it.each([
    ASSESSMENT_RUNTIME_CONTROL_STATES.stopped,
    ASSESSMENT_RUNTIME_CONTROL_STATES.resumeRequested,
    ASSESSMENT_RUNTIME_CONTROL_STATES.completed,
  ])("ignores old heartbeat liveness after native state %s", async (state) => {
    const { service, findMany } = serviceWithLatest(
      {
        runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
        createdAt: new Date(),
      },
      { state, updatedAt: new Date() },
    );
    await expect(
      service.getPipelineLiveness("assessment-1", WINDOW_MS),
    ).resolves.toMatchObject({ live: false });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("keeps Stop requested distinct from Stop acknowledged", async () => {
    const { service } = serviceWithLatest(null, {
      state: ASSESSMENT_RUNTIME_CONTROL_STATES.stopRequested,
      updatedAt: new Date(),
    });
    await expect(
      service.getPipelineLiveness("assessment-1", WINDOW_MS),
    ).resolves.toMatchObject({ live: true });
  });

  it("does not treat a request marker as a stop acknowledgement", async () => {
    const { service } = serviceWithLatest({
      runStatus: "WAITING",
      createdAt: new Date(),
      waitingReason: "CUSTOMER_REQUESTED_STOP",
      outputSummaryJson: null,
    });

    // Only the native runtime acknowledgement makes Continue available.
    await expect(
      service.getPipelineLiveness("assessment-1", WINDOW_MS),
    ).resolves.toEqual(expect.objectContaining({ live: true }));
  });

  it("reports the pipeline stopped only while the latest control is a stop", async () => {
    const { service, findMany } = serviceWithLatest({
      waitingReason: "CUSTOMER_REQUESTED_STOP",
    });
    await expect(
      service.isPipelineStoppedByCustomer("assessment-1"),
    ).resolves.toBe(true);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assessmentId: "assessment-1",
          toolName: "customer_pipeline_control",
        },
        take: 1,
      }),
    );
    findMany.mockResolvedValue([
      { waitingReason: "CUSTOMER_REQUESTED_CONTINUE" },
    ]);
    await expect(
      service.isPipelineStoppedByCustomer("assessment-1"),
    ).resolves.toBe(false);
  });

  it("is not live after the boundary failed, however recent", async () => {
    const { service } = serviceWithLatest({
      runStatus: "RUNNING",
      createdAt: new Date(),
      outputSummaryJson: { agentStreamEvent: { eventType: "BOUNDARY_FAILED" } },
    });

    await expect(
      service.getPipelineLiveness("assessment-1", WINDOW_MS),
    ).resolves.toMatchObject({ live: false });
  });

  it("is not live once activity is older than the window", async () => {
    const { service } = serviceWithLatest({
      runStatus: "RUNNING",
      createdAt: new Date(Date.now() - WINDOW_MS - 1_000),
      outputSummaryJson: null,
    });

    await expect(
      service.getPipelineLiveness("assessment-1", WINDOW_MS),
    ).resolves.toMatchObject({ live: false });
  });

  it("is not live when the assessment has no runtime activity", async () => {
    const { service } = serviceWithLatest(null);

    await expect(
      service.getPipelineLiveness("assessment-1", WINDOW_MS),
    ).resolves.toEqual({ live: false, lastActivityAt: null });
  });
});
