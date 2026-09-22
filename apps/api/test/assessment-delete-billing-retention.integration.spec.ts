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

import { BILLING_RESERVATION_STATUSES } from "@lcsp/contracts/billing";
import { BillingAccountingKernel } from "../src/modules/billing/application/shared/billing-accounting.kernel.js";
import { PrismaBillingTransaction } from "../src/modules/billing/infrastructure/persistence/prisma-billing-transaction.js";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import { PrismaAssessmentBillingRetention } from "../src/modules/assessment/infrastructure/billing/prisma-assessment-billing-retention.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
} from "./support/auth-workspace-test-helpers.js";

describe("assessment delete billing retention", () => {
  let prisma: PrismaClient;
  let billingPrisma: PrismaService;
  let accounting: BillingAccountingKernel;
  let retention: PrismaAssessmentBillingRetention;
  const id = () => randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    pushPrismaSchema();
    prisma = new PrismaClient({ adapter: new PrismaPg(TEST_DATABASE_URL) });
    await prisma.$connect();
    billingPrisma = new PrismaService();
    accounting = new BillingAccountingKernel(
      new PrismaBillingTransaction(billingPrisma),
    );
    retention = new PrismaAssessmentBillingRetention(billingPrisma, accounting);
  }, 30_000);

  beforeEach(async () => {
    await prisma.llmUsageEvent.deleteMany();
    await prisma.billingReservation.deleteMany();
    await prisma.creditLedgerEntry.deleteMany();
    await prisma.assessment.deleteMany();
    await prisma.billingWallet.deleteMany();
    await prisma.user.deleteMany({
      where: { email: { endsWith: "@retention.test" } },
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await billingPrisma?.$disconnect();
  });

  async function fixture() {
    const user = {
      id: `retention-${id()}`,
      email: `${id()}@retention.test`,
      passwordHash: "test",
      emailVerified: true,
      failedLoginCount: 0,
    };
    await prisma.user.create({ data: user });
    const wallet = await accounting.getOrCreateWallet(user.id);
    await accounting.appendLedger({
      userId: user.id,
      walletId: wallet.id,
      deltaCredits: 500n,
      idempotencyKey: `retention-seed-${id()}`,
      source: "TEST",
    });
    const assessmentId = `assessment-${id()}`;
    await prisma.assessment.create({
      data: { id: assessmentId, ownerId: user.id, name: "Deletable" },
    });
    const reservation = await accounting.reserveCredits({
      userId: user.id,
      assessmentId,
      runId: `run-${id()}`,
      amountCredits: 100n,
      idempotencyKey: `retention-reserve-${id()}`,
    });
    return { user, wallet, assessmentId, reservation };
  }

  it("returns credit held by an active reservation before the assessment is deleted", async () => {
    const f = await fixture();

    const released = await retention.releaseActiveReservations({
      assessmentId: f.assessmentId,
      userId: f.user.id,
    });

    expect(released).toEqual([f.reservation.id]);
    expect(
      await prisma.billingReservation.findUniqueOrThrow({
        where: { id: f.reservation.id },
      }),
    ).toMatchObject({
      status: BILLING_RESERVATION_STATUSES.RELEASED,
      remainingCredits: 0n,
    });
    expect(
      await prisma.billingWallet.findUniqueOrThrow({
        where: { id: f.wallet.id },
      }),
    ).toMatchObject({ availableCredits: 500n, reservedCredits: 0n });
  });

  it("keeps the billing record and lets the assessment be deleted", async () => {
    const f = await fixture();
    await retention.releaseActiveReservations({
      assessmentId: f.assessmentId,
      userId: f.user.id,
    });

    await billingPrisma.$transaction(async (tx) => {
      await retention.detachAssessment(f.assessmentId, tx);
      await tx.assessment.delete({ where: { id: f.assessmentId } });
    });

    expect(
      await prisma.assessment.findUnique({ where: { id: f.assessmentId } }),
    ).toBeNull();
    const retained = await prisma.billingReservation.findUniqueOrThrow({
      where: { id: f.reservation.id },
    });
    expect(retained).toMatchObject({
      assessmentId: null,
      amountCredits: 100n,
      status: BILLING_RESERVATION_STATUSES.RELEASED,
    });
  });

  it("refuses to delete the assessment while a billing record still points at it", async () => {
    const f = await fixture();

    await expect(
      prisma.assessment.delete({ where: { id: f.assessmentId } }),
    ).rejects.toThrow();

    expect(
      await prisma.assessment.findUnique({ where: { id: f.assessmentId } }),
    ).not.toBeNull();
  });
});
