import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  describe,
  expect,
  it,
  beforeAll,
  afterAll,
  beforeEach,
} from "@jest/globals";
import { randomUUID } from "node:crypto";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
} from "./support/auth-workspace-test-helpers.js";
import { BillingAccountingService } from "../src/modules/billing/application/services/billing-accounting.service.js";
import { PrismaBillingTransaction } from "../src/modules/billing/infrastructure/persistence/prisma-billing-transaction.js";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import { BillingPaymentService } from "../src/modules/billing/application/services/billing-payment.service.js";

describe("LCSP-310 billing persistence constraints", () => {
  let prisma: PrismaClient;
  let accounting: BillingAccountingService;
  let payments: BillingPaymentService;
  const user = (suffix: string) => ({
    id: `billing-${suffix}-${randomUUID()}`,
    email: `billing-${suffix}-${randomUUID()}@test.invalid`,
    passwordHash: "test",
    emailVerified: true,
    failedLoginCount: 0,
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    pushPrismaSchema();
    prisma = new PrismaClient({ adapter: new PrismaPg(TEST_DATABASE_URL) });
    await prisma.$connect();
    accounting = new BillingAccountingService(
      new PrismaBillingTransaction(new PrismaService()),
    );
    payments = new BillingPaymentService(
      new PrismaBillingTransaction(new PrismaService()),
      accounting,
    );
  });
  beforeEach(async () => {
    await prisma.llmUsageEvent.deleteMany();
    await prisma.billingReservation.deleteMany();
    await prisma.creditLedgerEntry.deleteMany();
    await prisma.paymentTransaction.deleteMany();
    await prisma.billingOrder.deleteMany();
    await prisma.sePayWebhookEvent.deleteMany();
    await prisma.billingWallet.deleteMany();
    await prisma.modelPricingSnapshot.deleteMany();
    await prisma.user.deleteMany({
      where: { email: { endsWith: "@test.invalid" } },
    });
  });
  afterAll(async () => prisma?.$disconnect());

  it("enforces wallet ownership and one wallet per user", async () => {
    const a = user("a");
    await prisma.user.create({ data: a });
    await prisma.billingWallet.create({ data: { userId: a.id } });
    await expect(
      prisma.billingWallet.create({ data: { userId: a.id } }),
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      prisma.billingWallet.create({ data: { userId: "missing" } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("enforces global payment codes and user-scoped order idempotency", async () => {
    const a = user("a");
    const b = user("b");
    await prisma.user.createMany({ data: [a, b] });
    const base = {
      paymentCode: "CODE123",
      amountMinorUnits: 100000n,
      creditUnits: 1000n,
    };
    await prisma.billingOrder.create({
      data: { ...base, userId: a.id, idempotencyKey: "KEY1" },
    });
    await expect(
      prisma.billingOrder.create({
        data: { ...base, userId: a.id, idempotencyKey: "KEY1" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    await prisma.billingOrder.create({
      data: {
        ...base,
        userId: b.id,
        paymentCode: "CODE124",
        idempotencyKey: "KEY1",
      },
    });
    await expect(
      prisma.billingOrder.create({
        data: {
          ...base,
          userId: b.id,
          paymentCode: "CODE123",
          idempotencyKey: "KEY2",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("enforces global ledger and payment identities", async () => {
    const a = user("a");
    const b = user("b");
    await prisma.user.createMany({ data: [a, b] });
    const wa = await prisma.billingWallet.create({ data: { userId: a.id } });
    const wb = await prisma.billingWallet.create({ data: { userId: b.id } });
    const entry = {
      source: "TEST",
      deltaCredits: 10n,
      idempotencyKey: "LEDGER-1",
    };
    await prisma.creditLedgerEntry.create({
      data: { ...entry, userId: a.id, walletId: wa.id },
    });
    await expect(
      prisma.creditLedgerEntry.create({
        data: { ...entry, userId: b.id, walletId: wb.id },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    await prisma.paymentTransaction.create({
      data: {
        provider: "SEPAY",
        providerTransactionId: "TX-1",
        amountMinorUnits: 1n,
      },
    });
    await expect(
      prisma.paymentTransaction.create({
        data: {
          provider: "SEPAY",
          providerTransactionId: "TX-1",
          amountMinorUnits: 1n,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("binds ledger idempotency replay to the full semantic request", async () => {
    const a = user("ledger-a");
    const b = user("ledger-b");
    await prisma.user.createMany({ data: [a, b] });
    const wa = await accounting.getOrCreateWallet(a.id);
    const wb = await accounting.getOrCreateWallet(b.id);
    const base = {
      idempotencyKey: "LEDGER-SEMANTIC",
      deltaCredits: 500n,
      source: "TEST_SOURCE",
      referenceId: "REF-1",
    };
    const first = await accounting.appendLedger({
      ...base,
      userId: a.id,
      walletId: wa.id,
    });
    await expect(
      accounting.appendLedger({ ...base, userId: b.id, walletId: wb.id }),
    ).rejects.toThrow();
    await expect(
      accounting.appendLedger({
        ...base,
        userId: a.id,
        walletId: wa.id,
        source: "OTHER_SOURCE",
        idempotencyKey: "LEDGER-SEMANTIC",
      }),
    ).rejects.toThrow();
    await expect(
      accounting.appendLedger({
        ...base,
        userId: a.id,
        walletId: wa.id,
        referenceId: "REF-2",
      }),
    ).rejects.toThrow();
    expect(
      await accounting.appendLedger({
        ...base,
        userId: a.id,
        walletId: wa.id,
      }),
    ).toMatchObject({ id: first.id });
    expect(
      await prisma.creditLedgerEntry.count({
        where: { idempotencyKey: base.idempotencyKey },
      }),
    ).toBe(1);
    expect(
      (await prisma.billingWallet.findUniqueOrThrow({ where: { id: wb.id } }))
        .availableCredits,
    ).toBe(0n);
  });

  it("allows unmatched payments and nullable response IDs, while preserving pricing references", async () => {
    const a = user("a");
    await prisma.user.create({ data: a });
    const v1 = await prisma.modelPricingSnapshot.create({
      data: {
        provider: "openai",
        model: "m",
        version: 1,
        effectiveAt: new Date(),
        inputPricePerMillion: "1.00000000",
        outputPricePerMillion: "2.00000000",
      },
    });
    const v2 = await prisma.modelPricingSnapshot.create({
      data: {
        provider: "openai",
        model: "m",
        version: 2,
        effectiveAt: new Date(),
        inputPricePerMillion: "3.00000000",
        outputPricePerMillion: "4.00000000",
      },
    });
    const usage = await prisma.llmUsageEvent.create({
      data: {
        userId: a.id,
        provider: "openai",
        model: "m",
        invocationId: "inv-1",
        pricingSnapshotId: v1.id,
      },
    });
    expect(usage.pricingSnapshotId).toBe(v1.id);
    expect(v2.id).not.toBe(v1.id);
    await prisma.llmUsageEvent.create({
      data: {
        userId: a.id,
        provider: "openai",
        model: "m",
        invocationId: "inv-2",
      },
    });
    await prisma.paymentTransaction.create({
      data: {
        provider: "SEPAY",
        providerTransactionId: "TX-U",
        amountMinorUnits: 10n,
      },
    });
    await prisma.sePayWebhookEvent.create({
      data: { provider: "SEPAY", providerTransactionId: "WEBHOOK-TX-1" },
    });
    await expect(
      prisma.sePayWebhookEvent.create({
        data: { provider: "SEPAY", providerTransactionId: "WEBHOOK-TX-1" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    await prisma.llmUsageEvent.create({
      data: {
        userId: a.id,
        provider: "openai",
        model: "m",
        invocationId: "inv-3",
        providerResponseId: null,
      },
    });
    await prisma.llmUsageEvent.create({
      data: {
        userId: a.id,
        provider: "openai",
        model: "m",
        invocationId: "inv-4",
        providerResponseId: null,
      },
    });
  });

  it("requires ownership foreign keys and persists reservation lifecycle values", async () => {
    const a = user("a");
    await prisma.user.create({ data: a });
    const wallet = await prisma.billingWallet.create({
      data: { userId: a.id },
    });
    await expect(
      prisma.billingOrder.create({
        data: {
          userId: "missing",
          paymentCode: "FK-1",
          idempotencyKey: "fk",
          amountMinorUnits: 1n,
          creditUnits: 1n,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      prisma.creditLedgerEntry.create({
        data: {
          userId: "missing",
          walletId: wallet.id,
          idempotencyKey: "FK-LEDGER",
          source: "TEST",
          deltaCredits: 1n,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      prisma.billingReservation.create({
        data: { userId: "missing", walletId: wallet.id, amountCredits: 1n },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      prisma.llmUsageEvent.create({
        data: {
          userId: "missing",
          provider: "openai",
          model: "m",
          invocationId: "fk-usage",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    const reservation = await prisma.billingReservation.create({
      data: {
        userId: a.id,
        walletId: wallet.id,
        amountCredits: 10n,
        status: "RESERVED",
      },
    });
    expect(reservation.status).toBe("RESERVED");
  });

  it("prevents concurrent overspend with user-scoped transaction locking", async () => {
    const a = user("concurrent");
    await prisma.user.create({ data: a });
    const wallet = await accounting.getOrCreateWallet(a.id);
    await accounting.appendLedger({
      userId: a.id,
      walletId: wallet.id,
      deltaCredits: 100n,
      idempotencyKey: "seed-balance",
      source: "TEST",
    });
    const results = await Promise.allSettled([
      accounting.reserveCredits({
        userId: a.id,
        amountCredits: 80n,
        idempotencyKey: "reserve-a",
      }),
      accounting.reserveCredits({
        userId: a.id,
        amountCredits: 80n,
        idempotencyKey: "reserve-b",
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const finalWallet = await prisma.billingWallet.findUniqueOrThrow({
      where: { userId: a.id },
    });
    expect(finalWallet.availableCredits).toBe(20n);
    expect(finalWallet.reservedCredits).toBe(80n);
  });

  it("reconciles matched, unmatched, mismatch, and terminal-order payments atomically", async () => {
    const a = user("pay");
    await prisma.user.create({ data: a });
    await accounting.getOrCreateWallet(a.id);
    const order = await payments.createOrder({
      userId: a.id,
      paymentCode: "PAY123",
      idempotencyKey: "order-1",
      amountMinorUnits: 100000n,
      creditUnits: 500n,
    });
    const matched = await payments.reconcilePayment({
      provider: "SEPAY",
      providerTransactionId: "TX1",
      paymentCode: "PAY123",
      amountMinorUnits: 100000n,
    });
    expect(matched.reconciliationStatus).toBe("MATCHED");
    expect(
      (await prisma.billingOrder.findUniqueOrThrow({ where: { id: order.id } }))
        .status,
    ).toBe("CREDITED");
    expect(
      await prisma.creditLedgerEntry.count({
        where: { billingOrderId: order.id },
      }),
    ).toBe(1);
    const duplicate = await payments.reconcilePayment({
      provider: "SEPAY",
      providerTransactionId: "TX2",
      paymentCode: "PAY123",
      amountMinorUnits: 100000n,
    });
    expect(duplicate.reconciliationStatus).toBe("DUPLICATE");
    const unknown = await payments.reconcilePayment({
      provider: "SEPAY",
      providerTransactionId: "TX3",
      paymentCode: "UNKNOWN",
      amountMinorUnits: 1n,
    });
    expect(unknown.reconciliationStatus).toBe("UNMATCHED");
    expect(unknown.userId).toBeNull();
    const late = await payments.createOrder({
      userId: a.id,
      paymentCode: "PAY124",
      idempotencyKey: "order-2",
      amountMinorUnits: 10n,
      creditUnits: 1n,
    });
    await prisma.billingOrder.update({
      where: { id: late.id },
      data: { status: "EXPIRED" },
    });
    const review = await payments.reconcilePayment({
      provider: "SEPAY",
      providerTransactionId: "TX4",
      paymentCode: "PAY124",
      amountMinorUnits: 10n,
    });
    expect(review.reconciliationStatus).toBe("NEEDS_REVIEW");
  });

  it("settles and releases reservations exactly once", async () => {
    const a = user("lifecycle");
    await prisma.user.create({ data: a });
    const wallet = await accounting.getOrCreateWallet(a.id);
    await accounting.appendLedger({
      userId: a.id,
      walletId: wallet.id,
      deltaCredits: 100n,
      idempotencyKey: "life-seed",
      source: "TEST",
    });
    const settled = await accounting.reserveCredits({
      userId: a.id,
      amountCredits: 100n,
      idempotencyKey: "life-settle",
    });
    const settleResults = await Promise.allSettled([
      accounting.settleReservation({
        userId: a.id,
        reservationId: settled.id,
        chargedCredits: 63n,
      }),
      accounting.settleReservation({
        userId: a.id,
        reservationId: settled.id,
        chargedCredits: 63n,
      }),
    ]);
    expect(
      settleResults.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const release = await accounting.reserveCredits({
      userId: a.id,
      amountCredits: 10n,
      idempotencyKey: "life-release",
    });
    const releaseResults = await Promise.allSettled([
      accounting.releaseReservation({
        userId: a.id,
        reservationId: release.id,
      }),
      accounting.releaseReservation({
        userId: a.id,
        reservationId: release.id,
      }),
    ]);
    expect(
      releaseResults.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const finalWallet = await prisma.billingWallet.findUniqueOrThrow({
      where: { userId: a.id },
    });
    expect(finalWallet.availableCredits).toBe(37n);
    expect(finalWallet.reservedCredits).toBe(0n);
    expect(
      await prisma.creditLedgerEntry.count({ where: { userId: a.id } }),
    ).toBe(2);
    const race = await accounting.reserveCredits({
      userId: a.id,
      amountCredits: 10n,
      idempotencyKey: "life-race",
    });
    await Promise.allSettled([
      accounting.settleReservation({
        userId: a.id,
        reservationId: race.id,
        chargedCredits: 4n,
      }),
      accounting.releaseReservation({ userId: a.id, reservationId: race.id }),
    ]);
    const raceRow = await prisma.billingReservation.findUniqueOrThrow({
      where: { id: race.id },
    });
    expect(["SETTLED", "RELEASED"]).toContain(raceRow.status);
    expect(
      (await prisma.creditLedgerEntry.count({
        where: { referenceId: race.id },
      })) <= 1,
    ).toBe(true);
  });
});
