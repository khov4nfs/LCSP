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
} from "@lcsp/contracts/compliance-rule-set";
import { AGENT_EXECUTION_STATES } from "@lcsp/contracts/assessment";
import type { CommandBus } from "@nestjs/cqrs";

import { legalSourceFactory } from "../../../../../test/support/compliance-rule-set-fixtures.js";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
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
  let retry: RetryRuleSetPreparationHandler;
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
    claim = new ClaimRuleSetPreparationHandler(service);
    fail = new FailRuleSetPreparationHandler(service);
  });
  beforeEach(async () => {
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
    expect(await prisma.complianceRuleSetVersion.count()).toBe(0);
    expect(await prisma.legalRequirement.count()).toBe(0);
    expect(await prisma.assessmentRule.count()).toBe(0);
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
