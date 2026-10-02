import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";
import { randomUUID } from "node:crypto";
import { LLM_USAGE_STATUSES } from "@lcsp/contracts/billing";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
} from "./support/auth-workspace-test-helpers.js";
import { BillingUsageKernel } from "../src/modules/billing/application/shared/billing-usage.kernel.js";
import { PrismaBillingTransaction } from "../src/modules/billing/infrastructure/persistence/prisma-billing-transaction.js";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import { BillingIdempotencyConflictError } from "../src/modules/billing/domain/billing.errors.js";

describe("LLM usage recording is telemetry only", () => {
  let prisma: PrismaClient;
  let kernel: BillingUsageKernel;
  const suffix = randomUUID();
  const userId = `usage-${suffix}`;
  const assessmentId = `usage-assessment-${suffix}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    pushPrismaSchema();
    prisma = new PrismaClient({ adapter: new PrismaPg(TEST_DATABASE_URL) });
    await prisma.$connect();
    kernel = new BillingUsageKernel(
      new PrismaBillingTransaction(new PrismaService()),
    );
  }, 30_000);

  beforeEach(async () => {
    await prisma.llmUsageEvent.deleteMany();
    await prisma.assessment.deleteMany({ where: { id: assessmentId } });
    await prisma.creditLedgerEntry.deleteMany();
    await prisma.billingReservation.deleteMany();
    await prisma.billingWallet.deleteMany();
    await prisma.modelPricingSnapshot.deleteMany();
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.user.create({
      data: {
        id: userId,
        email: `${suffix}@usage.test`,
        passwordHash: "test",
        emailVerified: true,
        failedLoginCount: 0,
      },
    });
    await prisma.assessment.create({
      data: { id: assessmentId, ownerId: userId, name: "Usage" },
    });
  });

  afterAll(async () => prisma?.$disconnect());

  const report = (overrides = {}) => ({
    userId,
    assessmentId,
    runId: "run-1",
    invocationId: "inv-1",
    agentRole: "root",
    provider: "LLM7",
    model: "brand-new-model-never-priced",
    effectiveRuntimeModel: {
      provider: "LLM7",
      model: "brand-new-model-never-priced",
      policyVersion: "cfg-feedfacefeedface",
      effectiveAt: "1970-01-01T00:00:00.000Z",
    },
    inputTokens: 1200n,
    outputTokens: 80n,
    occurredAt: new Date("2026-10-01T00:00:00.000Z"),
    ...overrides,
  });

  it("stores provider tokens with no pricing row, no wallet and no reservation", async () => {
    expect(await prisma.modelPricingSnapshot.count()).toBe(0);
    expect(await prisma.billingWallet.count()).toBe(0);

    await kernel.recordUsage(report());

    const row = await prisma.llmUsageEvent.findFirstOrThrow({
      where: { invocationId: "inv-1" },
    });
    expect(row).toMatchObject({
      status: LLM_USAGE_STATUSES.SETTLED,
      inputTokens: 1200n,
      outputTokens: 80n,
      cachedInputTokens: null,
      reasoningTokens: null,
      pricingSnapshotId: null,
      providerCostCredits: null,
      customerChargeVnd: null,
      chargedCredits: null,
      reservationId: null,
    });
    expect(row.runtimePolicySnapshotId).not.toBeNull();
    // No wallet is created and nothing is ever written to the ledger.
    expect(await prisma.billingWallet.count()).toBe(0);
    expect(await prisma.creditLedgerEntry.count()).toBe(0);
  });

  it("does not debit a zero-balance wallet", async () => {
    const wallet = await prisma.billingWallet.create({ data: { userId } });

    await kernel.recordUsage(report());

    const after = await prisma.billingWallet.findUniqueOrThrow({
      where: { id: wallet.id },
    });
    expect(after).toMatchObject({
      availableCredits: 0n,
      reservedCredits: 0n,
      version: wallet.version,
    });
    expect(await prisma.creditLedgerEntry.count()).toBe(0);
  });

  it("replays idempotently and rejects a differing replay", async () => {
    const first = await kernel.recordUsage(report());
    const replay = await kernel.recordUsage(report());
    expect((replay as { id: string }).id).toBe((first as { id: string }).id);
    expect(await prisma.llmUsageEvent.count()).toBe(1);
    await expect(
      kernel.recordUsage(report({ inputTokens: 1201n })),
    ).rejects.toBeInstanceOf(BillingIdempotencyConflictError);
  });
});
