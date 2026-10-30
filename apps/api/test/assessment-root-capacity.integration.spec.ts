import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  AgentExecutionState,
  AssessmentLifecycleState,
  AuthUserRole,
  OutboxAggregateType,
  OutboxStatus,
} from "@prisma/client";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import {
  ASSESSMENT_ROOT_COMMAND_TYPES,
  ROOT_CAPACITY_ID,
  ROOT_CAPACITY_REASONS as Reasons,
  ROOT_CAPACITY_METRIC_SOURCES as Sources,
  rootCapacityPolicySchema,
  type RootCapacityRuntimeMetrics,
} from "@lcsp/contracts/assessment-domain";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import { WorkerApiKeyGuard } from "../src/common/guards/worker-api-key.guard.js";
import { AssessmentRootCapacityService } from "../src/modules/assessment/application/services/assessment-root-capacity.service.js";
import { AssessmentRootCapacityController } from "../src/modules/assessment/presentation/http/assessment-root-capacity.controller.js";
import { OutboxRepository } from "../src/platform/outbox/outbox.repository.js";

const url = process.env.LCSP_TEST_CAPACITY_DATABASE_URL;
const integration = url ? describe : describe.skip;
const brokerIntegration = process.env.LCSP_TEST_RABBITMQ_URL ? it : it.skip;
const execFileAsync = promisify(execFile);
const policy = rootCapacityPolicySchema.parse({
  enabled: false,
  initial: 2,
  maximum: 4,
  providerConcurrentLimit: 8,
  providerRpmLimit: 1000,
  providerTpmLimit: 1000000,
});
const workerKey = "lcsp364-provider-free-worker-key-32-characters";
const host = "a".repeat(64);

function metrics(active = 0): RootCapacityRuntimeMetrics {
  const sampledAt = new Date().toISOString();
  return {
    sampledAt,
    source: Sources.runtime,
    workerSlots: 4,
    serverSlots: 4,
    activeNativeRuns: active,
    activeNativeRoots: active,
    reservedRootRuns: active,
    draining: false,
    cpuPressure: 0.01,
    memoryAvailableBytes: 32 * 1024 ** 3,
    cgroupMemoryAvailableBytes: 32 * 1024 ** 3,
    cgroupMemoryLimitBytes: 64 * 1024 ** 3,
    cgroupCpuLimitCores: 8,
    cgroupObserved: true,
    processRssBytes: 1000000,
    diskAvailableBytes: 32 * 1024 ** 3,
    diskPressure: 0,
    sandboxMemoryBytes: 0,
    largestSandboxMemoryBytes: 0,
    sandboxCpuCores: 0,
    activeSandboxes: 0,
    sandboxSamples: [],
    brokerReady: 8,
    brokerUnacknowledged: active,
    brokerOtherReady: 0,
    brokerObservedAt: sampledAt,
    brokerSource: Sources.broker,
    checkpointLatencyMs: 2,
    checkpointFailureRate: 0,
    checkpointObservedAt: sampledAt,
    provider429Count: 0,
    budgetDenialCount: 0,
  };
}

