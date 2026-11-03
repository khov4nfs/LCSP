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
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
} from "./support/auth-workspace-test-helpers.js";

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

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    pushPrismaSchema();
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
    await prisma1.auditEvent.deleteMany();
    await prisma1.assessmentRootExecutionSlot.deleteMany();
    await prisma1.assessmentRootAdmissionRequest.deleteMany();
    await prisma1.outboxMessage.deleteMany();
    await prisma1.assessmentRuntimeTurn.deleteMany();
    await prisma1.assessmentRuntime.deleteMany();
    await prisma1.repositoryScanJob.deleteMany();
    await prisma1.repositorySnapshot.deleteMany();
    await prisma1.repositoryConnection.deleteMany();
    await prisma1.assessment.deleteMany();
    await prisma1.user.deleteMany({ where: { id: defaultOwnerId } });
    await prisma1.$disconnect();
    await prisma2.$disconnect();
  });

  beforeEach(async () => {
    // Clean up test tables
    await prisma1.auditEvent.deleteMany();
    await prisma1.assessmentRootExecutionSlot.deleteMany();
    await prisma1.assessmentRootAdmissionRequest.deleteMany();
    await prisma1.outboxMessage.deleteMany();
    await prisma1.assessmentRuntimeTurn.deleteMany();
    await prisma1.assessmentRuntime.deleteMany();
    await prisma1.repositoryScanJob.deleteMany();
    await prisma1.repositorySnapshot.deleteMany();
    await prisma1.repositoryConnection.deleteMany();
    await prisma1.assessment.deleteMany();
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
});
