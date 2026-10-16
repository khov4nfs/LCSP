import { pinFixtureRequest } from "../../../../../test/support/pin-legal-graph-fixture.js";
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
  COMPLIANCE_RULE_SET_ERROR_CODES,
  COMPLIANCE_RULE_SET_EVENT_TYPES,
  RULE_SET_PREPARATION_FAILURE_REASONS,
  RULE_SET_PREPARATION_REFUSAL_REASONS,
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
import { AssessmentRuntimePreparation } from "../../../assessment/application/services/assessment-runtime-preparation.service.js";
import { loadRuleSetPreparationAvailability } from "../../infrastructure/persistence/rule-set-preparation-availability.loader.js";
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
    claim = new ClaimRuleSetPreparationHandler(
      service,
      new LegalDocumentGraphService(service),
    );
    fail = new FailRuleSetPreparationHandler(service);
    const outbox = new OutboxRepository(service);
    submit = new SubmitComplianceRuleSetHandler(
      service,
      new LegalSourceSnapshotLoader(
        service,
        new LegalDocumentGraphService(service),
      ),
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

  it("refuses a request that names a Legal Source Version which is not the active one, and starts nothing", async () => {
    const source = await eligibleSource();
    const runsBefore = await prisma.ruleSetPreparationRun.count();

    await expect(
      manual.execute(
        new PrepareCurrentRuleSetCommand(
          "owner-admin",
          randomUUID(),
          false,
          randomUUID(),
        ),
      ),
    ).rejects.toMatchObject({
      response: {
        problem: {
          code: COMPLIANCE_RULE_SET_ERROR_CODES.preparationNotAllowed,
          meta: {
            reason:
              RULE_SET_PREPARATION_REFUSAL_REASONS.SOURCE_VERSION_NOT_ACTIVE,
          },
        },
      },
    });
    expect(await prisma.ruleSetPreparationRun.count()).toBe(runsBefore);

    // Naming the version that really is active proceeds as before.
    const run = await manual.execute(
      new PrepareCurrentRuleSetCommand(
        "owner-admin",
        randomUUID(),
        false,
        source.id,
      ),
    );
    expect(run.legalSourceVersionId).toBe(source.id);
  });

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
          await pinFixtureRequest(prisma, {
            preparationRunId: running.preparationRunId,
            idempotencyKey: `submit-${randomUUID()}`,
            packet: validPacket(),
          }),
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
        await pinFixtureRequest(prisma, {
          preparationRunId: running.preparationRunId,
          idempotencyKey: `submit-${randomUUID()}`,
          packet: validPacket(),
        }),
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
        await pinFixtureRequest(prisma, {
          preparationRunId: running.preparationRunId,
          idempotencyKey: `submit-${randomUUID()}`,
          packet: validPacket(),
        }),
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

  it("Admin can Prepare after terminal failure and Retry uses the same next-attempt engine", async () => {
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
    const second = await prepare();
    expect(second).toMatchObject({
      legalSourceVersionId: source.id,
      executionState: AGENT_EXECUTION_STATES.QUEUED,
    });
    await expect(
      prisma.ruleSetPreparationRun.findUniqueOrThrow({
        where: { id: second.preparationRunId },
      }),
    ).resolves.toMatchObject({
      idempotencyKey: ruleSetPreparationIdempotencyKey(source.id, 2),
    });
    await claim.execute(
      new ClaimRuleSetPreparationCommand(
        { preparationRunId: second.preparationRunId },
        randomUUID(),
      ),
    );
    await fail.execute(
      new FailRuleSetPreparationCommand(
        {
          preparationRunId: second.preparationRunId,
          reason: RULE_SET_PREPARATION_FAILURE_REASONS.NO_SUBMISSION,
        },
        randomUUID(),
      ),
    );
    const third = await retry.execute(
      new RetryRuleSetPreparationCommand(
        second.preparationRunId,
        "owner-admin",
        randomUUID(),
      ),
    );
    expect(third.preparationRunId).not.toBe(second.preparationRunId);
    expect(third.legalSourceVersionId).toBe(source.id);
    expect(await prepare()).toMatchObject({
      preparationRunId: third.preparationRunId,
    });
    expect(
      await prisma.ruleSetPreparationRun.count({
        where: { legalSourceVersionId: source.id },
      }),
    ).toBe(3);
  });

  it("three failed attempts keep Admin Prepare available and concurrent calls create only Attempt 4", async () => {
    const source = await eligibleSource();
    let latest = await prepare();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await claim.execute(
        new ClaimRuleSetPreparationCommand(
          { preparationRunId: latest.preparationRunId },
          randomUUID(),
        ),
      );
      await fail.execute(
        new FailRuleSetPreparationCommand(
          {
            preparationRunId: latest.preparationRunId,
            reason: RULE_SET_PREPARATION_FAILURE_REASONS.NO_SUBMISSION,
          },
          randomUUID(),
        ),
      );
      if (attempt < 3) latest = await prepare();
    }

    const [four, duplicateFour] = await Promise.all([prepare(), prepare()]);
    expect(four.preparationRunId).toBe(duplicateFour.preparationRunId);
    expect(four).toMatchObject({
      legalSourceVersionId: source.id,
      executionState: AGENT_EXECUTION_STATES.QUEUED,
    });
    await expect(
      prisma.ruleSetPreparationRun.findUniqueOrThrow({
        where: { id: four.preparationRunId },
      }),
    ).resolves.toMatchObject({
      idempotencyKey: ruleSetPreparationIdempotencyKey(source.id, 4),
    });
    expect(
      await prisma.ruleSetPreparationRun.count({
        where: { legalSourceVersionId: source.id },
      }),
    ).toBe(4);
  });

  it("explicit Prepare advances from Attempt 10 to Attempt 11", async () => {
    const source = await eligibleSource();
    let latest = await prepare();
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await claim.execute(
        new ClaimRuleSetPreparationCommand(
          { preparationRunId: latest.preparationRunId },
          randomUUID(),
        ),
      );
      await fail.execute(
        new FailRuleSetPreparationCommand(
          {
            preparationRunId: latest.preparationRunId,
            reason: RULE_SET_PREPARATION_FAILURE_REASONS.NO_SUBMISSION,
          },
          randomUUID(),
        ),
      );
      if (attempt < 10) latest = await prepare();
    }

    const eleventh = await prepare();
    expect(eleventh).toMatchObject({
      legalSourceVersionId: source.id,
      executionState: AGENT_EXECUTION_STATES.QUEUED,
    });
    await expect(
      prisma.ruleSetPreparationRun.findUniqueOrThrow({
        where: { id: eleventh.preparationRunId },
      }),
    ).resolves.toMatchObject({
      idempotencyKey: ruleSetPreparationIdempotencyKey(source.id, 11),
    });
    expect(
      await prisma.ruleSetPreparationRun.count({
        where: { legalSourceVersionId: source.id },
      }),
    ).toBe(11);
  });

  it("replayed source activation does not auto-retry a FAILED run", async () => {
    const source = await eligibleSource();
    const run = await prepare();
    await claim.execute(
      new ClaimRuleSetPreparationCommand(
        { preparationRunId: run.preparationRunId },
        randomUUID(),
      ),
    );
    await fail.execute(
      new FailRuleSetPreparationCommand(
        {
          preparationRunId: run.preparationRunId,
          reason: RULE_SET_PREPARATION_FAILURE_REASONS.NO_SUBMISSION,
        },
        randomUUID(),
      ),
    );

    await consumer.handle({ legalSourceVersionId: source.id });

    expect(
      await prisma.ruleSetPreparationRun.count({
        where: { legalSourceVersionId: source.id },
      }),
    ).toBe(1);
  });

  it("replayed source activation does not auto-retry a CANCELLED run", async () => {
    const source = await eligibleSource();
    const run = await prepare();
    await cancelRun(run.preparationRunId);

    await consumer.handle({ legalSourceVersionId: source.id });

    expect(
      await prisma.ruleSetPreparationRun.count({
        where: { legalSourceVersionId: source.id },
      }),
    ).toBe(1);
  });

  async function publishActiveRuleSet() {
    const source = await eligibleSource();
    const run = await prepare();
    await claim.execute(
      new ClaimRuleSetPreparationCommand(
        { preparationRunId: run.preparationRunId },
        randomUUID(),
      ),
    );
    const published = await submit.execute(
      new SubmitComplianceRuleSetCommand(
        await pinFixtureRequest(prisma, {
          preparationRunId: run.preparationRunId,
          idempotencyKey: `submit-${randomUUID()}`,
          packet: validPacket(),
        }),
        "test-worker",
        randomUUID(),
      ),
    );
    return { source, run, published };
  }
  const availability = () =>
    prisma.$transaction((tx) => loadRuleSetPreparationAvailability(tx));

  const replace = () =>
    manual.execute(
      new PrepareCurrentRuleSetCommand("owner-admin", randomUUID(), true),
    );
  const stateOf = async (ruleSetVersionId: string) =>
    (
      await prisma.complianceRuleSetVersion.findUniqueOrThrow({
        where: { id: ruleSetVersionId },
      })
    ).lifecycleState;
  const claimRun = (preparationRunId: string) =>
    claim.execute(
      new ClaimRuleSetPreparationCommand({ preparationRunId }, randomUUID()),
    );
  const submitFor = async (preparationRunId: string) =>
    submit.execute(
      new SubmitComplianceRuleSetCommand(
        await pinFixtureRequest(prisma, {
          preparationRunId,
          idempotencyKey: `submit-${randomUUID()}`,
          packet: validPacket(),
        }),
        "test-worker",
        randomUUID(),
      ),
    );

  describe("replacing the ACTIVE rule set from the same pinned Legal Source Version", () => {
    it("ordinary Prepare keeps refusing while a rule set is ACTIVE, but an explicit replacement is allowed", async () => {
      const { source, published } = await publishActiveRuleSet();

      expect(await availability()).toMatchObject({
        legalSourceVersionId: source.id,
        activeRuleSetVersionId: published.ruleSetVersionId,
        canStart: false,
        canReplace: true,
        refusalReason: "ACTIVE_RULE_SET_EXISTS",
      });
      await expect(prepare()).rejects.toMatchObject({ status: 409 });

      const replacement = await replace();
      expect(replacement).toMatchObject({
        legalSourceVersionId: source.id,
        executionState: AGENT_EXECUTION_STATES.QUEUED,
        ruleSetVersionId: null,
      });
      // A new attempt with its own run: the ACTIVE version is neither reused nor edited.
      expect(replacement.preparationRunId).not.toBe(published.preparationRunId);
      await expect(
        prisma.ruleSetPreparationRun.findUniqueOrThrow({
          where: { id: replacement.preparationRunId },
        }),
      ).resolves.toMatchObject({
        idempotencyKey: ruleSetPreparationIdempotencyKey(source.id, 2),
      });
    });

    it("keeps v1 ACTIVE while the replacement runs, and concurrent replacements share exactly one run", async () => {
      const { source, published } = await publishActiveRuleSet();

      const [one, two, three] = await Promise.all([
        replace(),
        replace(),
        replace(),
      ]);
      expect(two.preparationRunId).toBe(one.preparationRunId);
      expect(three.preparationRunId).toBe(one.preparationRunId);
      await claimRun(one.preparationRunId);

      expect(await replace()).toMatchObject({
        preparationRunId: one.preparationRunId,
        executionState: AGENT_EXECUTION_STATES.RUNNING,
      });
      expect(
        await prisma.ruleSetPreparationRun.count({
          where: { legalSourceVersionId: source.id },
        }),
      ).toBe(2);
      expect(await availability()).toMatchObject({
        canStart: false,
        canReplace: false,
        refusalReason: "PREPARATION_IN_PROGRESS",
        activeRuleSetVersionId: published.ruleSetVersionId,
      });
      expect(await stateOf(published.ruleSetVersionId)).toBe(
        ARTIFACT_LIFECYCLE_STATES.ACTIVE,
      );
    });

    it("a FAILED replacement leaves v1 ACTIVE and can be retried, which is not a new replacement", async () => {
      const { published } = await publishActiveRuleSet();
      const replacement = await replace();
      await claimRun(replacement.preparationRunId);
      await fail.execute(
        new FailRuleSetPreparationCommand(
          {
            preparationRunId: replacement.preparationRunId,
            reason: RULE_SET_PREPARATION_FAILURE_REASONS.NO_SUBMISSION,
          },
          randomUUID(),
        ),
      );

      expect(await stateOf(published.ruleSetVersionId)).toBe(
        ARTIFACT_LIFECYCLE_STATES.ACTIVE,
      );
      expect(await availability()).toMatchObject({
        canReplace: true,
        activeRuleSetVersionId: published.ruleSetVersionId,
      });
      const retried = await retry.execute(
        new RetryRuleSetPreparationCommand(
          replacement.preparationRunId,
          "owner-admin",
          randomUUID(),
        ),
      );
      expect(retried.preparationRunId).not.toBe(replacement.preparationRunId);
      expect(retried.executionState).toBe(AGENT_EXECUTION_STATES.QUEUED);
      expect(await stateOf(published.ruleSetVersionId)).toBe(
        ARTIFACT_LIFECYCLE_STATES.ACTIVE,
      );
    });

    it("a CANCELLED replacement leaves v1 ACTIVE and another replacement can follow", async () => {
      const { published } = await publishActiveRuleSet();
      const replacement = await replace();
      await claimRun(replacement.preparationRunId);

      await cancelRun(replacement.preparationRunId);

      expect(await stateOf(published.ruleSetVersionId)).toBe(
        ARTIFACT_LIFECYCLE_STATES.ACTIVE,
      );
      expect(
        (
          await prisma.ruleSetPreparationRun.findUniqueOrThrow({
            where: { id: replacement.preparationRunId },
          })
        ).executionState,
      ).toBe(AGENT_EXECUTION_STATES.CANCELLED);
      expect(await availability()).toMatchObject({ canReplace: true });
      const next = await replace();
      expect(next.preparationRunId).not.toBe(replacement.preparationRunId);
    });

    it("a SUCCEEDED replacement activates v2 and supersedes v1 atomically; assessments keep the version they pinned", async () => {
      const { source, published } = await publishActiveRuleSet();
      const owner = `replace-owner-${tag}`;
      await prisma.user.create({
        data: {
          id: owner,
          email: `${owner}@example.invalid`,
          passwordHash: "x",
          emailVerified: true,
          failedLoginCount: 0,
        },
      });
      const preparation = new AssessmentRuntimePreparation(
        null as never,
        null as never,
      );
      const createAssessment = async () => {
        const id = randomUUID();
        await prisma.$transaction(async (tx) => {
          await tx.assessment.create({
            data: { id, ownerId: owner, name: id },
          });
          await preparation.createCaseInTx(tx, id);
        });
        return (
          await prisma.assessmentCase.findUniqueOrThrow({
            where: { assessmentId: id },
          })
        ).ruleSetVersionId;
      };
      const pinnedToV1 = await createAssessment();
      const v1Digest = (
        await prisma.complianceRuleSetVersion.findUniqueOrThrow({
          where: { id: published.ruleSetVersionId },
        })
      ).ruleSetDigest;

      const replacement = await replace();
      await claimRun(replacement.preparationRunId);
      // Still v1 until the successor is validated AND submitted.
      expect(await createAssessment()).toBe(published.ruleSetVersionId);
      const successor = await submitFor(replacement.preparationRunId);

      expect(successor.previousActiveRuleSetVersionId).toBe(
        published.ruleSetVersionId,
      );
      expect(successor.version.endsWith(".p2")).toBe(true);
      expect(await stateOf(successor.ruleSetVersionId)).toBe(
        ARTIFACT_LIFECYCLE_STATES.ACTIVE,
      );
      const v1 = await prisma.complianceRuleSetVersion.findUniqueOrThrow({
        where: { id: published.ruleSetVersionId },
      });
      expect(v1.lifecycleState).toBe(ARTIFACT_LIFECYCLE_STATES.SUPERSEDED);
      expect(v1.ruleSetDigest).toBe(v1Digest); // superseded, not rewritten
      expect(
        await prisma.complianceRuleSetVersion.count({
          where: {
            legalSourceVersionId: source.id,
            lifecycleState: ARTIFACT_LIFECYCLE_STATES.ACTIVE,
          },
        }),
      ).toBe(1);
      // Historical assessments stay on v1; new ones pin v2.
      expect(pinnedToV1).toBe(published.ruleSetVersionId);
      expect(await createAssessment()).toBe(successor.ruleSetVersionId);
      expect(await availability()).toMatchObject({
        activeRuleSetVersionId: successor.ruleSetVersionId,
        canReplace: true,
      });
    });
  });

  it("an ACTIVE fixture without canonical activation cannot be selected", async () => {
    await sourceFactory();
    await expect(prepare()).rejects.toMatchObject({ status: 409 });
  });
});
import { LegalDocumentGraphService } from "../../../legal-source/application/services/legal-document-graph.service.js";
