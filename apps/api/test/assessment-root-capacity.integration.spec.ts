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
  BLOCKER_REASONS,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
} from "@lcsp/contracts/assessment";
import {
  PrismaClient,
  AgentExecutionState,
  AssessmentLifecycleState,
  AuthUserRole,
  OutboxAggregateType,
  OutboxStatus,
  AssessmentRuntimeControlState,
} from "@prisma/client";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import {
  ASSESSMENT_ROOT_COMMAND_TYPES,
  ASSESSMENT_ROOT_BOUNDARY,
  ASSESSMENT_AUDIT_MODES,
  HUMAN_RESOLUTION_CONTROL_TYPES,
  RULE_AUDIT_SCOPE_MODES,
  RULE_AUDIT_STATUSES,
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
      await expect(
        repository.resetMessageForReplay(commandId),
      ).rejects.toThrow();
      expect(
        (
          await first.assessmentRootAdmissionRequest.findUniqueOrThrow({
            where: { commandId },
          })
        ).admittedRunId,
      ).toBe(one.runId);
      expect((await a.status()).active).toBe(1);
      await first.$transaction((tx) =>
        a.bindInTx(
          tx,
          one.assessmentId,
          one.runId,
          randomUUID(),
          incarnationId,
        ),
      );
      const runtime = await first.assessmentRuntime.findUniqueOrThrow({
        where: { assessmentId: one.assessmentId },
      });
      const terminalTurn = randomUUID();
      await first.assessmentRuntimeTurn.create({
        data: {
          id: terminalTurn,
          assessmentId: one.assessmentId,
          threadId: runtime.threadId,
          boundary: ASSESSMENT_ROOT_BOUNDARY,
          logicalRunId: terminalTurn,
          correlationId: randomUUID(),
          state: AssessmentRuntimeControlState.COMPLETED,
          contextJson: { runtimeRunId: one.runId },
        },
      });
      await first.assessmentRuntime.update({
        where: { assessmentId: one.assessmentId },
        data: {
          executionState: AgentExecutionState.FAILED,
          currentExecutionId: terminalTurn,
        },
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
      const refreshed =
        await first.assessmentRootAdmissionRequest.findUniqueOrThrow({
          where: { commandId },
        });
      expect(refreshed.requestedAt.getTime()).toBeGreaterThan(
        Date.now() - 5000,
      );
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
      const repository = new OutboxRepository(first as PrismaService);
      await expect(repository.deleteMessage(commandId)).rejects.toThrow(
        "ROOT_EXECUTION_ACTIVE_CANNOT_DISCARD",
      );
      expect((await a.status()).active).toBe(1);
      await a.release(one);
      await repository.deleteMessage(commandId);
      expect(
        (
          await first.outboxMessage.findUniqueOrThrow({
            where: { id: commandId },
          })
        ).status,
      ).toBe(OutboxStatus.CANCELLED);
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
    }, 30_000);

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

    async function enqueueHumanReview(
      options: {
        selected?: boolean;
        answered?: boolean;
        latest?: Record<string, unknown>;
      } = {},
    ) {
      const demand = await enqueue();
      const runtime = await first.assessmentRuntime.findUniqueOrThrow({
        where: { assessmentId: demand.assessmentId },
      });
      const checkpointId = randomUUID();
      const turnId = randomUUID();
      const auditRequestId = options.selected ? randomUUID() : null;
      const ruleId = "review-selected-rule";
      await first.assessmentCase.create({
        data: {
          assessmentId: demand.assessmentId,
          auditMode: options.selected
            ? ASSESSMENT_AUDIT_MODES.CUSTOMER_SELECTED
            : ASSESSMENT_AUDIT_MODES.LEGACY_FULL,
        },
      });
      if (auditRequestId) {
        await first.assessmentRuleAuditRequest.create({
          data: {
            requestId: auditRequestId,
            assessmentId: demand.assessmentId,
            requestRevision: 1,
            idempotencyKey: randomUUID(),
            requestDigest: "a".repeat(64),
            scopeMode: RULE_AUDIT_SCOPE_MODES.SELECTED_RULES,
            status: RULE_AUDIT_STATUSES.WAITING_FOR_CUSTOMER,
            ruleSetVersionId: "capacity-fixture-rule-set",
            ruleSetDigest: "b".repeat(64),
            repositorySnapshotId: "capacity-fixture-snapshot",
            repositoryCommit: "c".repeat(40),
            rules: {
              create: {
                assessmentRuleId: ruleId,
                assessmentRuleVersion: "1",
                ordinal: 0,
              },
            },
          },
        });
      }
      const contextJson = auditRequestId
        ? { auditRequestId, checkpointThreadId: auditRequestId }
        : { checkpointThreadId: runtime.threadId };
      await first.assessmentRuntimeTurn.create({
        data: {
          id: turnId,
          assessmentId: demand.assessmentId,
          threadId: runtime.threadId,
          boundary: ASSESSMENT_ROOT_BOUNDARY,
          logicalRunId: turnId,
          correlationId: randomUUID(),
          state: AssessmentRuntimeControlState.COMPLETED,
          contextJson,
          checkpointJson: { checkpointId },
        },
      });
      await first.assessmentRuntime.update({
        where: { assessmentId: demand.assessmentId },
        data: {
          executionState: AgentExecutionState.INTERRUPTED,
          checkpointId,
          currentExecutionId: turnId,
          currentAuditRequestId: auditRequestId,
        },
      });
      await first.assessment.update({
        where: { id: demand.assessmentId },
        data: { lifecycleState: AssessmentLifecycleState.WAITING_FOR_HUMAN },
      });

      async function addRequest(
        assessmentRuleId = ruleId,
        answered = true,
        latest: Record<string, unknown> = {},
      ) {
        const requestId = randomUUID();
        await first.assessmentHumanRequest.create({
          data: {
            requestId,
            assessmentId: demand.assessmentId,
            threadId: runtime.threadId,
            assessmentRuleId,
            criterionIds: ["criterion"],
            question: "Confirm an external fact",
            unresolvedFact: "external-fact",
            decisionImpact: [],
            resolutionAttempts: [],
            controlType: HUMAN_RESOLUTION_CONTROL_TYPES.FREE_TEXT,
            choices: [],
            caseRevision: 0,
            checkpointId,
          },
        });
        if (answered) {
          await first.assessmentHumanRequest.update({
            where: { requestId },
            data: {
              requestRevision: 1,
              answers: [
                {
                  idempotencyKey: randomUUID(),
                  requestDigest: "d".repeat(64),
                  actorId: owners[0],
                  answeredAt: new Date().toISOString(),
                  caseRevision: 0,
                  requestRevision: 1,
                  doesNotKnow: true,
                  answer: null,
                  checkpointId,
                  ...latest,
                },
              ] as never,
            },
          });
        }
        return requestId;
      }
      const requestId = await addRequest(
        ruleId,
        options.answered !== false,
        options.latest,
      );
      const commandKey = `human-review:${demand.assessmentId}:${checkpointId}`;
      const commandId = randomUUID();
      await first.outboxMessage.create({
        data: {
          id: commandId,
          aggregateType: OutboxAggregateType.ASSESSMENT,
          aggregateId: demand.assessmentId,
          eventType: ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
          status: OutboxStatus.PUBLISHED,
          payload: {
            assessmentId: demand.assessmentId,
            idempotencyKey: commandKey,
          },
        },
      });
      await first.assessmentRootAdmissionRequest.create({
        data: {
          commandId,
          assessmentId: demand.assessmentId,
          requestedAt: new Date(),
        },
      });
      return {
        reservation: { ...demand, commandKey },
        requestId,
        checkpointId,
        turnId,
        auditRequestId,
        contextJson,
        addRequest,
      };
    }

    it.each([false, true])(
      "admits an exact UNKNOWN review before a grant exists (selected=%s)",
      async (selected) => {
        const review = await enqueueHumanReview({ selected });
        const before = await first.assessmentRuntime.findUniqueOrThrow({
          where: { assessmentId: review.reservation.assessmentId },
        });
        expect(await a.reserve(review.reservation)).toMatchObject({
          admitted: true,
        });
        expect(
          await first.assessmentRuntime.findUniqueOrThrow({
            where: { assessmentId: review.reservation.assessmentId },
          }),
        ).toEqual(before);
        const human = await first.assessmentHumanRequest.findUniqueOrThrow({
          where: { requestId: review.requestId },
        });
        expect(human.status).toBe(HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN);
        expect(human.resolvedFactId).toBeNull();
        expect(review.contextJson).not.toHaveProperty("humanAnswerReview");
        expect(
          (
            await first.assessmentCase.findUniqueOrThrow({
              where: { assessmentId: review.reservation.assessmentId },
            })
          ).caseRevision,
        ).toBe(0);
      },
    );

    it.each([
      ["wrong audit", { auditRequestId: randomUUID() }],
      ["wrong native thread", { checkpointThreadId: randomUUID() }],
    ])("rejects selected UNKNOWN review with %s", async (_label, changes) => {
      const review = await enqueueHumanReview({ selected: true });
      await first.assessmentRuntimeTurn.update({
        where: { id: review.turnId },
        data: { contextJson: { ...review.contextJson, ...changes } },
      });
      expect(await a.reserve(review.reservation)).toMatchObject({
        admitted: false,
        obsolete: true,
      });
      expect(await first.assessmentRootExecutionSlot.count()).toBe(0);
    });

    it.each(["threadId", "checkpointJson"])(
      "rejects UNKNOWN review with a foreign turn %s",
      async (field) => {
        const review = await enqueueHumanReview();
        await first.assessmentRuntimeTurn.update({
          where: { id: review.turnId },
          data:
            field === "threadId"
              ? { threadId: randomUUID() }
              : { checkpointJson: { checkpointId: randomUUID() } },
        });
        expect(await a.reserve(review.reservation)).toMatchObject({
          admitted: false,
          obsolete: true,
        });
      },
    );

    it.each([
      ["stale answer checkpoint", { checkpointId: randomUUID() }],
      ["stale answer revision", { requestRevision: 2 }],
      ["newest answer is known", { doesNotKnow: false, answer: "Known fact" }],
    ])("rejects UNKNOWN review with %s", async (_label, latest) => {
      const review = await enqueueHumanReview({ latest });
      expect(await a.reserve(review.reservation)).toMatchObject({
        admitted: false,
        obsolete: true,
      });
    });

    it("requires every current open dependency to have a newest UNKNOWN response", async () => {
      const review = await enqueueHumanReview({ answered: false });
      expect(await a.reserve(review.reservation)).toMatchObject({
        admitted: false,
        obsolete: true,
      });
      const second = await enqueueHumanReview({ selected: true });
      await second.addRequest("review-selected-rule", false);
      expect(await a.reserve(second.reservation)).toMatchObject({
        admitted: false,
        obsolete: true,
      });
    });

    it("ignores historical unselected open questions when admitting the current selected review", async () => {
      const review = await enqueueHumanReview({ selected: true });
      await review.addRequest("historical-unselected-rule", false);
      expect(await a.reserve(review.reservation)).toMatchObject({
        admitted: true,
      });
    });

    it("does not admit a direct INTERRUPTED review on a BLOCKED human-fact case", async () => {
      const review = await enqueueHumanReview();
      await first.assessment.update({
        where: { id: review.reservation.assessmentId },
        data: {
          lifecycleState: AssessmentLifecycleState.BLOCKED,
          blockerReason: BLOCKER_REASONS.HUMAN_FACT_UNRESOLVABLE,
          blockerReference: { humanResolutionRequestId: review.requestId },
        },
      });
      expect(await a.reserve(review.reservation)).toMatchObject({
        admitted: false,
        obsolete: true,
      });
    });

    it("keeps UNKNOWN review under the same owner fairness and physical-slot rules", async () => {
      const firstInQueue = await enqueue(owners[1], 120);
      const review = await enqueueHumanReview({ selected: true });
      expect(await a.reserve(review.reservation)).toMatchObject({
        admitted: false,
        reason: Reasons.fairness,
      });
      expect(await b.reserve(firstInQueue)).toMatchObject({ admitted: true });
      expect(await a.reserve(review.reservation)).toMatchObject({
        admitted: true,
      });
      expect(
        await b.reserve({ ...review.reservation, runId: randomUUID() }),
      ).toMatchObject({ admitted: false, reason: Reasons.held });
    });

    type ReviewProof = {
      checkpointId: string;
      requests: Array<{ requestId: string; requestRevision: number }>;
    };
    type FailedReviewFixtureOptions = {
      selected?: boolean;
      blocked?: boolean;
      foreignBlocker?: boolean;
      receipt?: (proof: ReviewProof) => unknown;
      context?: Record<string, unknown>;
      wrongAdvancedCheckpoint?: boolean;
      changedAnswerRevision?: boolean;
      extraRequestRule?: string;
      staleDemand?: boolean;
      consumedOnly?: boolean;
      liveLease?: boolean;
    };

    async function enqueueFailedHumanReview(
      options: FailedReviewFixtureOptions = {},
    ) {
      const review = await enqueueHumanReview({ selected: options.selected });
      expect(await a.reserve(review.reservation)).toMatchObject({
        admitted: true,
      });
      await first.$transaction((tx) =>
        a.bindInTx(
          tx,
          review.reservation.assessmentId,
          review.reservation.runId,
          randomUUID(),
          incarnationId,
        ),
      );
      const proof: ReviewProof = {
        checkpointId: review.checkpointId,
        requests: [{ requestId: review.requestId, requestRevision: 1 }],
      };
      const advancedCheckpointId = randomUUID();
      const failedTurnId = randomUUID();
      const failedTurn = await first.assessmentRuntimeTurn.create({
        data: {
          id: failedTurnId,
          assessmentId: review.reservation.assessmentId,
          threadId: (
            await first.assessmentRuntime.findUniqueOrThrow({
              where: { assessmentId: review.reservation.assessmentId },
            })
          ).threadId,
          boundary: ASSESSMENT_ROOT_BOUNDARY,
          logicalRunId: failedTurnId,
          correlationId: randomUUID(),
          state: AssessmentRuntimeControlState.COMPLETED,
          createdAt: new Date(Date.now() - 5000),
          contextJson: {
            ...review.contextJson,
            runtimeRunId: review.reservation.runId,
            humanAnswerReview: options.receipt ? options.receipt(proof) : proof,
            ...options.context,
          } as never,
          checkpointJson: {
            checkpointId: options.wrongAdvancedCheckpoint
              ? randomUUID()
              : advancedCheckpointId,
          },
        },
      });
      await first.assessmentRuntime.update({
        where: { assessmentId: review.reservation.assessmentId },
        data: {
          executionState: AgentExecutionState.FAILED,
          currentExecutionId: failedTurnId,
          checkpointId: advancedCheckpointId,
          leaseToken: options.liveLease ? randomUUID() : null,
          leaseExpiresAt: options.liveLease
            ? new Date(Date.now() + 60000)
            : null,
        },
      });
      if (review.auditRequestId) {
        await first.assessmentRuleAuditRequest.update({
          where: { requestId: review.auditRequestId },
          data: { status: RULE_AUDIT_STATUSES.FAILED },
        });
      }
      if (options.blocked) {
        await first.assessment.update({
          where: { id: review.reservation.assessmentId },
          data: {
            lifecycleState: AssessmentLifecycleState.BLOCKED,
            blockerReason: BLOCKER_REASONS.HUMAN_FACT_UNRESOLVABLE,
            blockerReference: {
              humanResolutionRequestId: options.foreignBlocker
                ? randomUUID()
                : review.requestId,
            },
          },
        });
      }
      if (options.changedAnswerRevision) {
        const request = await first.assessmentHumanRequest.findUniqueOrThrow({
          where: { requestId: review.requestId },
        });
        await first.assessmentHumanRequest.update({
          where: { requestId: review.requestId },
          data: {
            requestRevision: 2,
            answers: [
              ...(request.answers as unknown[]),
              {
                idempotencyKey: randomUUID(),
                requestDigest: "e".repeat(64),
                actorId: owners[0],
                answeredAt: new Date().toISOString(),
                caseRevision: 0,
                requestRevision: 2,
                doesNotKnow: true,
                answer: null,
                checkpointId: review.checkpointId,
              },
            ] as never,
          },
        });
      }
      if (options.extraRequestRule)
        await review.addRequest(options.extraRequestRule, true);
      await a.release(review.reservation);
      const [consumed] = await first.assessmentRootAdmissionRequest.findMany({
        where: { admittedRunId: review.reservation.runId },
      });
      expect(consumed.completedAt).not.toBeNull();
      if (options.consumedOnly) {
        return {
          review,
          consumed,
          failedTurn,
          advancedCheckpointId,
          reservation: { ...review.reservation, runId: randomUUID() },
        };
      }
      const commandId = randomUUID();
      const commandKey = `fixture-root-retry:${commandId}`;
      await first.outboxMessage.create({
        data: {
          id: commandId,
          aggregateType: OutboxAggregateType.ASSESSMENT,
          aggregateId: review.reservation.assessmentId,
          eventType: ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
          status: OutboxStatus.PUBLISHED,
          payload: {
            assessmentId: review.reservation.assessmentId,
            idempotencyKey: commandKey,
          },
        },
      });
      await first.assessmentRootAdmissionRequest.create({
        data: {
          commandId,
          assessmentId: review.reservation.assessmentId,
          requestedAt: options.staleDemand
            ? new Date(failedTurn.createdAt.getTime() + 1)
            : new Date(),
        },
      });
      return {
        review,
        consumed,
        failedTurn,
        advancedCheckpointId,
        reservation: { ...review.reservation, commandKey, runId: randomUUID() },
      };
    }

    it.each([
      { selected: false, blocked: false },
      { selected: true, blocked: false },
      { selected: false, blocked: true },
      { selected: true, blocked: true },
    ])(
      "admits a new failed-review command with both checkpoint identities (selected=$selected, blocked=$blocked)",
      async (options) => {
        const failed = await enqueueFailedHumanReview(options);
        const beforeRuntime = await first.assessmentRuntime.findUniqueOrThrow({
          where: { assessmentId: failed.reservation.assessmentId },
        });
        expect(await a.reserve(failed.reservation)).toMatchObject({
          admitted: true,
        });
        expect(
          await first.assessmentRuntime.findUniqueOrThrow({
            where: { assessmentId: failed.reservation.assessmentId },
          }),
        ).toEqual(beforeRuntime);
        expect(beforeRuntime.checkpointId).toBe(failed.advancedCheckpointId);
        expect(
          (
            await first.assessmentHumanRequest.findUniqueOrThrow({
              where: { requestId: failed.review.requestId },
            })
          ).checkpointId,
        ).toBe(failed.review.checkpointId);
        expect(failed.advancedCheckpointId).not.toBe(
          failed.review.checkpointId,
        );
        expect(
          await first.assessmentRootAdmissionRequest.findUniqueOrThrow({
            where: { commandId: failed.consumed.commandId },
          }),
        ).toEqual(failed.consumed);
      },
    );

    const invalidReviewReceipts: Array<
      [string, (proof: ReviewProof) => unknown]
    > = [
      ["missing grant", () => null],
      ["nonarray request list", (proof) => ({ ...proof, requests: {} })],
      [
        "wrong original checkpoint",
        (proof) => ({ ...proof, checkpointId: randomUUID() }),
      ],
      [
        "wrong request identity",
        (proof) => ({
          ...proof,
          requests: [{ requestId: randomUUID(), requestRevision: 1 }],
        }),
      ],
      [
        "wrong saved revision",
        (proof) => ({
          ...proof,
          requests: [{ ...proof.requests[0], requestRevision: 2 }],
        }),
      ],
      [
        "extra saved request",
        (proof) => ({
          ...proof,
          requests: [
            ...proof.requests,
            { requestId: randomUUID(), requestRevision: 1 },
          ],
        }),
      ],
    ];
    it.each(invalidReviewReceipts)(
      "rejects failed review with %s",
      async (_label, receipt) => {
        const failed = await enqueueFailedHumanReview({ receipt });
        expect(await a.reserve(failed.reservation)).toMatchObject({
          admitted: false,
          obsolete: true,
        });
        expect(
          await first.assessmentRootExecutionSlot.count({
            where: { releasedAt: null },
          }),
        ).toBe(0);
      },
    );

    const invalidFailedReviewStates: Array<
      [string, FailedReviewFixtureOptions]
    > = [
      ["wrong current advanced checkpoint", { wrongAdvancedCheckpoint: true }],
      ["changed latest UNKNOWN revision", { changedAnswerRevision: true }],
      [
        "new open scoped dependency",
        { extraRequestRule: "review-selected-rule" },
      ],
      ["stale request issued before failure", { staleDemand: true }],
      ["unreleased lease", { liveLease: true }],
      ["foreign blocked request", { blocked: true, foreignBlocker: true }],
      [
        "wrong selected audit",
        { selected: true, context: { auditRequestId: randomUUID() } },
      ],
      [
        "wrong selected checkpoint thread",
        { selected: true, context: { checkpointThreadId: randomUUID() } },
      ],
    ];
    it.each(invalidFailedReviewStates)(
      "rejects failed review with %s",
      async (_label, options) => {
        const failed = await enqueueFailedHumanReview(options);
        expect(await a.reserve(failed.reservation)).toMatchObject({
          admitted: false,
          obsolete: true,
        });
      },
    );

    it("never revives the consumed failed-review command even with a valid saved proof", async () => {
      const failed = await enqueueFailedHumanReview({ consumedOnly: true });
      expect(await a.reserve(failed.reservation)).toMatchObject({
        admitted: false,
        obsolete: true,
      });
      expect(
        await first.assessmentRootAdmissionRequest.findUniqueOrThrow({
          where: { commandId: failed.consumed.commandId },
        }),
      ).toEqual(failed.consumed);
    });

    it("keeps historical unselected requests outside the failed review receipt set", async () => {
      const failed = await enqueueFailedHumanReview({
        selected: true,
        extraRequestRule: "historical-unselected-rule",
      });
      expect(await a.reserve(failed.reservation)).toMatchObject({
        admitted: true,
      });
    });

    it("does not let a malformed failed-review receipt abort an independent customer's fair admission", async () => {
      const failed = await enqueueFailedHumanReview({
        receipt: (proof) => ({ ...proof, requests: {} }),
      });
      const independent = await enqueue(owners[1], 120);
      expect(await b.reserve(independent)).toMatchObject({ admitted: true });
      expect(await a.reserve(failed.reservation)).toMatchObject({
        admitted: false,
        obsolete: true,
      });
    });

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

    it("does not let a legacy completed failed command strand independent demand or a new continuation", async () => {
      const ended = await enqueue(owners[0], 3600);
      const next = await enqueue(owners[1]);
      const runtime = await first.assessmentRuntime.findUniqueOrThrow({
        where: { assessmentId: ended.assessmentId },
      });
      const executionId = randomUUID();
      const terminal = await first.assessmentRuntimeTurn.create({
        data: {
          id: executionId,
          assessmentId: ended.assessmentId,
          threadId: runtime.threadId,
          boundary: ASSESSMENT_ROOT_BOUNDARY,
          logicalRunId: executionId,
          correlationId: randomUUID(),
          state: AssessmentRuntimeControlState.COMPLETED,
          contextJson: { runtimeRunId: randomUUID() },
        },
      });
      await first.assessmentRuntime.update({
        where: { assessmentId: ended.assessmentId },
        data: {
          executionState: AgentExecutionState.FAILED,
          currentExecutionId: executionId,
        },
      });
      const before = await first.assessmentRuntime.findUniqueOrThrow({
        where: { assessmentId: ended.assessmentId },
      });
      expect((await a.reserve(next)).admitted).toBe(true);
      expect(await b.reserve(ended)).toMatchObject({
        admitted: false,
        obsolete: true,
      });
      expect(
        await first.assessmentRuntime.findUnique({
          where: { assessmentId: ended.assessmentId },
        }),
      ).toEqual(before);
      expect(
        (
          await first.assessmentRootAdmissionRequest.findUniqueOrThrow({
            where: { commandId: `fixture-command:${ended.assessmentId}` },
          })
        ).completedAt,
      ).toBeNull();

      // A new command may share millisecond resolution with the earlier failed turn.
      const continuedKey = `${ended.commandKey}:continued`;
      await first.outboxMessage.create({
        data: {
          id: randomUUID(),
          aggregateType: OutboxAggregateType.ASSESSMENT,
          aggregateId: ended.assessmentId,
          eventType: ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
          status: OutboxStatus.PUBLISHED,
          createdAt: terminal.createdAt,
          payload: {
            assessmentId: ended.assessmentId,
            idempotencyKey: continuedKey,
          },
        },
      });
      expect(
        (
          await b.reserve({
            ...ended,
            runId: randomUUID(),
            commandKey: continuedKey,
          })
        ).admitted,
      ).toBe(true);
      expect(
        (
          await first.assessmentRuntime.findUniqueOrThrow({
            where: { assessmentId: ended.assessmentId },
          })
        ).threadId,
      ).toBe(runtime.threadId);
    });

    it("keeps physical capacity and defers redelivery after a terminal callback until actual release", async () => {
      const running = await enqueue();
      expect((await a.reserve(running)).admitted).toBe(true);
      const runtime = await first.assessmentRuntime.findUniqueOrThrow({
        where: { assessmentId: running.assessmentId },
      });
      const executionId = randomUUID();
      await first.assessmentRuntimeTurn.create({
        data: {
          id: executionId,
          assessmentId: running.assessmentId,
          threadId: runtime.threadId,
          boundary: ASSESSMENT_ROOT_BOUNDARY,
          logicalRunId: executionId,
          correlationId: randomUUID(),
          state: AssessmentRuntimeControlState.COMPLETED,
          contextJson: { runtimeRunId: running.runId },
        },
      });
      await first.$transaction((tx) =>
        a.bindInTx(
          tx,
          running.assessmentId,
          running.runId,
          executionId,
          incarnationId,
        ),
      );
      await first.assessmentRuntime.update({
        where: { assessmentId: running.assessmentId },
        data: {
          currentExecutionId: executionId,
          executionState: AgentExecutionState.FAILED,
        },
      });
      const duplicate = await b.reserve({ ...running, runId: randomUUID() });
      expect(duplicate).toMatchObject({ admitted: false });
      expect(duplicate.obsolete).not.toBe(true);
      expect((await a.status()).active).toBe(1);
      const independent = await enqueue(owners[1]);
      expect((await b.reserve(independent)).admitted).toBe(true);
      expect((await a.status()).active).toBe(2);
      await a.release(running);
      expect((await a.status()).active).toBe(1);
    });

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
      for (const missingOrStale of [undefined, randomUUID()])
        await expect(
          first.$transaction((tx) =>
            a.bindInTx(
              tx,
              one.assessmentId,
              one.runId,
              randomUUID(),
              missingOrStale,
            ),
          ),
        ).rejects.toThrow();
      await first.$transaction((tx) =>
        a.bindInTx(
          tx,
          one.assessmentId,
          one.runId,
          randomUUID(),
          incarnationId,
        ),
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
          a.bindInTx(
            tx,
            other.assessmentId,
            one.runId,
            randomUUID(),
            incarnationId,
          ),
        ),
      ).rejects.toThrow();
      await a.release(one);
      await expect(
        first.$transaction((tx) =>
          a.bindInTx(
            tx,
            one.assessmentId,
            one.runId,
            randomUUID(),
            incarnationId,
          ),
        ),
      ).rejects.toThrow();
    });

    it("fences old incarnations and retains live slots across server/controller restart", async () => {
      const one = await enqueue(),
        two = await enqueue(owners[1]);
      await a.reserve(one);
      await a.reserve(two);
      const executionId = randomUUID();
      const original = await first.assessmentRuntime.findUniqueOrThrow({
        where: { assessmentId: one.assessmentId },
      });
      await first.assessmentRuntimeTurn.create({
        data: {
          id: executionId,
          assessmentId: one.assessmentId,
          threadId: original.threadId,
          boundary: ASSESSMENT_ROOT_BOUNDARY,
          logicalRunId: executionId,
          correlationId: randomUUID(),
          state: AssessmentRuntimeControlState.RUNNING,
          contextJson: { runtimeRunId: one.runId },
        },
      });
      await first.assessmentRuntime.update({
        where: { assessmentId: one.assessmentId },
        data: {
          currentExecutionId: executionId,
          executionState: AgentExecutionState.RUNNING,
          leaseToken: randomUUID(),
          leaseExpiresAt: new Date(Date.now() + 600000),
        },
      });
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
      const fenced = await first.assessmentRuntime.findUniqueOrThrow({
        where: { assessmentId: one.assessmentId },
      });
      expect(fenced.leaseToken).toBeNull();
      expect(fenced.leaseExpiresAt).toBeNull();
      expect(fenced.threadId).toBe(original.threadId);
      expect(fenced.currentExecutionId).toBe(executionId);
      await expect(
        first.$transaction((tx) =>
          a.bindInTx(
            tx,
            one.assessmentId,
            one.runId,
            randomUUID(),
            incarnationId,
          ),
        ),
      ).rejects.toThrow();
      await first.$transaction((tx) =>
        a.bindInTx(tx, one.assessmentId, one.runId, randomUUID(), replacement),
      );
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
        a.bindInTx(
          tx,
          one.assessmentId,
          one.runId,
          randomUUID(),
          incarnationId,
        ),
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
        a.bindInTx(
          tx,
          one.assessmentId,
          one.runId,
          randomUUID(),
          incarnationId,
        ),
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
        a.bindInTx(
          tx,
          one.assessmentId,
          one.runId,
          randomUUID(),
          incarnationId,
        ),
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
