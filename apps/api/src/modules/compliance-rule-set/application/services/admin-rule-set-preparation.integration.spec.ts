import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";
import { PrismaPg } from "@prisma/adapter-pg";
import { LegalSourceLifecycleStatus, PrismaClient } from "@prisma/client";
import {
  COMPLIANCE_RULE_SET_EVENT_TYPES,
  RULE_SET_PREPARATION_FAILURE_REASONS,
  ruleSetPreparationIdempotencyKey,
} from "@lcsp/contracts/compliance-rule-set";
import {
  AGENT_EXECUTION_STATES,
  ARTIFACT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import type { CommandBus } from "@nestjs/cqrs";

import {
  legalSourceFactory,
  validPacket,
} from "../../../../../test/support/compliance-rule-set-fixtures.js";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import type { RabbitMqClient } from "../../../../platform/outbox/rabbitmq.client.js";
import { LegalSourceActivatedConsumer } from "../../infrastructure/messaging/legal-source-activated.consumer.js";
import { PrepareCurrentRuleSetCommand } from "../commands/prepare-current-rule-set/prepare-current-rule-set.command.js";
import { PrepareCurrentRuleSetHandler } from "../commands/prepare-current-rule-set/prepare-current-rule-set.handler.js";
import { StartRuleSetPreparationCommand } from "../commands/start-rule-set-preparation/start-rule-set-preparation.command.js";
import { StartRuleSetPreparationHandler } from "../commands/start-rule-set-preparation/start-rule-set-preparation.handler.js";
import { ClaimRuleSetPreparationCommand } from "../commands/claim-rule-set-preparation/claim-rule-set-preparation.command.js";
import { ClaimRuleSetPreparationHandler } from "../commands/claim-rule-set-preparation/claim-rule-set-preparation.handler.js";
import { FailRuleSetPreparationCommand } from "../commands/fail-rule-set-preparation/fail-rule-set-preparation.command.js";
import { FailRuleSetPreparationHandler } from "../commands/fail-rule-set-preparation/fail-rule-set-preparation.handler.js";
import { RetryRuleSetPreparationCommand } from "../commands/retry-rule-set-preparation/retry-rule-set-preparation.command.js";
import { RetryRuleSetPreparationHandler } from "../commands/retry-rule-set-preparation/retry-rule-set-preparation.handler.js";
import { CancelRuleSetPreparationCommand } from "../commands/cancel-rule-set-preparation/cancel-rule-set-preparation.command.js";
import { CancelRuleSetPreparationHandler } from "../commands/cancel-rule-set-preparation/cancel-rule-set-preparation.handler.js";
import { SubmitComplianceRuleSetCommand } from "../commands/submit-compliance-rule-set/submit-compliance-rule-set.command.js";
import { SubmitComplianceRuleSetHandler } from "../commands/submit-compliance-rule-set/submit-compliance-rule-set.handler.js";
import { LegalSourceSnapshotLoader } from "../../infrastructure/persistence/legal-source-snapshot.service.js";
import { ComplianceRuleSetActivation } from "../../infrastructure/persistence/compliance-rule-set-activation.service.js";

// This paid-work queue proof can ONLY use the named disposable local database; no consumer runs.
const url = new URL(process.env.DATABASE_URL ?? "postgresql://unused/unused");
const isolated =
  url.hostname === "127.0.0.1" &&
  url.port === "55445" &&
  url.pathname === "/lcsp_admin_prepare_test";
const database = isolated ? describe : describe.skip;
const tag = `admin-trigger-${randomUUID().slice(0, 8)}`;

database("Admin preparation PostgreSQL concurrency without models", () => {
  let prisma: PrismaClient;
  let manual: PrepareCurrentRuleSetHandler;
  let consumer: LegalSourceActivatedConsumer;
  let claim: ClaimRuleSetPreparationHandler;
  let fail: FailRuleSetPreparationHandler;
  let submit: SubmitComplianceRuleSetHandler;
  let retry: RetryRuleSetPreparationHandler;
  let cancel: CancelRuleSetPreparationHandler;
  let nativeCancelIds: string[];
  let cancellationEvents: unknown[];
  let sourceFactory: ReturnType<typeof legalSourceFactory>;
  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg(url.toString()) });
    await prisma.$connect();
    // The isolated target can be reused; prior fixtures must not become current source candidates.
    await prisma.legalSourceVersion.updateMany({
      where: { version: { startsWith: "legalSource-admin-trigger-" } },
      data: { status: LegalSourceLifecycleStatus.SUPERSEDED },
    });
    sourceFactory = legalSourceFactory(prisma, tag);
    const service = prisma as unknown as PrismaService;
    const start = new StartRuleSetPreparationHandler(
      service,
      new OutboxRepository(service),
    );
    const bus = {
      execute: (command: StartRuleSetPreparationCommand) =>
        start.execute(command),
    } as unknown as CommandBus;
    manual = new PrepareCurrentRuleSetHandler(service, bus);
    consumer = new LegalSourceActivatedConsumer({} as RabbitMqClient, bus);
    retry = new RetryRuleSetPreparationHandler(service, bus);
    nativeCancelIds = [];
    cancellationEvents = [];
    cancel = new CancelRuleSetPreparationHandler(
      service,
      {
        cancel: (correlationId: string) => {
          nativeCancelIds.push(correlationId);
          return Promise.resolve();
        },
      },
      {
        execute: (command: unknown) => {
          cancellationEvents.push(command);
          return Promise.resolve({ recorded: true });
        },
      } as unknown as CommandBus,
    );
    claim = new ClaimRuleSetPreparationHandler(service);
    fail = new FailRuleSetPreparationHandler(service);
    const outbox = new OutboxRepository(service);
    submit = new SubmitComplianceRuleSetHandler(
      service,
      new LegalSourceSnapshotLoader(service),
      new ComplianceRuleSetActivation(outbox, new AuditWriterService(service)),
    );
  });
  beforeEach(async () => {
    nativeCancelIds = [];
    cancellationEvents = [];
    await prisma.legalSourceVersion.updateMany({
      where: { version: { startsWith: `legalSource-${tag}-` } },
      data: { status: LegalSourceLifecycleStatus.SUPERSEDED },
    });
  });
  afterAll(async () => {
    await prisma.legalSourceVersion.updateMany({
      where: { version: { startsWith: `legalSource-${tag}-` } },
      data: { status: LegalSourceLifecycleStatus.SUPERSEDED },
    });
    await prisma.$disconnect();
  });

  async function eligibleSource() {
    const source = await sourceFactory();
    const index = await prisma.legalRetrievalIndex.findFirstOrThrow({
      where: { legalSourceVersionId: source.id },
    });
    const integrity = `integrity:${source.id}`;
    await prisma.legalSourceVersion.update({
      where: { id: source.id },
      data: { integrityManifestRef: integrity },
    });
    await prisma.legalSourceActivationRecord.create({
      data: {
        legalSourceVersionId: source.id,
        activatedBy: "isolated-test-activation",
        status: LegalSourceLifecycleStatus.ACTIVE,
        integrityManifestRef: integrity,
        retrievalValidationRef: index.validationManifestRef,
        scopeDescription: "isolated canonical activation proof",
      },
    });
    return source;
  }
  const prepare = () =>
    manual.execute(
      new PrepareCurrentRuleSetCommand("owner-admin", randomUUID()),
    );
  const cancelRun = (preparationRunId: string) =>
    cancel.execute(
      new CancelRuleSetPreparationCommand(preparationRunId, randomUUID()),
    );

  it("racing Admin requests and activation create exactly one run and one queued command, no rule-set rows", async () => {
    const source = await eligibleSource();
    const [one, two] = await Promise.all([
      prepare(),
      prepare(),
      consumer.handle({ legalSourceVersionId: source.id }),
      consumer.handle({ legalSourceVersionId: source.id }),
    ]);
    expect(one.preparationRunId).toBe(two.preparationRunId);
    expect(one.legalSourceVersionId).toBe(source.id);
    expect(
      await prisma.ruleSetPreparationRun.count({
        where: { legalSourceVersionId: source.id },
      }),
    ).toBe(1);
    expect(
      await prisma.outboxMessage.count({
        where: {
          aggregateId: source.id,
          eventType: COMPLIANCE_RULE_SET_EVENT_TYPES.preparationRequested,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.complianceRuleSetVersion.count({
        where: { preparationRunId: one.preparationRunId },
      }),
    ).toBe(0);
    expect(
      await prisma.legalRequirement.count({
        where: { ruleSet: { preparationRunId: one.preparationRunId } },
      }),
    ).toBe(0);
    expect(
      await prisma.assessmentRule.count({
        where: { ruleSet: { preparationRunId: one.preparationRunId } },
      }),
    ).toBe(0);
  });

  it("a RUNNING run is returned on repeat without another paid command", async () => {
    const source = await eligibleSource();
    const first = await prepare();
    await claim.execute(
      new ClaimRuleSetPreparationCommand(
        { preparationRunId: first.preparationRunId },
        randomUUID(),
      ),
    );
    expect(await prepare()).toMatchObject({
      preparationRunId: first.preparationRunId,
      executionState: AGENT_EXECUTION_STATES.RUNNING,
    });
    expect(
      await prisma.ruleSetPreparationRun.count({
        where: { legalSourceVersionId: source.id },
      }),
    ).toBe(1);
  });

  it("cancels QUEUED without a native run and makes pending delivery harmless", async () => {
    const source = await eligibleSource();
    const queued = await prepare();

    const cancelled = await cancelRun(queued.preparationRunId);

    expect(cancelled.executionState).toBe(AGENT_EXECUTION_STATES.CANCELLED);
    expect(nativeCancelIds).toHaveLength(0);
    expect(cancellationEvents).toHaveLength(1);
    const persisted = await prisma.ruleSetPreparationRun.findUniqueOrThrow({
      where: { id: queued.preparationRunId },
    });
    expect(persisted).toMatchObject({
      executionState: AGENT_EXECUTION_STATES.CANCELLED,
      failureReason: null,
    });
    expect(persisted.completedAt).toBeInstanceOf(Date);

    await expect(
      claim.execute(
        new ClaimRuleSetPreparationCommand(
          { preparationRunId: queued.preparationRunId },
          randomUUID(),
        ),
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      fail.execute(
        new FailRuleSetPreparationCommand(
          {
            preparationRunId: queued.preparationRunId,
            reason: RULE_SET_PREPARATION_FAILURE_REASONS.RUNTIME_ERROR,
          },
          randomUUID(),
        ),
      ),
    ).resolves.toMatchObject({
      preparationRunId: queued.preparationRunId,
      executionState: AGENT_EXECUTION_STATES.CANCELLED,
    });
    expect(
      await prisma.complianceRuleSetVersion.count({
        where: { legalSourceVersionId: source.id },
      }),
    ).toBe(0);
    expect(
      await prisma.legalRequirement.count({
        where: { ruleSet: { legalSourceVersionId: source.id } },
      }),
    ).toBe(0);
    expect(
      await prisma.assessmentRule.count({
        where: { ruleSet: { legalSourceVersionId: source.id } },
      }),
    ).toBe(0);

    const [next, duplicateNext] = await Promise.all([prepare(), prepare()]);
    expect(next.preparationRunId).toBe(duplicateNext.preparationRunId);
    expect(next.preparationRunId).not.toBe(queued.preparationRunId);
    expect(
      await prisma.ruleSetPreparationRun.findUniqueOrThrow({
        where: { id: next.preparationRunId },
      }),
    ).toMatchObject({
      idempotencyKey: ruleSetPreparationIdempotencyKey(source.id, 2),
      executionState: AGENT_EXECUTION_STATES.QUEUED,
    });
  });

  it("cancels RUNNING through native control and serializes against publication", async () => {
    const source = await eligibleSource();
    const running = await prepare();
    await claim.execute(
      new ClaimRuleSetPreparationCommand(
        { preparationRunId: running.preparationRunId },
        randomUUID(),
      ),
    );
    const before = await prisma.ruleSetPreparationRun.findUniqueOrThrow({
      where: { id: running.preparationRunId },
    });

    await cancelRun(running.preparationRunId);
    expect(nativeCancelIds).toEqual([before.correlationId]);
    await expect(
      submit.execute(
        new SubmitComplianceRuleSetCommand(
          {
            preparationRunId: running.preparationRunId,
            idempotencyKey: `submit-${randomUUID()}`,
            packet: validPacket(),
          },
          "test-worker",
          randomUUID(),
        ),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await prisma.ruleSetPreparationRun.findUniqueOrThrow({
        where: { id: running.preparationRunId },
      }),
    ).toMatchObject({
      executionState: AGENT_EXECUTION_STATES.CANCELLED,
      failureReason: null,
    });
    expect(
      await prisma.complianceRuleSetVersion.count({
        where: { legalSourceVersionId: source.id },
      }),
    ).toBe(0);
    expect(
      await prisma.legalRequirement.count({
        where: { ruleSet: { legalSourceVersionId: source.id } },
      }),
    ).toBe(0);
    expect(
      await prisma.assessmentRule.count({
        where: { ruleSet: { legalSourceVersionId: source.id } },
      }),
    ).toBe(0);
  });

  it("serializes a concurrent submit behind native cancellation without partial rows", async () => {
    const source = await eligibleSource();
    const running = await prepare();
    await claim.execute(
      new ClaimRuleSetPreparationCommand(
        { preparationRunId: running.preparationRunId },
        randomUUID(),
      ),
    );

    let nativeCancelStarted!: () => void;
    const nativeStarted = new Promise<void>((resolve) => {
      nativeCancelStarted = resolve;
    });
    let allowCancellationToSettle!: () => void;
    const cancellationGate = new Promise<void>((resolve) => {
      allowCancellationToSettle = resolve;
    });
    const racingCancel = new CancelRuleSetPreparationHandler(
      prisma as unknown as PrismaService,
      {
        cancel: async () => {
          nativeCancelStarted();
          await cancellationGate;
        },
      },
      {
        execute: () => Promise.resolve({ recorded: true }),
      } as unknown as CommandBus,
    );
    const cancellation = racingCancel.execute(
      new CancelRuleSetPreparationCommand(
        running.preparationRunId,
        randomUUID(),
      ),
    );
    await nativeStarted;

    const submission = submit.execute(
      new SubmitComplianceRuleSetCommand(
        {
          preparationRunId: running.preparationRunId,
          idempotencyKey: `submit-${randomUUID()}`,
          packet: validPacket(),
        },
        "test-worker",
        randomUUID(),
      ),
    );
    const submittedWhileCancellationHeld = await Promise.race([
      submission.then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 25)),
    ]);
    allowCancellationToSettle();
    await expect(cancellation).resolves.toMatchObject({
      executionState: AGENT_EXECUTION_STATES.CANCELLED,
    });
    expect(submittedWhileCancellationHeld).toBe(false);
    await expect(submission).rejects.toMatchObject({ status: 409 });
    expect(
      await prisma.ruleSetPreparationRun.findUniqueOrThrow({
        where: { id: running.preparationRunId },
      }),
    ).toMatchObject({ executionState: AGENT_EXECUTION_STATES.CANCELLED });
    expect(
      await prisma.complianceRuleSetVersion.count({
        where: { preparationRunId: running.preparationRunId },
      }),
    ).toBe(0);
    expect(
      await prisma.legalRequirement.count({
        where: { ruleSet: { preparationRunId: running.preparationRunId } },
      }),
    ).toBe(0);
    expect(
      await prisma.assessmentRule.count({
        where: { ruleSet: { preparationRunId: running.preparationRunId } },
      }),
    ).toBe(0);
    expect(source.id).toBe(running.legalSourceVersionId);
  });

  it("cannot cancel after publication commits", async () => {
    const source = await eligibleSource();
    const running = await prepare();
    await claim.execute(
      new ClaimRuleSetPreparationCommand(
        { preparationRunId: running.preparationRunId },
        randomUUID(),
      ),
    );
    const result = await submit.execute(
      new SubmitComplianceRuleSetCommand(
        {
          preparationRunId: running.preparationRunId,
          idempotencyKey: `submit-${randomUUID()}`,
          packet: validPacket(),
        },
        "test-worker",
        randomUUID(),
      ),
    );

    await expect(cancelRun(running.preparationRunId)).rejects.toMatchObject({
      status: 409,
    });

    expect(
      await prisma.ruleSetPreparationRun.findUniqueOrThrow({
        where: { id: running.preparationRunId },
      }),
    ).toMatchObject({ executionState: AGENT_EXECUTION_STATES.SUCCEEDED });
    expect(
      await prisma.complianceRuleSetVersion.findUniqueOrThrow({
        where: { id: result.ruleSetVersionId },
      }),
    ).toMatchObject({ lifecycleState: ARTIFACT_LIFECYCLE_STATES.ACTIVE });
    expect(nativeCancelIds).toHaveLength(0);
    expect(
      await prisma.legalRequirement.count({
        where: { ruleSetVersionId: result.ruleSetVersionId },
      }),
    ).toBeGreaterThan(0);
    expect(
      await prisma.assessmentRule.count({
        where: { ruleSetVersionId: result.ruleSetVersionId },
      }),
    ).toBeGreaterThan(0);
    expect(
      await prisma.complianceRuleSetVersion.count({
        where: { legalSourceVersionId: source.id },
      }),
    ).toBe(1);
  });

  it("a failed attempt uses canonical Retry and a subsequent Prepare returns that queued retry", async () => {
    const source = await eligibleSource();
    const first = await prepare();
    await claim.execute(
      new ClaimRuleSetPreparationCommand(
        { preparationRunId: first.preparationRunId },
        randomUUID(),
      ),
    );
    await fail.execute(
      new FailRuleSetPreparationCommand(
        {
          preparationRunId: first.preparationRunId,
          reason: RULE_SET_PREPARATION_FAILURE_REASONS.NO_SUBMISSION,
        },
        randomUUID(),
      ),
    );
    await expect(prepare()).rejects.toMatchObject({ status: 409 });
    const next = await retry.execute(
      new RetryRuleSetPreparationCommand(
        first.preparationRunId,
        "owner-admin",
        randomUUID(),
      ),
    );
    expect(next.preparationRunId).not.toBe(first.preparationRunId);
    expect(next.legalSourceVersionId).toBe(source.id);
    expect(await prepare()).toMatchObject({
      preparationRunId: next.preparationRunId,
    });
    expect(
      await prisma.ruleSetPreparationRun.count({
        where: { legalSourceVersionId: source.id },
      }),
    ).toBe(2);
  });

  it("an ACTIVE fixture without canonical activation cannot be selected", async () => {
    await sourceFactory();
    await expect(prepare()).rejects.toMatchObject({ status: 409 });
  });
});
