import {
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_ACTIVITY_KINDS,
  ASSESSMENT_ERROR_CODES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
} from "@lcsp/contracts/evidence";
import * as assert from "node:assert/strict";

import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  AgentExecutionState as PrismaAgentExecutionState,
  AssessmentEventActorType as PrismaAssessmentEventActorType,
  AssessmentEventType as PrismaAssessmentEventType,
  AssessmentLifecycleState as PrismaAssessmentLifecycleState,
  AuthUserRole as PrismaAuthUserRole,
  OutboxAggregateType as PrismaOutboxAggregateType,
  OutboxStatus as PrismaOutboxStatus,
  Prisma,
  PrismaClient,
} from "@prisma/client";

import { AppModule } from "../src/app.module.js";
import type { SignInSuccess } from "../src/modules/auth/application/contracts/auth/sign-in.contract.js";
import { hashSecret } from "../src/modules/auth/infrastructure/security/security.utils.js";
import { AssessmentRuntimeEventService } from "../src/platform/runtime-events/assessment-runtime-event.service.js";
import { httpRequest, problemCode, successBody } from "./support/http.js";
import { seedAuthWorkspaceFixture } from "./support/auth-workspace-test-helpers.js";

const TARGET_DATABASE_URL =
  "postgresql://postgres:postgres@127.0.0.1:55441/lcsp_canonical_read_isolation?schema=public";
const AGENT_STREAM_JOURNAL_TOOL_NAME = "agent_stream_semantic";

const OWNER_A_ID = "user-1";
const OWNER_B_ID = "9e5f0b6e-8e0a-4f3e-b2a4-7a9d6e6c2f11";
const OWNER_B_EMAIL = "canonical-read-isolation-other@invalid.test";
const OWNER_B_PASSWORD = "CANONICALReadIsolationOther!2026";

const OWNER_A_PRESENT_ASSESSMENT_ID = "7a4b5c6d-8e9f-4012-a3b4-d5e6f7a80910";
const OWNER_A_NULL_ASSESSMENT_ID = "8b5c6d7e-9f01-4123-b4c5-d6e7f8091021";
const OWNER_B_ASSESSMENT_ID = "9c6d7e8f-0123-4234-a5d6-e7f809102132";

const OWNER_A_THREAD_ID = "0d7e8f90-1234-4345-a6e7-f80910213243";
const OWNER_B_THREAD_ID = "1e8f9012-2345-4456-a7f8-091021324354";
const OWNER_A_EXECUTION_ID = "2f901234-3456-4567-a809-102132435465";
const OWNER_B_EXECUTION_ID = "3a012345-4567-4678-a910-213243546576";

const OWNER_A_ASSESSMENT_EVENT_ID = "4b123456-5678-4789-a021-324354657687";
const OWNER_B_ASSESSMENT_EVENT_ID = "5c234567-6789-4890-a132-435465768798";
const OWNER_A_OUTBOX_ID = "canonical-read-isolation-outbox-a";
const OWNER_B_OUTBOX_ID = "canonical-read-isolation-outbox-b";

const OWNER_A_RUNTIME_EVENT_ID = "6d345678-7890-4901-a243-546576879809";
const OWNER_B_RUNTIME_EVENT_ID = "7e456789-8901-4012-a354-657687980910";
const OWNER_A_RUN_ID = "8f567890-9012-4123-a465-768798091021";
const OWNER_B_RUN_ID = "90678901-0123-4234-a576-879809102132";