integration(
  "LCSP-364 real PostgreSQL global admission and worker HTTP boundary",
  () => {
    let first: PrismaClient, second: PrismaClient;
    let a: AssessmentRootCapacityService, b: AssessmentRootCapacityService;
    let app: INestApplication<Server>;
    let incarnationId: string;
    const suffix = randomUUID();
    const owners = [`lcsp364-owner-a-${suffix}`, `lcsp364-owner-b-${suffix}`];
    const ids: string[] = [];

    async function report(
      service: AssessmentRootCapacityService,
      input: Omit<
        Parameters<AssessmentRootCapacityService["report"]>[0],
        "expectedVersion"
      >,
    ) {
      return service.report({
        ...input,
        expectedVersion: (await service.registration()).version,
      });
    }

    it("keeps live Root slots during DLQ replay and reopens only quiescent intent", async () => {
      const one = await enqueue();
      const repository = new OutboxRepository(first as PrismaService);
      const commandId = `fixture-command:${one.assessmentId}`;
      await a.reserve(one);
      await repository.resetMessageForReplay(commandId);
      expect(
        (
          await first.assessmentRootAdmissionRequest.findUniqueOrThrow({
            where: { commandId },
          })
        ).admittedRunId,
      ).toBe(one.runId);
      expect((await a.status()).active).toBe(1);
      await first.$transaction((tx) =>
        a.bindInTx(tx, one.assessmentId, one.runId, randomUUID()),
      );
      await first.assessmentRuntime.update({
        where: { assessmentId: one.assessmentId },
        data: { executionState: AgentExecutionState.FAILED },
      });
      await a.release(one);
      expect(
        (
          await first.assessmentRootAdmissionRequest.findUniqueOrThrow({
            where: { commandId },
          })
        ).completedAt,
      ).not.toBeNull();
      await first.outboxMessage.update({
        where: { id: commandId },
        data: { status: OutboxStatus.DLQ },
      });
      await repository.resetMessageForReplay(commandId);
      expect((await b.reserve({ ...one, runId: randomUUID() })).admitted).toBe(
        true,
      );
    });

    it("discards Root DLQ transport without cascading away admission history or live capacity", async () => {
      const one = await enqueue();
      await a.reserve(one);
      const commandId = `fixture-command:${one.assessmentId}`;
      await first.outboxMessage.update({
        where: { id: commandId },
        data: { status: OutboxStatus.DLQ },
      });
      await new OutboxRepository(first as PrismaService).deleteMessage(
        commandId,
      );
      expect(
        (
          await first.outboxMessage.findUniqueOrThrow({
            where: { id: commandId },
          })
        ).status,
      ).toBe(OutboxStatus.CANCELLED);
      expect((await a.status()).active).toBe(1);
      await a.release(one);
      expect(
        await first.assessmentRootExecutionSlot.count({
          where: { assessmentId: one.assessmentId },
        }),
      ).toBe(1);
    });

    beforeAll(async () => {
      const target = new URL(url!);
      if (
        !["127.0.0.1", "localhost"].includes(target.hostname) ||
        !target.pathname.includes("lcsp364_capacity")
      ) {
        throw new Error(
          "Dedicated local lcsp364_capacity disposable database required",
        );
      }
      first = new PrismaClient({ adapter: new PrismaPg(url!) });
      second = new PrismaClient({ adapter: new PrismaPg(url!) });
      await Promise.all([first.$connect(), second.$connect()]);
      a = new AssessmentRootCapacityService(first as PrismaService);
      b = new AssessmentRootCapacityService(second as PrismaService);
      const module = await Test.createTestingModule({
        controllers: [AssessmentRootCapacityController],
        providers: [
          { provide: AssessmentRootCapacityService, useValue: a },
          WorkerApiKeyGuard,
          {
            provide: ConfigService,
            useValue: new ConfigService({ worker: { apiKey: workerKey } }),
          },
        ],
      }).compile();
      app = module.createNestApplication();
      await app.listen(0, "127.0.0.1");
      for (const id of owners)
        await first.user.create({
          data: {
            id,
            email: `${id}@fixture.invalid`,
            passwordHash: "unused-fixture-hash",
            emailVerified: true,
            failedLoginCount: 0,
            role: AuthUserRole.CUSTOMER,
          },
        });
    });

    beforeEach(async () => {
      await first.assessmentRootExecutionSlot.deleteMany();
      await first.assessmentRootAdmissionRequest.deleteMany();
      await first.assessmentRootCapacityDecision.deleteMany();
      await first.assessmentRootCapacity.deleteMany();
      await first.outboxMessage.deleteMany({
        where: { aggregateId: { in: ids } },
      });
      await first.assessment.deleteMany({ where: { ownerId: { in: owners } } });
      ids.length = 0;
      incarnationId = randomUUID();
      await a.register({
        hostId: host,
        incarnationId,
        liveRunIds: [],
        expectedVersion: (await a.registration()).version,
      });
      const current = await a.status();
      await a.control(
        {
          expectedVersion: current.version,
          reason: "Provider-free integration envelope",
          policy,
        },
        owners[0],
      );
      await report(a, {
        hostId: host,
        incarnationId,
        liveRunIds: [],
        metrics: metrics(),
      });
    });

    afterAll(async () => {
      if (first) {
        await first.assessment.deleteMany({
          where: { ownerId: { in: owners } },
        });
        await first.outboxMessage.deleteMany({
          where: { aggregateId: { in: ids } },
        });
        await first.user.deleteMany({ where: { id: { in: owners } } });
      }
      await app?.close();
      await Promise.all([first?.$disconnect(), second?.$disconnect()]);
    });

    async function enqueue(owner = owners[0], ageSeconds = 60) {
      const id = randomUUID();
      ids.push(id);
      const commandKey = `root:${id}`;
      await first.assessment.create({
        data: {
          id,
          ownerId: owner,
          name: "Provider-free capacity fixture",
          lifecycleState: AssessmentLifecycleState.ACTIVE,
          lifecycleRevision: 1,
          runtime: {
            create: {
              threadId: randomUUID(),
              rootAgentVersion: "lcsp-assessment-root.v1",
              checkpointNamespace: id,
              executionState: AgentExecutionState.QUEUED,
            },
          },
        },
      });
      await first.outboxMessage.create({
        data: {
          id: `fixture-command:${id}`,
          aggregateType: OutboxAggregateType.ASSESSMENT,
          aggregateId: id,
          eventType: ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
          status: OutboxStatus.PUBLISHED,
          payload: { assessmentId: id, idempotencyKey: commandKey },
          createdAt: new Date(Date.now() - ageSeconds * 1000),
        },
      });
      await first.assessmentRootAdmissionRequest.create({
        data: {
          commandId: `fixture-command:${id}`,
          assessmentId: id,
          requestedAt: new Date(Date.now() - ageSeconds * 1000),
        },
      });
      return {
        assessmentId: id,
        commandKey,
        runId: randomUUID(),
        hostId: host,
        incarnationId,
      };
    }

    async function enqueueLargeBacklog() {
      const requestedAt = Date.now() - 60_000;
      const jobs = Array.from({ length: 10_001 }, (_, index) => {
        const assessmentId = randomUUID();
        return {
          assessmentId,
          commandKey: `root:${assessmentId}`,
          commandId: `fixture-command:${assessmentId}`,
          ownerId: owners[index === 10_000 ? 1 : 0],
          requestedAt: new Date(requestedAt + index),
          runId: randomUUID(),
          hostId: host,
          incarnationId,
        };
      });
      ids.push(...jobs.map((job) => job.assessmentId));
      await first.$transaction(
        async (tx) => {
          await tx.assessment.createMany({
            data: jobs.map((job) => ({
              id: job.assessmentId,
              ownerId: job.ownerId,
              name: "Provider-free backlog fixture",
              lifecycleState: AssessmentLifecycleState.ACTIVE,
              lifecycleRevision: 1,
            })),
          });
          await tx.assessmentRuntime.createMany({
            data: jobs.map((job) => ({
              assessmentId: job.assessmentId,
              threadId: randomUUID(),
              rootAgentVersion: "lcsp-assessment-root.v1",
              checkpointNamespace: job.assessmentId,
              executionState: AgentExecutionState.QUEUED,
            })),
          });
          await tx.outboxMessage.createMany({
            data: jobs.map((job) => ({
              id: job.commandId,
              aggregateType: OutboxAggregateType.ASSESSMENT,
              aggregateId: job.assessmentId,
              eventType: ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
              status: OutboxStatus.PUBLISHED,
              payload: {
                assessmentId: job.assessmentId,
                idempotencyKey: job.commandKey,
              },
              createdAt: job.requestedAt,
            })),
          });
          await tx.assessmentRootAdmissionRequest.createMany({
            data: jobs.map((job) => ({
              assessmentId: job.assessmentId,
              commandId: job.commandId,
              requestedAt: job.requestedAt,
            })),
          });
        },
        { timeout: 30_000 },
      );
      const reservation = (job: (typeof jobs)[number]) => ({
        assessmentId: job.assessmentId,
        commandKey: job.commandKey,
        runId: job.runId,
        hostId: job.hostId,
        incarnationId: job.incarnationId,
      });
      return { head: reservation(jobs[0]), tail: reservation(jobs[10_000]) };
    }

    it("defers an eligible out-of-order command beyond 10000 candidates and later admits its owner", async () => {
      const { head, tail } = await enqueueLargeBacklog();
      expect(await first.assessmentRootAdmissionRequest.count()).toBe(10_001);
      const deferred = await b.reserve(tail);
      expect(deferred).not.toHaveProperty("obsolete", true);
      expect(deferred).toMatchObject({
        admitted: false,
        reason: Reasons.fairness,
      });
      expect(await first.assessmentRootExecutionSlot.count()).toBe(0);
      expect(await a.reserve(head)).toMatchObject({ admitted: true });
      await a.release(head);
      expect(await b.reserve(tail)).toMatchObject({ admitted: true });
      expect((await a.status()).active).toBe(1);
    }, 60_000);

    brokerIntegration(
      "preserves a delivery beyond 10000 candidates through real SDK HTTP and RabbitMQ retry settlement",
      async () => {
        const { tail } = await enqueueLargeBacklog();
        const address = app.getHttpServer().address();
        if (!address || typeof address === "string")
          throw new Error("Local worker HTTP server unavailable");
        const { stdout } = await execFileAsync(
          process.env.LCSP_TEST_PYTHON ?? "python",
          [
            "-m",
            "pytest",
            "-q",
            "-s",
            "tests/test_assessment_concurrency_rabbitmq.py::test_large_postgres_backlog_delivery_preserves_durable_retry",
          ],
          {
            cwd: fileURLToPath(
              new URL("../../../deepagents/", import.meta.url),
            ),
            timeout: 60_000,
            env: {
              ...process.env,
              NESTJS_API_BASE_URL: `http://127.0.0.1:${address.port}`,
              WORKER_API_KEY: workerKey,
              LCSP_TEST_CAPACITY_BACKLOG_RESERVATION: JSON.stringify(tail),
              LANGSMITH_TRACING: "false",
              LANGCHAIN_TRACING_V2: "false",
            },
          },
        );
        expect(stdout).toContain("LCSP364_BACKLOG_BROKER_PASS");
        process.stdout.write(stdout);
        expect(await first.assessmentRootExecutionSlot.count()).toBe(0);
        expect(
          await first.assessmentRootAdmissionRequest.findUniqueOrThrow({
            where: { commandId: `fixture-command:${tail.assessmentId}` },
          }),
        ).toMatchObject({ admittedRunId: null, completedAt: null });
        expect((await a.status()).admissionDeferrals).toBeGreaterThan(0);
      },
      90_000,
    );

    it("serializes admissions from independent API pools without crossing the global cap", async () => {
      const jobs = await Promise.all(
        Array.from({ length: 8 }, (_, i) => enqueue(owners[i % 2], 120 - i)),
      );
      const accepted = new Set<string>();
      for (let wave = 0; wave < 4; wave++) {
        const results = await Promise.all(
          jobs.map((job, index) => (index % 2 ? a : b).reserve(job)),
        );
        results.forEach((result, index) => {
          if (result.admitted) accepted.add(jobs[index].assessmentId);
        });
        expect(
          await first.assessmentRootExecutionSlot.count({
            where: { releasedAt: null },
          }),
        ).toBeLessThanOrEqual(2);
      }
      expect(accepted.size).toBe(2);
      expect(
        new Set(
          (
            await first.assessmentRootExecutionSlot.findMany({
              where: { releasedAt: null },
            })
          ).map((s) => s.assessmentId),
        ).size,
      ).toBe(2);
    });

    it("rotates tenants beyond broker credit and progresses after out-of-order quiescence", async () => {
      const one = await enqueue(owners[0], 120),
        two = await enqueue(owners[0], 110),
        other = await enqueue(owners[1], 100);
      expect((await a.reserve(one)).admitted).toBe(true);
      expect(await b.reserve(two)).toMatchObject({
        admitted: false,
        reason: Reasons.fairness,
      });
      expect((await b.reserve(other)).admitted).toBe(true);
      expect(await a.reserve(two)).toMatchObject({
        admitted: false,
        reason: Reasons.full,
      });
      await b.release(other);
      expect((await a.reserve(two)).admitted).toBe(true);
      expect((await a.status()).active).toBe(2);
    });

    it("does not release expired leases or domain HITL/finish before physical quiescence", async () => {
      const one = await enqueue(),
        two = await enqueue(owners[1]);
      await a.reserve(one);
      await b.reserve(two);
      await first.assessmentRuntime.update({
        where: { assessmentId: one.assessmentId },
        data: {
          executionState: AgentExecutionState.RUNNING,
          currentExecutionId: randomUUID(),
          leaseToken: randomUUID(),
          leaseExpiresAt: new Date(Date.now() - 100000),
        },
      });
      const third = await enqueue();
      expect(await b.reserve(third)).toMatchObject({
        admitted: false,
        reason: Reasons.full,
      });
      await first.assessment.update({
        where: { id: one.assessmentId },
        data: { lifecycleState: AssessmentLifecycleState.WAITING_FOR_HUMAN },
      });
      await first.assessmentRuntime.update({
        where: { assessmentId: one.assessmentId },
        data: {
          executionState: AgentExecutionState.INTERRUPTED,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      expect(await b.reserve(third)).toMatchObject({
        admitted: false,
        reason: Reasons.full,
      });
      expect((await a.status()).active).toBe(2);
      await a.release(one);
      expect((await b.reserve(third)).admitted).toBe(true);
    });

    it("binds only the exact reserved native run and rejects cross-Assessment/stale IDs", async () => {
      const one = await enqueue(),
        other = await enqueue(owners[1]);
      await a.reserve(one);
      await first.$transaction((tx) =>
        a.bindInTx(tx, one.assessmentId, one.runId, randomUUID()),
      );
      expect(
        (
          await first.assessmentRootExecutionSlot.findUniqueOrThrow({
            where: { runId: one.runId },
          })
        ).startedAt,
      ).not.toBeNull();
      await expect(
        first.$transaction((tx) =>
          a.bindInTx(tx, other.assessmentId, one.runId, randomUUID()),
        ),
      ).rejects.toThrow();
      await a.release(one);
      await expect(
        first.$transaction((tx) =>
          a.bindInTx(tx, one.assessmentId, one.runId, randomUUID()),
        ),
      ).rejects.toThrow();
    });

    it("fences old incarnations and retains live slots across server/controller restart", async () => {
      const one = await enqueue(),
        two = await enqueue(owners[1]);
      await a.reserve(one);
      await a.reserve(two);
      const replacement = randomUUID();
      const delayed = {
        hostId: host,
        incarnationId: randomUUID(),
        liveRunIds: [],
        expectedVersion: (await a.registration()).version,
      };
      await b.register({
        hostId: host,
        incarnationId: replacement,
        liveRunIds: [one.runId],
        expectedVersion: delayed.expectedVersion,
      });
      expect((await b.status()).active).toBe(1);
      expect((await b.status()).effective).toBe(0);
      await expect(a.release(one)).rejects.toThrow();
      await expect(a.reserve(await enqueue())).rejects.toThrow();
      await expect(
        report(a, {
          hostId: host,
          incarnationId,
          liveRunIds: [],
          metrics: metrics(),
        }),
      ).rejects.toThrow();
      expect(
        (
          await first.assessmentRootExecutionSlot.findUniqueOrThrow({
            where: { runId: one.runId },
          })
        ).incarnationId,
      ).toBe(replacement);
      await expect(a.register(delayed)).rejects.toThrow();
      expect((await b.registration()).incarnationId).toBe(replacement);
      await expect(
        a.register({
          hostId: "b".repeat(64),
          incarnationId: randomUUID(),
          liveRunIds: [],
          expectedVersion: (await a.registration()).version,
        }),
      ).rejects.toThrow();
    });

    it("rejects a delayed reconciliation snapshot after a newer admission", async () => {
      const expectedVersion = (await a.registration()).version;
      const one = await enqueue();
      expect((await b.reserve(one)).admitted).toBe(true);
      await expect(
        a.report({
          hostId: host,
          incarnationId,
          expectedVersion,
          liveRunIds: [],
          metrics: metrics(),
        }),
      ).rejects.toThrow();
      expect((await b.status()).active).toBe(1);
      expect(
        (
          await first.assessmentRootExecutionSlot.findUniqueOrThrow({
            where: { runId: one.runId },
          })
        ).releasedAt,
      ).toBeNull();
      await report(a, {
        hostId: host,
        incarnationId,
        liveRunIds: [one.runId],
        metrics: metrics(1),
      });
      expect((await b.status()).active).toBe(1);
    });

    it("uses the durable audited policy even if a later process has an invalid seed environment", async () => {
      const previous = process.env.LCSP_ROOT_CAPACITY_POLICY;
      try {
        process.env.LCSP_ROOT_CAPACITY_POLICY =
          "invalid seed must not override durable authority";
        expect((await b.status()).effective).toBe(2);
      } finally {
        if (previous === undefined)
          delete process.env.LCSP_ROOT_CAPACITY_POLICY;
        else process.env.LCSP_ROOT_CAPACITY_POLICY = previous;
      }
    });

    it("recovers a lost release receipt using the consistent live-run snapshot", async () => {
      const one = await enqueue();
      await a.reserve(one);
      await new Promise((resolve) => setTimeout(resolve, 2));
      await report(b, {
        hostId: host,
        incarnationId,
        liveRunIds: [],
        metrics: metrics(),
      });
      expect((await a.status()).active).toBe(0);
      expect((await a.status()).recoveredSlots).toBe(1);
    });

    it("idempotently reattaches a reserved run and ACKs consumed/superseded command duplicates", async () => {
      const one = await enqueue();
      expect((await a.reserve(one)).admitted).toBe(true);
      expect((await b.reserve(one)).admitted).toBe(true);
      expect((await a.status()).active).toBe(1);
      await first.$transaction((tx) =>
        a.bindInTx(tx, one.assessmentId, one.runId, randomUUID()),
      );
      await first.assessmentRuntime.update({
        where: { assessmentId: one.assessmentId },
        data: { executionState: AgentExecutionState.SUCCEEDED },
      });
      await a.release(one);
      expect(await b.reserve({ ...one, runId: randomUUID() })).toMatchObject({
        admitted: false,
        obsolete: true,
      });
      const nextKey = `${one.commandKey}:continue`;
      await first.outboxMessage.create({
        data: {
          id: randomUUID(),
          aggregateType: OutboxAggregateType.ASSESSMENT,
          aggregateId: one.assessmentId,
          eventType: ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
          payload: { idempotencyKey: nextKey },
        },
      });
      expect(await b.reserve({ ...one, runId: randomUUID() })).toMatchObject({
        admitted: false,
        obsolete: true,
      });
      expect(
        (await b.reserve({ ...one, runId: randomUUID(), commandKey: nextKey }))
          .admitted,
      ).toBe(true);
    });

    it("retains durable retry eligibility after an unsettled execution crashes", async () => {
      const one = await enqueue();
      await a.reserve(one);
      await first.$transaction((tx) =>
        a.bindInTx(tx, one.assessmentId, one.runId, randomUUID()),
      );
      await first.assessmentRuntime.update({
        where: { assessmentId: one.assessmentId },
        data: {
          executionState: AgentExecutionState.RUNNING,
          currentExecutionId: randomUUID(),
          leaseToken: randomUUID(),
          leaseExpiresAt: new Date(Date.now() - 100000),
        },
      });
      await a.release(one);
      const retried = { ...one, runId: randomUUID() };
      expect((await b.reserve(retried)).admitted).toBe(true);
      expect((await a.status()).active).toBe(1);
      expect(
        (
          await first.assessmentRootAdmissionRequest.findUniqueOrThrow({
            where: { commandId: `fixture-command:${one.assessmentId}` },
          })
        ).completedAt,
      ).toBeNull();
    });

    it("re-admits expired human-interrupt recovery only after physical termination", async () => {
      const one = await enqueue();
      await a.reserve(one);
      await first.$transaction((tx) =>
        a.bindInTx(tx, one.assessmentId, one.runId, randomUUID()),
      );
      await first.assessment.update({
        where: { id: one.assessmentId },
        data: { lifecycleState: AssessmentLifecycleState.WAITING_FOR_HUMAN },
      });
      await first.assessmentRuntime.update({
        where: { assessmentId: one.assessmentId },
        data: {
          executionState: AgentExecutionState.RUNNING,
          currentExecutionId: randomUUID(),
          leaseToken: randomUUID(),
          leaseExpiresAt: new Date(Date.now() - 100000),
        },
      });
      const recovery = { ...one, runId: randomUUID() };
      expect(await b.reserve(recovery)).toMatchObject({
        admitted: false,
        reason: Reasons.held,
      });
      await a.release(one);
      expect((await b.reserve(recovery)).admitted).toBe(true);
    });

    it("withholds admission on stale telemetry and preserves audited versioned manual rollback", async () => {
      const one = await enqueue();
      const current = await a.status();
      await a.control(
        {
          expectedVersion: current.version,
          policy: { ...policy, emergencyDisabled: true },
          reason: "Emergency integration control",
        },
        owners[0],
      );
      expect((await a.status()).effective).toBe(0);
      expect((await b.reserve(one)).admitted).toBe(false);
      await expect(
        b.control(
          {
            expectedVersion: current.version,
            policy,
            reason: "Conflicting old operator state",
          },
          owners[0],
        ),
      ).rejects.toThrow();
      const emergency = await a.status();
      await b.control(
        {
          expectedVersion: emergency.version,
          policy,
          reason: "Return to known bounded two",
        },
        owners[0],
      );
      await new Promise((resolve) => setTimeout(resolve, 2));
      await report(a, {
        hostId: host,
        incarnationId,
        liveRunIds: [],
        metrics: metrics(),
      });
      expect((await a.status()).effective).toBe(2);
      await first.assessmentRootCapacity.update({
        where: { id: ROOT_CAPACITY_ID },
        data: { reportedAt: new Date(Date.now() - 120000) },
      });
      expect(await b.reserve(one)).toMatchObject({
        admitted: false,
        reason: Reasons.stale,
      });
      expect(
        (await a.status()).history.some(
          (h) => h.operatorReason === "Return to known bounded two",
        ),
      ).toBe(true);
    });

    it("authenticates/validates the real HTTP protocol and keeps problem HTTP status consistent", async () => {
      const server = app.getHttpServer();
      const missing = await request(server)
        .post("/internal/assessment-root-capacity/reserve")
        .send({});
      expect(missing.status).toBe(401);
      expect(missing.body).toMatchObject({
        ok: false,
        problem: { status: 401 },
      });
      const invalid = await request(server)
        .post("/internal/assessment-root-capacity/reserve")
        .set("x-worker-api-key", workerKey)
        .send({});
      expect(invalid.status).toBe(422);
      expect(invalid.body).toMatchObject({
        ok: false,
        problem: { status: 422 },
      });
      const one = await enqueue();
      const response = await request(server)
        .post("/internal/assessment-root-capacity/reserve")
        .set("x-worker-api-key", workerKey)
        .send(one);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        ok: true,
        data: { admitted: true },
      });
    });
  },
);
