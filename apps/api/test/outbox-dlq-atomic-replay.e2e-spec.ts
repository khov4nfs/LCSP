import { randomUUID } from "node:crypto";
import {
  AssessmentLifecycleState,
  AgentExecutionState,
  OutboxStatus,
} from "@prisma/client";
import {
  OUTBOX_AGGREGATE_TYPES,
  OUTBOX_AUDIT_EVENT_TYPES,
  OUTBOX_ERROR_CODES,
  OUTBOX_STATUSES,
} from "@lcsp/contracts/outbox";
import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  ASSESSMENT_ROOT_COMMAND_TYPES,
  ROOT_CAPACITY_REASONS,
  ROOT_CAPACITY_ID,
} from "@lcsp/contracts/assessment-domain";
import { AGENT_EXECUTION_STATES } from "@lcsp/contracts/assessment";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import { OutboxRepository } from "../src/platform/outbox/outbox.repository.js";
import { OutboxDlqService } from "../src/platform/outbox/outbox-dlq.service.js";
import { AuditWriterService } from "../src/platform/audit/audit-writer.service.js";

function assertDisposableDatabase(databaseUrl: string | undefined): void {
  if (!databaseUrl) {
    throw new Error(
      "Dedicated local disposable test database required: DATABASE_URL must be defined",
    );
  }
  const parsed = new URL(databaseUrl);
  const isLocal = ["127.0.0.1", "localhost"].includes(parsed.hostname);
  const dbName = parsed.pathname.replace(/^\//u, "");
  const isDisposable =
    ["lcsp_api_test", "lcsp_api_e2e", "lcsp364_capacity"].includes(dbName) ||
    dbName.endsWith("_test") ||
    dbName.endsWith("_e2e");
  if (!isLocal || !isDisposable) {
    throw new Error(
      "Refusing execution on non-disposable database. Dedicated local disposable test database required (localhost/127.0.0.1 and name matching lcsp_api_test, lcsp_api_e2e, lcsp364_capacity, *_test, or *_e2e).",
    );
  }
}

describe("LCSP-364 Operator DLQ Atomic Replay & Recovery Invariants (Real PostgreSQL)", () => {
  let prisma1: PrismaService;
  let prisma2: PrismaService;
  let repo1: OutboxRepository;
  let repo2: OutboxRepository;
  let auditWriter1: AuditWriterService;
  let auditWriter2: AuditWriterService;
  let dlqService1: OutboxDlqService;
  let dlqService2: OutboxDlqService;
  let defaultOwnerId: string;

  const trackedAssessmentIds = new Set<string>();
  const trackedCommandIds = new Set<string>();
  const trackedUserIds = new Set<string>();
  const trackedScanJobIds = new Set<string>();
  const trackedSnapshotIds = new Set<string>();
  const trackedConnectionIds = new Set<string>();

  async function cleanTrackedFixtures(includeUser = false) {
    if (trackedCommandIds.size > 0) {
      const commandIds = Array.from(trackedCommandIds);
      await prisma1.auditEvent.deleteMany({
        where: { resourceId: { in: commandIds } },
      });
      await prisma1.assessmentRootExecutionSlot.deleteMany({
        where: { commandId: { in: commandIds } },
      });
      await prisma1.assessmentRootAdmissionRequest.deleteMany({
        where: { commandId: { in: commandIds } },
      });
      await prisma1.outboxMessage.deleteMany({
        where: { id: { in: commandIds } },
      });
    }
    if (trackedScanJobIds.size > 0) {
      await prisma1.repositoryScanJob.deleteMany({
        where: { id: { in: Array.from(trackedScanJobIds) } },
      });
    }
    if (trackedSnapshotIds.size > 0) {
      await prisma1.repositorySnapshot.deleteMany({
        where: { id: { in: Array.from(trackedSnapshotIds) } },
      });
    }
    if (trackedConnectionIds.size > 0) {
      await prisma1.repositoryConnection.deleteMany({
        where: { id: { in: Array.from(trackedConnectionIds) } },
      });
    }
    if (trackedAssessmentIds.size > 0) {
      const assessmentIds = Array.from(trackedAssessmentIds);
      await prisma1.assessmentRuntimeTurn.deleteMany({
        where: { assessmentId: { in: assessmentIds } },
      });
      await prisma1.assessmentRuntime.deleteMany({
        where: { assessmentId: { in: assessmentIds } },
      });
      await prisma1.assessment.deleteMany({
        where: { id: { in: assessmentIds } },
      });
    }
    if (includeUser && trackedUserIds.size > 0) {
      await prisma1.user.deleteMany({
        where: { id: { in: Array.from(trackedUserIds) } },
      });
    }
  }

  beforeAll(async () => {
    assertDisposableDatabase(process.env.DATABASE_URL);
    prisma1 = new PrismaService();
    prisma2 = new PrismaService();

    repo1 = new OutboxRepository(prisma1);
    repo2 = new OutboxRepository(prisma2);
    auditWriter1 = new AuditWriterService(prisma1);
    auditWriter2 = new AuditWriterService(prisma2);
    dlqService1 = new OutboxDlqService(repo1, auditWriter1, prisma1);
    dlqService2 = new OutboxDlqService(repo2, auditWriter2, prisma2);

    // Initialize AssessmentRootCapacity singleton
    await prisma1.$executeRaw`
      INSERT INTO "AssessmentRootCapacity" ("id", "desired", "effective", "policy", "reason", "updatedAt")
      VALUES (${ROOT_CAPACITY_ID}, 1, 0, '{}'::jsonb, 'INITIAL', clock_timestamp())
      ON CONFLICT ("id") DO NOTHING
    `;

    defaultOwnerId = `owner-${randomUUID()}`;
    trackedUserIds.add(defaultOwnerId);
    await prisma1.user.create({
      data: {
        id: defaultOwnerId,
        email: `${defaultOwnerId}@fixture.invalid`,
        passwordHash: "unused-fixture-hash",
        emailVerified: true,
        failedLoginCount: 0,
        role: "CUSTOMER",
      },
    });
  });

  afterAll(async () => {
    try {
      await cleanTrackedFixtures(true);
    } catch {
      // Ignored if cleanup fails during error teardown
    }
    await prisma1?.$disconnect().catch(() => {});
    await prisma2?.$disconnect().catch(() => {});
  });

  beforeEach(async () => {
    await cleanTrackedFixtures(false);
  });

  async function createQuarantinedRootFixture(
    overrides: {
      assessmentId?: string;
      commandId?: string;
      lifecycleState?: AssessmentLifecycleState;
      executionState?: AgentExecutionState;
      leaseToken?: string | null;
      errorMessage?: string;
      outboxStatus?: OutboxStatus;
      heldSlot?: boolean;
      enrollIsolation?: boolean;
    } = {},
  ) {
    const assessmentId = overrides.assessmentId ?? randomUUID();
    const commandId = overrides.commandId ?? `cmd-${assessmentId}`;
    const threadId = randomUUID();
    const checkpointId = `cp-${randomUUID()}`;

    trackedAssessmentIds.add(assessmentId);
    trackedCommandIds.add(commandId);

    await prisma1.assessment.create({
      data: {
        id: assessmentId,
        ownerId: defaultOwnerId,
        name: "Test Quarantined Assessment",
        lifecycleState:
          overrides.lifecycleState ?? AssessmentLifecycleState.ACTIVE,
        lifecycleRevision: 1,
        runtime: {
          create: {
            threadId,
            rootAgentVersion: "lcsp-assessment-root.v1",
            checkpointNamespace: assessmentId,
            checkpointId,
            executionState:
              overrides.executionState ?? AgentExecutionState.FAILED,
            leaseToken: overrides.leaseToken ?? null,
          },
        },
      },
    });

    const outboxStatus = overrides.outboxStatus ?? OutboxStatus.DLQ;
    const errorMessage = overrides.errorMessage ?? ROOT_CAPACITY_REASONS.fenced;

    await prisma1.outboxMessage.create({
      data: {
        id: commandId,
        aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
        aggregateId: assessmentId,
        eventType: ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
        payload: {
          assessmentId,
          idempotencyKey: `key-${commandId}`,
        },
        status: outboxStatus,
        attempts: 3,
        errorMessage,
        createdAt: new Date(Date.now() - 60_000),
      },
    });

    await prisma1.assessmentRootAdmissionRequest.create({
      data: {
        commandId,
        assessmentId,
        requestedAt: new Date(Date.now() - 60_000),
        admittedRunId: randomUUID(),
        completedAt: new Date(Date.now() - 30_000),
      },
    });

    if (overrides.heldSlot) {
      await prisma1.assessmentRootExecutionSlot.create({
        data: {
          runId: randomUUID(),
          assessmentId,
          commandId,
          incarnationId: randomUUID(),
          requestedAt: new Date(Date.now() - 30_000),
          admittedAt: new Date(Date.now() - 30_000),
          releasedAt: null,
        },
      });
    }

    return { assessmentId, commandId, threadId, checkpointId };
  }

  // Test 1 — Atomic successful replay
  it("Test 1: atomically replays a crash-quarantined Root, resets admission, and records exactly one positive audit", async () => {
    const fixture = await createQuarantinedRootFixture();
    const actorId = "operator-test-1";
    const correlationId = "corr-test-1";

    await dlqService1.replayMessage(fixture.commandId, actorId, correlationId);

    // Verify outbox state
    const message = await prisma1.outboxMessage.findUniqueOrThrow({
      where: { id: fixture.commandId },
    });
    expect([OUTBOX_STATUSES.pending, OUTBOX_STATUSES.ownedPending]).toContain(
      message.status,
    );
    expect(message.attempts).toBe(0);
    expect(message.errorMessage).toBeNull();
    expect(message.nextAttemptAt).toBeNull();

    // Verify admission request reset
    const admission =
      await prisma1.assessmentRootAdmissionRequest.findUniqueOrThrow({
        where: { commandId: fixture.commandId },
      });
    expect(admission.completedAt).toBeNull();
    expect(admission.admittedRunId).toBeNull();
    expect(admission.deliveredAt).toBeNull();
    expect(admission.requestedAt.getTime()).toBeGreaterThan(Date.now() - 5_000);

    // Verify positive replay audit
    const audits = await prisma1.auditEvent.findMany({
      where: { resourceId: fixture.commandId },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].eventType).toBe(OUTBOX_AUDIT_EVENT_TYPES.dlqReplayed);
    expect(audits[0].actorId).toBe(actorId);
    expect(audits[0].decision).toBe(AUDIT_DECISIONS.allow);
    expect(audits[0].correlationId).toBe(correlationId);

    // Verify canonical Root runtime identity preserved
    const runtime = await prisma1.assessmentRuntime.findUniqueOrThrow({
      where: { assessmentId: fixture.assessmentId },
    });
    expect(runtime.threadId).toBe(fixture.threadId);
    expect(runtime.checkpointId).toBe(fixture.checkpointId);
  });

  // Test 2 — Concurrent ADMIN replay
  it("Test 2: rejects competing ADMIN replay; exactly one transition and one audit committed", async () => {
    const fixture = await createQuarantinedRootFixture();

    const [res1, res2] = await Promise.allSettled([
      dlqService1.replayMessage(
        fixture.commandId,
        "admin-1",
        "corr-concurrent-1",
      ),
      dlqService2.replayMessage(
        fixture.commandId,
        "admin-2",
        "corr-concurrent-2",
      ),
    ]);

    // Exactly one must succeed and one must fail with 404 (message is no longer in DLQ)
    const successCount = [res1, res2].filter(
      (r) => r.status === "fulfilled",
    ).length;
    const failureCount = [res1, res2].filter(
      (r) => r.status === "rejected",
    ).length;

    expect(successCount).toBe(1);
    expect(failureCount).toBe(1);

    const rejected = res1.status === "rejected" ? res1 : res2;
    expect(rejected.status).toBe("rejected");
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({
      status: 404,
    });

    // Verify only ONE replay audit exists
    const audits = await prisma1.auditEvent.findMany({
      where: {
        resourceId: fixture.commandId,
        eventType: OUTBOX_AUDIT_EVENT_TYPES.dlqReplayed,
      },
    });
    expect(audits).toHaveLength(1);
  });

  // Test 3 — Audit failure rollback
  it("Test 3: rolls back entire transaction if AuditEvent persistence fails", async () => {
    const fixture = await createQuarantinedRootFixture();
    const beforeAdmission =
      await prisma1.assessmentRootAdmissionRequest.findUniqueOrThrow({
        where: { commandId: fixture.commandId },
      });

    // Create a mock audit writer that fails inside writeInTx
    const failingAuditWriter = {
      write: (e: Parameters<AuditWriterService["write"]>[0]) =>
        auditWriter1.write(e),
      writeInTx: async () => {
        await Promise.resolve();
        throw new Error("INJECTED_AUDIT_PERSISTENCE_FAILURE");
      },
    } as unknown as AuditWriterService;
    const failingDlqService = new OutboxDlqService(
      repo1,
      failingAuditWriter,
      prisma1,
    );

    await expect(
      failingDlqService.replayMessage(
        fixture.commandId,
        "admin-fault",
        "corr-fault-3",
      ),
    ).rejects.toThrow("INJECTED_AUDIT_PERSISTENCE_FAILURE");

    // Message must still be DLQ
    const msg = await prisma1.outboxMessage.findUniqueOrThrow({
      where: { id: fixture.commandId },
    });
    expect(msg.status).toBe(OUTBOX_STATUSES.dlq);
    expect(msg.attempts).toBe(3);
    expect(msg.errorMessage).toBe(ROOT_CAPACITY_REASONS.fenced);

    // Admission request must NOT be reset
    const afterAdmission =
      await prisma1.assessmentRootAdmissionRequest.findUniqueOrThrow({
        where: { commandId: fixture.commandId },
      });
    expect(afterAdmission.completedAt).toEqual(beforeAdmission.completedAt);
    expect(afterAdmission.admittedRunId).toBe(beforeAdmission.admittedRunId);
    expect(afterAdmission.requestedAt).toEqual(beforeAdmission.requestedAt);

    // No positive audit committed
    const audits = await prisma1.auditEvent.findMany({
      where: { resourceId: fixture.commandId },
    });
    expect(audits).toHaveLength(0);

    // Successfully retry after removing the fault
    await dlqService1.replayMessage(
      fixture.commandId,
      "admin-recovered",
      "corr-recovered-3",
    );
    const recoveredMsg = await prisma1.outboxMessage.findUniqueOrThrow({
      where: { id: fixture.commandId },
    });
    expect([OUTBOX_STATUSES.pending, OUTBOX_STATUSES.ownedPending]).toContain(
      recoveredMsg.status,
    );
  });

  // Test 4 — Replay versus physical admission race
  it("Test 4: refuses replay and records denial audit if a physical slot is held", async () => {
    const fixture = await createQuarantinedRootFixture({ heldSlot: true });

    await expect(
      dlqService1.replayMessage(fixture.commandId, "admin-1", "corr-test-4"),
    ).rejects.toMatchObject({
      response: {
        problem: { code: OUTBOX_ERROR_CODES.dlqReplayUnsafeTarget },
      },
    });

    // Message must remain DLQ
    const msg = await prisma1.outboxMessage.findUniqueOrThrow({
      where: { id: fixture.commandId },
    });
    expect(msg.status).toBe(OUTBOX_STATUSES.dlq);

    // Denial audit must be recorded
    const audits = await prisma1.auditEvent.findMany({
      where: { resourceId: fixture.commandId },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].eventType).toBe(OUTBOX_AUDIT_EVENT_TYPES.dlqReplayDenied);
    expect(audits[0].decision).toBe(AUDIT_DECISIONS.deny);
    expect(audits[0].reasonCode).toBe(OUTBOX_ERROR_CODES.dlqReplayUnsafeTarget);
  });

  // Test 5 — Replay versus discard race
  it("Test 5: serializes competing replay and discard; exactly one commits and state is unambiguous", async () => {
    const fixture = await createQuarantinedRootFixture();

    const [replayRes, discardRes] = await Promise.allSettled([
      dlqService1.replayMessage(
        fixture.commandId,
        "admin-replay",
        "corr-race-5-replay",
      ),
      dlqService2.deleteMessage(
        fixture.commandId,
        "admin-discard",
        "corr-race-5-discard",
      ),
    ]);

    const successCount = [replayRes, discardRes].filter(
      (r) => r.status === "fulfilled",
    ).length;
    const failureCount = [replayRes, discardRes].filter(
      (r) => r.status === "rejected",
    ).length;

    expect(successCount).toBe(1);
    expect(failureCount).toBe(1);

    const msg = await prisma1.outboxMessage.findUnique({
      where: { id: fixture.commandId },
    });

    if (replayRes.status === "fulfilled") {
      // Replay won: status is PENDING/OWNED_PENDING
      expect([OUTBOX_STATUSES.pending, OUTBOX_STATUSES.ownedPending]).toContain(
        msg?.status,
      );
      const audits = await prisma1.auditEvent.findMany({
        where: { resourceId: fixture.commandId },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0].eventType).toBe(OUTBOX_AUDIT_EVENT_TYPES.dlqReplayed);
    } else {
      // Discard won: Root command has admission history, so it becomes CANCELLED tombstone
      expect(msg?.status).toBe(OUTBOX_STATUSES.cancelled);
      const audits = await prisma1.auditEvent.findMany({
        where: { resourceId: fixture.commandId },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0].eventType).toBe(OUTBOX_AUDIT_EVENT_TYPES.dlqDiscarded);
    }
  });

  // Test 6 — Discarded command cannot be resurrected by subsequent replay
  it("Test 6: an already-discarded command cannot be replayed or resurrected", async () => {
    const fixture = await createQuarantinedRootFixture();

    await dlqService1.deleteMessage(
      fixture.commandId,
      "admin-discard",
      "corr-discard-6",
    );

    const discardedMsg = await prisma1.outboxMessage.findUniqueOrThrow({
      where: { id: fixture.commandId },
    });
    expect(discardedMsg.status).toBe(OUTBOX_STATUSES.cancelled);

    // Attempting to replay discarded message must fail with 404
    await expect(
      dlqService1.replayMessage(
        fixture.commandId,
        "admin-replay",
        "corr-replay-6",
      ),
    ).rejects.toMatchObject({
      status: 404,
    });

    // Status remains CANCELLED tombstone
    const finalMsg = await prisma1.outboxMessage.findUniqueOrThrow({
      where: { id: fixture.commandId },
    });
    expect(finalMsg.status).toBe(OUTBOX_STATUSES.cancelled);
  });

  // Test 7 — Replay rejects non-quarantined or active runtime states
  it("Test 7: refuses replay if executionState is RUNNING or leaseToken is present", async () => {
    // RUNNING executionState
    const runningFixture = await createQuarantinedRootFixture({
      executionState: AGENT_EXECUTION_STATES.RUNNING,
    });
    await expect(
      dlqService1.replayMessage(runningFixture.commandId, "admin-1", "corr-7a"),
    ).rejects.toMatchObject({
      response: {
        problem: { code: OUTBOX_ERROR_CODES.dlqReplayUnsafeTarget },
      },
    });

    // Active leaseToken
    const leasedFixture = await createQuarantinedRootFixture({
      leaseToken: randomUUID(),
    });
    await expect(
      dlqService1.replayMessage(leasedFixture.commandId, "admin-1", "corr-7b"),
    ).rejects.toMatchObject({
      response: {
        problem: { code: OUTBOX_ERROR_CODES.dlqReplayUnsafeTarget },
      },
    });

    // Non-fenced errorMessage
    const unfencedFixture = await createQuarantinedRootFixture({
      errorMessage: "TIMEOUT_UNKNOWN",
    });
    await expect(
      dlqService1.replayMessage(
        unfencedFixture.commandId,
        "admin-1",
        "corr-7c",
      ),
    ).rejects.toMatchObject({
      response: {
        problem: { code: OUTBOX_ERROR_CODES.dlqReplayUnsafeTarget },
      },
    });
  });

  // Test 8 — Non-Root regression (ordinary messages and repository scan jobs)
  it("Test 8: non-Root events replay/discard cleanly without requiring Root admission bookkeeping", async () => {
    // 8A: Ordinary non-Root event
    const ordinaryId = `ordinary-${randomUUID()}`;
    trackedCommandIds.add(ordinaryId);
    await prisma1.outboxMessage.create({
      data: {
        id: ordinaryId,
        aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
        aggregateId: randomUUID(),
        eventType: "event.assessment.created.v1",
        payload: { test: true },
        status: OUTBOX_STATUSES.dlq,
        attempts: 3,
        createdAt: new Date(),
      },
    });

    await dlqService1.replayMessage(ordinaryId, "admin-1", "corr-8a");
    const replayed = await prisma1.outboxMessage.findUniqueOrThrow({
      where: { id: ordinaryId },
    });
    expect([OUTBOX_STATUSES.pending, OUTBOX_STATUSES.ownedPending]).toContain(
      replayed.status,
    );

    // Discard ordinary message -> physically deleted because no admission intent
    await prisma1.outboxMessage.update({
      where: { id: ordinaryId },
      data: { status: OUTBOX_STATUSES.dlq },
    });
    await dlqService1.deleteMessage(ordinaryId, "admin-1", "corr-8b");
    const deleted = await prisma1.outboxMessage.findUnique({
      where: { id: ordinaryId },
    });
    expect(deleted).toBeNull();

    // 8B: Terminal repository scan job -> replay denied
    const scanAssessment = await createQuarantinedRootFixture();
    const connId = `conn-${randomUUID()}`;
    trackedConnectionIds.add(connId);
    await prisma1.repositoryConnection.create({
      data: {
        id: connId,
        userId: defaultOwnerId,
        repositoryId: `repo-${randomUUID()}`,
        repositoryName: "test-repo",
        repositoryFullName: "org/test-repo",
        defaultBranch: "main",
        permissions: {},
      },
    });
    const snapId = `snap-${randomUUID()}`;
    trackedSnapshotIds.add(snapId);
    await prisma1.repositorySnapshot.create({
      data: {
        id: snapId,
        assessmentId: scanAssessment.assessmentId,
        connectionId: connId,
        repositoryId: `repo-${randomUUID()}`,
        repositoryFullName: "org/test-repo",
        commitSha: "a".repeat(40),
        providerMetadata: {},
        actorId: defaultOwnerId,
        status: "READY",
      },
    });
    const scanJobId = `job-${randomUUID()}`;
    trackedScanJobIds.add(scanJobId);
    await prisma1.repositoryScanJob.create({
      data: {
        id: scanJobId,
        assessmentId: scanAssessment.assessmentId,
        snapshotId: snapId,
        idempotencyKey: `scan-idemp-${randomUUID()}`,
        correlationId: randomUUID(),
        triggerSource: "MANUAL",
        status: REPOSITORY_SCAN_JOB_STATUSES.completed,
      },
    });
    const scanJobMsgId = `msg-scan-${randomUUID()}`;
    trackedCommandIds.add(scanJobMsgId);
    await prisma1.outboxMessage.create({
      data: {
        id: scanJobMsgId,
        aggregateType: OUTBOX_AGGREGATE_TYPES.repositoryScanJob,
        aggregateId: scanJobId,
        eventType: "event.repository-scan.completed.v1",
        payload: {},
        status: OUTBOX_STATUSES.dlq,
        attempts: 3,
        createdAt: new Date(),
      },
    });

    await expect(
      dlqService1.replayMessage(scanJobMsgId, "admin-1", "corr-8c"),
    ).rejects.toMatchObject({
      response: {
        problem: { code: OUTBOX_ERROR_CODES.dlqReplayUnsafeTarget },
      },
    });
  });

  // Test 9 — Deadlock immunity under concurrent operations
  it("Test 9: concurrent interleaved replays, discards, and batch queries execute without deadlock", async () => {
    const fixtures = await Promise.all([
      createQuarantinedRootFixture(),
      createQuarantinedRootFixture(),
      createQuarantinedRootFixture(),
      createQuarantinedRootFixture(),
    ]);

    const ops = [
      dlqService1.replayMessage(fixtures[0].commandId, "admin-1", "corr-9-1"),
      dlqService2.deleteMessage(fixtures[1].commandId, "admin-2", "corr-9-2"),
      repo1.withPendingBatch(10, (msgs) =>
        Promise.resolve(msgs.map((m) => m.id)),
      ),
      dlqService2.replayMessage(fixtures[2].commandId, "admin-3", "corr-9-3"),
      dlqService1.deleteMessage(fixtures[3].commandId, "admin-4", "corr-9-4"),
      repo2.withPendingBatch(10, (msgs) =>
        Promise.resolve(msgs.map((m) => m.id)),
      ),
    ];

    const results = await Promise.allSettled(ops);
    // None should fail with PostgreSQL 40P01 deadlock_detected
    for (const r of results) {
      if (r.status === "rejected") {
        expect((r.reason as Error).message).not.toContain("deadlock detected");
      }
    }

    // Verify all operations succeeded
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("fulfilled");
    expect(results[2].status).toBe("fulfilled");
    expect(results[3].status).toBe("fulfilled");
    expect(results[4].status).toBe("fulfilled");
    expect(results[5].status).toBe("fulfilled");

    // fixtures[0] was replayed: status must be PENDING/OWNED_PENDING, attempts reset
    const msg0 = await prisma1.outboxMessage.findUniqueOrThrow({
      where: { id: fixtures[0].commandId },
    });
    expect([OUTBOX_STATUSES.pending, OUTBOX_STATUSES.ownedPending]).toContain(
      msg0.status,
    );
    expect(msg0.attempts).toBe(0);

    // fixtures[1] was discarded: status must be CANCELLED tombstone
    const msg1 = await prisma1.outboxMessage.findUniqueOrThrow({
      where: { id: fixtures[1].commandId },
    });
    expect(msg1.status).toBe(OUTBOX_STATUSES.cancelled);

    // fixtures[2] was replayed: status must be PENDING/OWNED_PENDING
    const msg2 = await prisma1.outboxMessage.findUniqueOrThrow({
      where: { id: fixtures[2].commandId },
    });
    expect([OUTBOX_STATUSES.pending, OUTBOX_STATUSES.ownedPending]).toContain(
      msg2.status,
    );
    expect(msg2.attempts).toBe(0);

    // fixtures[3] was discarded: status must be CANCELLED tombstone
    const msg3 = await prisma1.outboxMessage.findUniqueOrThrow({
      where: { id: fixtures[3].commandId },
    });
    expect(msg3.status).toBe(OUTBOX_STATUSES.cancelled);

    // Verify all positive audit events were persisted
    const [audit0, audit1, audit2, audit3] = await Promise.all([
      prisma1.auditEvent.findMany({
        where: { resourceId: fixtures[0].commandId },
      }),
      prisma1.auditEvent.findMany({
        where: { resourceId: fixtures[1].commandId },
      }),
      prisma1.auditEvent.findMany({
        where: { resourceId: fixtures[2].commandId },
      }),
      prisma1.auditEvent.findMany({
        where: { resourceId: fixtures[3].commandId },
      }),
    ]);
    expect(audit0[0].eventType).toBe(OUTBOX_AUDIT_EVENT_TYPES.dlqReplayed);
    expect(audit1[0].eventType).toBe(OUTBOX_AUDIT_EVENT_TYPES.dlqDiscarded);
    expect(audit2[0].eventType).toBe(OUTBOX_AUDIT_EVENT_TYPES.dlqReplayed);
    expect(audit3[0].eventType).toBe(OUTBOX_AUDIT_EVENT_TYPES.dlqDiscarded);
  });

  // Test 10 — Repository resetMessageForReplay fails closed on non-DLQ or held slot
  it("Test 10: outboxRepository.resetMessageForReplay strictly fails closed on non-DLQ message", async () => {
    const fixture = await createQuarantinedRootFixture();

    // Replay once via repository
    await repo1.resetMessageForReplay(fixture.commandId);

    // Second replay attempt must throw because message is no longer in DLQ
    await expect(
      repo1.resetMessageForReplay(fixture.commandId),
    ).rejects.toThrow("OUTBOX_MESSAGE_NOT_DLQ");
  });

  // Test 11 — Discard refused when physical slot is held or execution is running
  it("Test 11: refuses discard and records denial audit when physical execution slot is held or runtime is active", async () => {
    const fixture = await createQuarantinedRootFixture({ heldSlot: true });
    await expect(
      dlqService1.deleteMessage(
        fixture.commandId,
        "admin-1",
        "corr-discard-held",
      ),
    ).rejects.toMatchObject({
      response: {
        problem: { code: OUTBOX_ERROR_CODES.dlqDiscardUnsafeTarget },
      },
    });

    // Outbox message remains DLQ
    const msg = await prisma1.outboxMessage.findUniqueOrThrow({
      where: { id: fixture.commandId },
    });
    expect(msg.status).toBe(OUTBOX_STATUSES.dlq);

    // Exactly one denial audit recorded
    const audits = await prisma1.auditEvent.findMany({
      where: { resourceId: fixture.commandId },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].eventType).toBe(OUTBOX_AUDIT_EVENT_TYPES.dlqDiscardDenied);
    expect(audits[0].decision).toBe(AUDIT_DECISIONS.deny);

    // Also refuses discard when heldSlots is 0 but runtime is active (RUNNING)
    const runningFixture = await createQuarantinedRootFixture({
      heldSlot: false,
      executionState: AgentExecutionState.RUNNING,
    });
    await expect(
      dlqService1.deleteMessage(
        runningFixture.commandId,
        "admin-1",
        "corr-discard-running",
      ),
    ).rejects.toMatchObject({
      response: {
        problem: { code: OUTBOX_ERROR_CODES.dlqDiscardUnsafeTarget },
      },
    });
  });

  // Test 12 — Race with slot acquisition: deterministic concurrent race test
  it("Test 12: refuses replay when a physical execution slot is acquired concurrently before replay commits", async () => {
    const fixture = await createQuarantinedRootFixture({ heldSlot: false });

    let notifyLockAcquired!: () => void;
    const lockAcquired = new Promise<void>((resolve) => {
      notifyLockAcquired = resolve;
    });

    // Session 2 acquires the capacity lock first to serialize execution deterministically
    const slotAcquisitionPromise = prisma2.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "AssessmentRootCapacity" ("id", "desired", "effective", "policy", "reason", "updatedAt")
        VALUES (${ROOT_CAPACITY_ID}, 1, 0, '{}'::jsonb, 'INITIAL', clock_timestamp())
        ON CONFLICT ("id") DO NOTHING
      `;
      await tx.$queryRaw`
        SELECT "id" FROM "AssessmentRootCapacity" WHERE "id" = ${ROOT_CAPACITY_ID} FOR UPDATE
      `;

      // Insert held execution slot while holding capacity lock
      await tx.assessmentRootExecutionSlot.create({
        data: {
          runId: randomUUID(),
          assessmentId: fixture.assessmentId,
          commandId: fixture.commandId,
          incarnationId: randomUUID(),
          requestedAt: new Date(),
          admittedAt: new Date(),
          releasedAt: null,
        },
      });

      // Signal that capacity lock and unreleased execution slot are in place
      notifyLockAcquired();

      // Deterministically wait until PostgreSQL confirms Session 1 is actively blocked in pg_locks
      const start = Date.now();
      let blockedWaiterConfirmed = false;
      while (Date.now() - start < 5000) {
        const rows = await tx.$queryRaw<Array<{ count: number }>>`
          SELECT count(*)::int AS count
          FROM pg_locks
          WHERE NOT granted
        `;
        if (rows[0]?.count > 0) {
          blockedWaiterConfirmed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      if (!blockedWaiterConfirmed) {
        throw new Error(
          "PostgreSQL waiter failed to block on AssessmentRootCapacity row lock within timeout",
        );
      }
    });

    // Wait until Session 2 has acquired the capacity lock and inserted the slot
    await lockAcquired;

    // Dispatch replayMessage in Session 1.
    // dlqService1.replayMessage executes SELECT ... FROM "AssessmentRootCapacity" ... FOR UPDATE
    // and blocks at the PostgreSQL row lock level waiting for Session 2 to commit.
    const replayPromise = dlqService1.replayMessage(
      fixture.commandId,
      "admin-race-slot",
      "corr-race-slot",
    );

    // Await Session 2 transaction completion (which commits only AFTER confirming Session 1 is blocked in pg_locks)
    await slotAcquisitionPromise;

    // Session 1 now unblocks, evaluates the newly committed slot, and MUST refuse replay
    await expect(replayPromise).rejects.toMatchObject({
      response: {
        problem: { code: OUTBOX_ERROR_CODES.dlqReplayUnsafeTarget },
      },
    });

    // Message must remain in DLQ
    const msg = await prisma1.outboxMessage.findUniqueOrThrow({
      where: { id: fixture.commandId },
    });
    expect(msg.status).toBe(OUTBOX_STATUSES.dlq);

    // Denial audit must be recorded
    const audits = await prisma1.auditEvent.findMany({
      where: { resourceId: fixture.commandId },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].eventType).toBe(OUTBOX_AUDIT_EVENT_TYPES.dlqReplayDenied);
    expect(audits[0].decision).toBe(AUDIT_DECISIONS.deny);
  });

  // Test 13 — Repository deleteMessage strictly fails closed on held physical slot and tombstones once quiescent
  it("Test 13: outboxRepository.deleteMessage strictly fails closed when physical slot is held and tombstones to CANCELLED once released", async () => {
    const fixture = await createQuarantinedRootFixture({ heldSlot: true });

    // While physical slot is held, deleteMessage must refuse discard
    await expect(repo1.deleteMessage(fixture.commandId)).rejects.toThrow(
      "ROOT_EXECUTION_ACTIVE_CANNOT_DISCARD",
    );

    // Message must remain in DLQ
    const msgBefore = await prisma1.outboxMessage.findUniqueOrThrow({
      where: { id: fixture.commandId },
    });
    expect(msgBefore.status).toBe(OUTBOX_STATUSES.dlq);

    // Release the physical slot (reaching quiescence)
    await prisma1.assessmentRootExecutionSlot.updateMany({
      where: { assessmentId: fixture.assessmentId, releasedAt: null },
      data: { releasedAt: new Date() },
    });

    // Now repository deleteMessage succeeds and tombstones the Root command
    await repo1.deleteMessage(fixture.commandId);

    const msgAfter = await prisma1.outboxMessage.findUniqueOrThrow({
      where: { id: fixture.commandId },
    });
    expect(msgAfter.status).toBe(OUTBOX_STATUSES.cancelled);

    // Admission request remains intact (not deleted)
    const intent = await prisma1.assessmentRootAdmissionRequest.findUnique({
      where: { commandId: fixture.commandId },
    });
    expect(intent).not.toBeNull();
    expect(intent?.assessmentId).toBe(fixture.assessmentId);

    // Repository deleteMessage also strictly rejects when runtime is RUNNING
    const runningFixture = await createQuarantinedRootFixture({
      heldSlot: false,
      executionState: AgentExecutionState.RUNNING,
    });
    await expect(repo1.deleteMessage(runningFixture.commandId)).rejects.toThrow(
      "ROOT_EXECUTION_ACTIVE_CANNOT_DISCARD",
    );
  });
});