type SseFrame = { event: string; data: Record<string, unknown> };
type SseReadResult = { statusCode: number; frame: SseFrame | null };
type SseResponse = {
  status?: number;
  statusCode?: number;
  setEncoding(encoding: BufferEncoding): void;
  on(event: "data", listener: (chunk: string | Buffer) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
};

// Needs its own fresh, task-owned database (it refuses a non-empty target), so it is
// opt-in: the shared CI e2e database (lcsp_api_e2e) is populated by earlier specs.
const integration =
  process.env.DATABASE_URL === TARGET_DATABASE_URL ? describe : describe.skip;

integration("CANONICAL canonical read isolation (e2e preparation)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let ownerAToken: string;
  let ownerBToken: string;

  beforeAll(async () => {
    assert.equal(
      process.env.DATABASE_URL,
      TARGET_DATABASE_URL,
      "refusing read-isolation e2e outside the exact task-owned target",
    );
    process.env.DATABASE_URL = TARGET_DATABASE_URL;

    prisma = new PrismaClient({ adapter: new PrismaPg(TARGET_DATABASE_URL) });
    await prisma.$connect();
    await prepareFixture();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    ownerAToken = await signIn(
      "manager@acme.test",
      "CorrectHorseBatteryStaple!",
    );
    ownerBToken = await signIn(OWNER_B_EMAIL, OWNER_B_PASSWORD);
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
  });

  it("allows each owner to read own canonical rows and hides foreign assessments", async () => {
    const ownerPresent = await httpRequest(app)
      .get(`/assessments/${OWNER_A_PRESENT_ASSESSMENT_ID}`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    const ownerPresentBody = successBody<Record<string, unknown>>(ownerPresent);
    assert.equal(ownerPresent.status, 200);
    assert.equal(ownerPresentBody.assessment_id, OWNER_A_PRESENT_ASSESSMENT_ID);
    assert.equal(ownerPresentBody.owner_id, OWNER_A_ID);
    assert.deepEqual(ownerPresentBody.lifecycle, {
      state: PrismaAssessmentLifecycleState.PAUSED,
      assessmentRevision: 7,
    });
    assert.deepEqual(ownerPresentBody.runtime, {
      threadId: OWNER_A_THREAD_ID,
      rootAgentVersion: "canonical-read-isolation",
      checkpointNamespace: OWNER_A_PRESENT_ASSESSMENT_ID,
      checkpointId: null,
      currentExecutionId: OWNER_A_EXECUTION_ID,
      executionState: PrismaAgentExecutionState.PAUSED,
      eventSequence: 1,
      startedAt: "2026-10-06T01:00:00.000Z",
      lastResumedAt: null,
      updatedAt: (ownerPresentBody.runtime as Record<string, unknown>)
        .updatedAt,
    });

    const ownerNull = await httpRequest(app)
      .get(`/assessments/${OWNER_A_NULL_ASSESSMENT_ID}`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    const ownerNullBody = successBody<Record<string, unknown>>(ownerNull);
    assert.equal(ownerNull.status, 200);
    assert.equal(ownerNullBody.assessment_id, OWNER_A_NULL_ASSESSMENT_ID);
    assert.equal(ownerNullBody.owner_id, OWNER_A_ID);
    assert.equal(ownerNullBody.lifecycle, null);
    assert.equal(ownerNullBody.runtime, null);

    const foreignPresent = await httpRequest(app)
      .get(`/assessments/${OWNER_A_PRESENT_ASSESSMENT_ID}`)
      .set("Authorization", `Bearer ${ownerBToken}`);
    const foreignNull = await httpRequest(app)
      .get(`/assessments/${OWNER_A_NULL_ASSESSMENT_ID}`)
      .set("Authorization", `Bearer ${ownerBToken}`);
    assert.equal(foreignPresent.status, 404);
    assert.equal(foreignNull.status, 404);
    assert.equal(problemCode(foreignPresent), ASSESSMENT_ERROR_CODES.notFound);
    assert.equal(problemCode(foreignNull), ASSESSMENT_ERROR_CODES.notFound);
  });

  it("scopes canonical HTTP SSE and durable agent-stream replay by assessment owner", async () => {
    const ownerSnapshotResult = await readSseEvent(
      "/workspace/runtime-events",
      ownerAToken,
      "workspace.runtime",
    );
    assert.equal(ownerSnapshotResult.statusCode, 200);
    const ownerSnapshot = ownerSnapshotResult.frame;
    assert.ok(ownerSnapshot);
    assert.deepEqual(
      idsFromSnapshot(ownerSnapshot.data.canonical_assessments),
      [OWNER_A_NULL_ASSESSMENT_ID, OWNER_A_PRESENT_ASSESSMENT_ID].sort(),
    );
    assert.deepEqual(
      idsFromSnapshot(ownerSnapshot.data.canonical_events, "eventId"),
      [OWNER_A_ASSESSMENT_EVENT_ID],
    );

    const otherOwnerSnapshot = await readSseEvent(
      "/workspace/runtime-events",
      ownerBToken,
      "workspace.runtime",
    );
    assert.equal(otherOwnerSnapshot.statusCode, 200);
    assert.ok(otherOwnerSnapshot.frame);
    assert.deepEqual(
      idsFromSnapshot(otherOwnerSnapshot.frame.data.canonical_assessments),
      [OWNER_B_ASSESSMENT_ID],
    );
    assert.deepEqual(
      idsFromSnapshot(
        otherOwnerSnapshot.frame.data.canonical_events,
        "eventId",
      ),
      [OWNER_B_ASSESSMENT_EVENT_ID],
    );

    // The old agent_stream_only query no longer selects a separate HTTP
    // event. The canonical SSE contract must never emit foreign journal rows.
    const canonicalOnly = await readSseEvent(
      `/workspace/runtime-events?agent_stream_only=1&assessment_id=${OWNER_A_PRESENT_ASSESSMENT_ID}`,
      ownerBToken,
      "workspace.runtime",
    );
    assert.equal(canonicalOnly.statusCode, 200);
    assert.ok(canonicalOnly.frame);
    assert.deepEqual(
      idsFromSnapshot(canonicalOnly.frame.data.canonical_assessments),
      [OWNER_B_ASSESSMENT_ID],
    );
    assert.deepEqual(canonicalOnly.frame.data.agent_stream_events, []);

    // Durable agent-stream history remains an owner-scoped service capability,
    // not a public endpoint. Test it directly against real PostgreSQL.
    const runtimeEvents = app.get(AssessmentRuntimeEventService);
    const ownerHistory = await runtimeEvents.getAgentStreamHistoryPage(
      OWNER_A_ID,
      OWNER_A_PRESENT_ASSESSMENT_ID,
    );
    assert.deepEqual(
      ownerHistory.events.map((event) => event.eventId),
      [OWNER_A_RUNTIME_EVENT_ID],
    );
    assert.equal(
      ownerHistory.events[0]?.assessmentId,
      OWNER_A_PRESENT_ASSESSMENT_ID,
    );

    const foreignHistory = await runtimeEvents.getAgentStreamHistoryPage(
      OWNER_B_ID,
      OWNER_A_PRESENT_ASSESSMENT_ID,
    );
    assert.deepEqual(foreignHistory.events, []);
    const otherOwnerHistory = await runtimeEvents.getAgentStreamHistoryPage(
      OWNER_B_ID,
      OWNER_B_ASSESSMENT_ID,
    );
    assert.deepEqual(
      otherOwnerHistory.events.map((event) => event.eventId),
      [OWNER_B_RUNTIME_EVENT_ID],
    );

    // Do not reintroduce the retired public agent-stream history endpoint.
    const retiredHistory = await httpRequest(app)
      .get("/workspace/runtime-events/agent-stream-history")
      .query({ assessment_id: OWNER_A_PRESENT_ASSESSMENT_ID })
      .set("Authorization", `Bearer ${ownerAToken}`);
    assert.equal(retiredHistory.status, 404);
  });

  it("keeps unauthorized reads pure", async () => {
    const before = await readAuthorityRows();

    const assessment = await httpRequest(app)
      .get(`/assessments/${OWNER_A_PRESENT_ASSESSMENT_ID}`)
      .set("Authorization", `Bearer ${ownerBToken}`);
    assert.equal(assessment.status, 404);

    const history = await httpRequest(app)
      .get("/workspace/runtime-events/agent-stream-history")
      .query({ assessment_id: OWNER_A_PRESENT_ASSESSMENT_ID })
      .set("Authorization", `Bearer ${ownerBToken}`);
    assert.equal(history.status, 404);

    const snapshot = await readSseEvent(
      "/workspace/runtime-events",
      ownerBToken,
      "workspace.runtime",
    );
    assert.equal(snapshot.statusCode, 200);
    assert.ok(snapshot.frame);
    assert.deepEqual(
      idsFromSnapshot(snapshot.frame.data.canonical_assessments),
      [OWNER_B_ASSESSMENT_ID],
    );
    assert.deepEqual(snapshot.frame.data.agent_stream_events, []);

    const foreignReplay = await app
      .get(AssessmentRuntimeEventService)
      .getAgentStreamHistoryPage(OWNER_B_ID, OWNER_A_PRESENT_ASSESSMENT_ID);
    assert.deepEqual(foreignReplay.events, []);

    const after = await readAuthorityRows();
    assert.deepEqual(after, before);
  });

  async function signIn(email: string, password: string): Promise<string> {
    const result = await httpRequest(app)
      .post("/auth/sign-in")
      .send({ email, password });
    const body = successBody<SignInSuccess>(result);
    assert.equal(result.status, 200);
    assert.ok(body.session_token);
    return body.session_token;
  }

  async function assertFreshTarget(): Promise<void> {
    const [
      users,
      assessments,
      runtimes,
      assessmentEvents,
      runtimeEvents,
      outbox,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.assessment.count(),
      prisma.assessmentRuntime.count(),
      prisma.assessmentEvent.count(),
      prisma.assessmentRuntimeEvent.count(),
      prisma.outboxMessage.count(),
    ]);
    assert.deepEqual(
      { users, assessments, runtimes, assessmentEvents, runtimeEvents, outbox },
      {
        users: 0,
        assessments: 0,
        runtimes: 0,
        assessmentEvents: 0,
        runtimeEvents: 0,
        outbox: 0,
      },
      "refusing to seed a non-empty target",
    );
  }

  async function prepareFixture(): Promise<void> {
    const ownedAssessments = await prisma.assessment.findMany({
      where: { ownerId: { in: [OWNER_A_ID, OWNER_B_ID] } },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    if (ownedAssessments.length === 0) {
      await assertFreshTarget();
      await seedFixture();
      return;
    }
    assert.deepEqual(
      ownedAssessments.map(({ id }) => id),
      [
        OWNER_A_NULL_ASSESSMENT_ID,
        OWNER_A_PRESENT_ASSESSMENT_ID,
        OWNER_B_ASSESSMENT_ID,
      ].sort(),
      "refusing to reuse an unexpected non-empty target",
    );
  }

  async function seedFixture(): Promise<void> {
    await seedAuthWorkspaceFixture(prisma);
    await prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          id: OWNER_B_ID,
          email: OWNER_B_EMAIL,
          passwordHash: hashSecret(OWNER_B_PASSWORD),
          emailVerified: true,
          failedLoginCount: 0,
          role: PrismaAuthUserRole.CUSTOMER,
        },
      });

      await tx.assessment.createMany({
        data: [
          {
            id: OWNER_A_PRESENT_ASSESSMENT_ID,
            ownerId: OWNER_A_ID,
            name: "CANONICAL read isolation canonical present",
            lifecycleState: PrismaAssessmentLifecycleState.PAUSED,
            lifecycleRevision: 7,
            blockerReason: null,
            blockerReference: Prisma.DbNull,
          },
          {
            id: OWNER_A_NULL_ASSESSMENT_ID,
            ownerId: OWNER_A_ID,
            name: "CANONICAL read isolation canonical unavailable",
            lifecycleState: null,
            lifecycleRevision: null,
            blockerReason: null,
            blockerReference: Prisma.DbNull,
          },
          {
            id: OWNER_B_ASSESSMENT_ID,
            ownerId: OWNER_B_ID,
            name: "CANONICAL read isolation foreign owner",
            lifecycleState: PrismaAssessmentLifecycleState.ACTIVE,
            lifecycleRevision: 2,
            blockerReason: null,
            blockerReference: Prisma.DbNull,
          },
        ],
      });

      await tx.assessmentRuntime.createMany({
        data: [
          {
            assessmentId: OWNER_A_PRESENT_ASSESSMENT_ID,
            threadId: OWNER_A_THREAD_ID,
            rootAgentVersion: "canonical-read-isolation",
            checkpointNamespace: OWNER_A_PRESENT_ASSESSMENT_ID,
            checkpointId: null,
            currentExecutionId: OWNER_A_EXECUTION_ID,
            executionState: PrismaAgentExecutionState.PAUSED,
            eventSequence: 1,
            startedAt: new Date("2026-10-06T01:00:00.000Z"),
            lastResumedAt: null,
          },
          {
            assessmentId: OWNER_B_ASSESSMENT_ID,
            threadId: OWNER_B_THREAD_ID,
            rootAgentVersion: "canonical-read-isolation",
            checkpointNamespace: OWNER_B_ASSESSMENT_ID,
            checkpointId: null,
            currentExecutionId: OWNER_B_EXECUTION_ID,
            executionState: PrismaAgentExecutionState.PAUSED,
            eventSequence: 1,
            startedAt: new Date("2026-10-06T01:01:00.000Z"),
            lastResumedAt: null,
          },
        ],
      });

      await seedCanonicalEvent(tx, {
        assessmentId: OWNER_A_PRESENT_ASSESSMENT_ID,
        threadId: OWNER_A_THREAD_ID,
        eventId: OWNER_A_ASSESSMENT_EVENT_ID,
        outboxMessageId: OWNER_A_OUTBOX_ID,
        timestamp: new Date("2026-10-06T01:00:00.000Z"),
      });
      await seedCanonicalEvent(tx, {
        assessmentId: OWNER_B_ASSESSMENT_ID,
        threadId: OWNER_B_THREAD_ID,
        eventId: OWNER_B_ASSESSMENT_EVENT_ID,
        outboxMessageId: OWNER_B_OUTBOX_ID,
        timestamp: new Date("2026-10-06T01:01:00.000Z"),
      });

      await tx.assessmentRuntimeEvent.createMany({
        data: [
          runtimeEventRow({
            assessmentId: OWNER_A_PRESENT_ASSESSMENT_ID,
            runId: OWNER_A_RUN_ID,
            eventId: OWNER_A_RUNTIME_EVENT_ID,
            correlationId: "canonical-read-isolation-a",
            scope: "owner-a",
            timestamp: "2026-10-06T01:00:00.000Z",
          }),
          runtimeEventRow({
            assessmentId: OWNER_B_ASSESSMENT_ID,
            runId: OWNER_B_RUN_ID,
            eventId: OWNER_B_RUNTIME_EVENT_ID,
            correlationId: "canonical-read-isolation-b",
            scope: "owner-b",
            timestamp: "2026-10-06T01:01:00.000Z",
          }),
        ],
      });
    });
  }

  async function seedCanonicalEvent(
    tx: Prisma.TransactionClient,
    values: {
      assessmentId: string;
      threadId: string;
      eventId: string;
      outboxMessageId: string;
      timestamp: Date;
    },
  ): Promise<void> {
    await tx.outboxMessage.create({
      data: {
        id: values.outboxMessageId,
        aggregateType: PrismaOutboxAggregateType.ASSESSMENT,
        aggregateId: values.assessmentId,
        eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.ACTIVITY_RECORDED,
        payload: { event_id: values.eventId },
        status: PrismaOutboxStatus.PENDING,
        attempts: 0,
      },
    });
    await tx.assessmentEvent.create({
      data: {
        eventId: values.eventId,
        assessmentId: values.assessmentId,
        threadId: values.threadId,
        sequence: 1,
        timestamp: values.timestamp,
        eventType: PrismaAssessmentEventType.ACTIVITY_RECORDED,
        actorType: PrismaAssessmentEventActorType.API,
        payload: {
          kind: ASSESSMENT_ACTIVITY_KINDS.DOMAIN,
          labelKey: "canonical.readIsolation",
        },
        outboxMessageId: values.outboxMessageId,
      },
    });
  }

  function runtimeEventRow(values: {
    assessmentId: string;
    runId: string;
    eventId: string;
    correlationId: string;
    scope: string;
    timestamp: string;
  }) {
    return {
      id: values.eventId,
      assessmentId: values.assessmentId,
      boundaryType: "ASSESSMENT" as const,
      boundaryId: values.assessmentId,
      runId: values.runId,
      correlationId: values.correlationId,
      sequence: 1,
      toolName: AGENT_STREAM_JOURNAL_TOOL_NAME,
      summary: "synthetic owner-scoped stream fixture",
      outputSummaryJson: {
        agentStreamEvent: {
          eventId: values.eventId,
          sequence: 1,
          emittedAt: values.timestamp,
          assessmentId: values.assessmentId,
          runId: values.runId,
          correlationId: values.correlationId,
          eventType: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.customProgress,
          source: "canonical-canonical-read-isolation",
          agentName: "synthetic-owner",
          namespace: ["canonical-read-isolation"],
          status: ASSESSMENT_RUNTIME_RUN_STATUSES.completed,
          text: "owner-scoped synthetic event",
          data: { scope: values.scope },
        },
      },
      createdAt: new Date(values.timestamp),
      completedAt: new Date(values.timestamp),
    };
  }

  async function readAuthorityRows() {
    const assessmentIds = [
      OWNER_A_PRESENT_ASSESSMENT_ID,
      OWNER_A_NULL_ASSESSMENT_ID,
      OWNER_B_ASSESSMENT_ID,
    ];
    const [assessments, runtimes, assessmentEvents, runtimeEvents] =
      await Promise.all([
        prisma.assessment.findMany({
          where: { id: { in: assessmentIds } },
          orderBy: { id: "asc" },
          select: {
            id: true,
            ownerId: true,
            lifecycleState: true,
            lifecycleRevision: true,
            blockerReason: true,
            blockerReference: true,
          },
        }),
        prisma.assessmentRuntime.findMany({
          where: { assessmentId: { in: assessmentIds } },
          orderBy: { assessmentId: "asc" },
          select: {
            assessmentId: true,
            threadId: true,
            checkpointNamespace: true,
            checkpointId: true,
            currentExecutionId: true,
            executionState: true,
            eventSequence: true,
          },
        }),
        prisma.assessmentEvent.findMany({
          where: { assessmentId: { in: assessmentIds } },
          orderBy: { eventId: "asc" },
          select: {
            eventId: true,
            assessmentId: true,
            threadId: true,
            sequence: true,
            eventType: true,
            actorType: true,
            outboxMessageId: true,
          },
        }),
        prisma.assessmentRuntimeEvent.findMany({
          where: { assessmentId: { in: assessmentIds } },
          orderBy: { id: "asc" },
          select: {
            id: true,
            assessmentId: true,
            runId: true,
            sequence: true,
            toolName: true,
          },
        }),
      ]);
    return { assessments, runtimes, assessmentEvents, runtimeEvents };
  }

  async function readSseEvent(
    path: string,
    token: string,
    expectedEvent: string,
    timeoutMs = 3_000,
  ): Promise<SseReadResult> {
    const request = httpRequest(app)
      .get(path)
      .buffer(false)
      .set("Authorization", `Bearer ${token}`);
    return new Promise((resolve, reject) => {
      let settled = false;
      let buffer = "";
      let statusCode: number | undefined;
      const finish = (value: SseReadResult | undefined, error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          reject(error);
          return;
        }
        if (!value) {
          reject(new Error(`SSE ${path} finished without a result`));
          return;
        }
        resolve(value);
      };
      const timer = setTimeout(() => {
        if (statusCode !== 200) {
          finish(
            undefined,
            new Error(
              `SSE ${path} did not establish a successful HTTP stream (status ${statusCode ?? "unknown"})`,
            ),
          );
          request.abort();
          return;
        }
        finish({ statusCode, frame: null });
        request.abort();
      }, timeoutMs);
      request.on("response", (response: unknown) => {
        const stream = response as SseResponse;
        statusCode = stream.statusCode ?? stream.status;
        if (
          typeof statusCode !== "number" ||
          statusCode < 200 ||
          statusCode >= 300
        ) {
          finish(
            undefined,
            new Error(
              `SSE ${path} returned HTTP ${statusCode ?? "unknown"} instead of a successful stream`,
            ),
          );
          request.abort();
          return;
        }
        const responseStatusCode = statusCode;
        stream.setEncoding("utf8");
        stream.on("data", (chunk: string | Buffer) => {
          buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
          const frames = buffer.split(/\r?\n\r?\n/);
          buffer = frames.pop() ?? "";
          for (const raw of frames) {
            const frame = parseSseFrame(raw);
            if (
              frame &&
              (frame.event === expectedEvent || frame.event === "error")
            ) {
              finish({ statusCode: responseStatusCode, frame });
              request.abort();
              return;
            }
          }
        });
        stream.on("error", (error: Error) => finish(undefined, error));
      });
      request.end((error: Error | null) => {
        if (error && !settled) finish(undefined, error);
      });
    });
  }

  function parseSseFrame(raw: string): SseFrame | null {
    const event = raw
      .split(/\r?\n/)
      .find((line) => line.startsWith("event:"))
      ?.slice("event:".length)
      .trim();
    const data = raw
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim())
      .join("\n");
    if (!event || !data) return null;
    try {
      const parsed: unknown = JSON.parse(data);
      return parsed && typeof parsed === "object"
        ? { event, data: parsed as Record<string, unknown> }
        : null;
    } catch {
      return null;
    }
  }

  function idsFromSnapshot(
    value: unknown,
    key: "assessmentId" | "eventId" = "assessmentId",
  ): string[] {
    assert.ok(Array.isArray(value));
    const entries = value as unknown[];
    return entries
      .map((entry) => {
        assert.ok(entry && typeof entry === "object");
        const record = entry as Record<string, unknown>;
        const id = record[key];
        assert.equal(typeof id, "string");
        return id as string;
      })
      .sort();
  }
});
