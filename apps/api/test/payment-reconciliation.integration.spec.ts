import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  expect,
  it,
} from "@jest/globals";
import { randomUUID } from "node:crypto";
import { BillingAccountingService } from "../src/modules/billing/application/services/billing-accounting.service.js";
import { BillingPaymentService } from "../src/modules/billing/application/services/billing-payment.service.js";
import { PrismaBillingTransaction } from "../src/modules/billing/infrastructure/persistence/prisma-billing-transaction.js";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
} from "./support/auth-workspace-test-helpers.js";

describe("LCSP-310 payment reconciliation", () => {
  let prisma: PrismaClient;
  let payments: BillingPaymentService;
  let accounting: BillingAccountingService;
  const user = (name: string) => ({
    id: `payment-${name}-${randomUUID()}`,
    email: `payment-${name}-${randomUUID()}@test.invalid`,
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
    await prisma.user.deleteMany({
      where: { email: { endsWith: "@test.invalid" } },
    });
  });
  afterAll(async () => prisma?.$disconnect());

  async function setupOrder(
    status: "PENDING_PAYMENT" | "EXPIRED" | "CANCELLED" = "PENDING_PAYMENT",
  ) {
    const a = user("owner");
    await prisma.user.create({ data: a });
    const wallet = await accounting.getOrCreateWallet(a.id);
    const order = await payments.createOrder({
      userId: a.id,
      paymentCode: `PAY-${randomUUID()}`,
      idempotencyKey: randomUUID(),
      amountMinorUnits: 100000n,
      creditUnits: 500n,
    });
    if (status !== "PENDING_PAYMENT")
      await prisma.billingOrder.update({
        where: { id: order.id },
        data: { status },
      });
    return { a, wallet, order };
  }

  it("credits a matched payment exactly once", async () => {
    const { a, order } = await setupOrder();
    const result = await payments.reconcilePayment({
      provider: "SEPAY",
      providerTransactionId: "TX-MATCH",
      paymentCode: order.paymentCode,
      amountMinorUnits: 100000n,
    });
    expect(result.reconciliationStatus).toBe("MATCHED");
    expect(
      await prisma.creditLedgerEntry.count({
        where: { billingOrderId: order.id },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.billingWallet.findUniqueOrThrow({
          where: { userId: a.id },
        })
      ).availableCredits,
    ).toBe(500n);
  });

  it("derives order idempotency from immutable request fields", async () => {
    const a = user("idempotency");
    await prisma.user.create({ data: a });
    const base = {
      userId: a.id,
      paymentCode: "PAY-IDEMPOTENT",
      idempotencyKey: "KEY-IDEMPOTENT",
      amountMinorUnits: 100000n,
      creditUnits: 500n,
    };
    const first = await payments.createOrder(base);
    expect((await payments.createOrder(base)).id).toBe(first.id);
    await expect(
      payments.createOrder({ ...base, amountMinorUnits: 200000n }),
    ).rejects.toThrow();
    await expect(
      payments.createOrder({ ...base, creditUnits: 1000n }),
    ).rejects.toThrow();
    await expect(
      payments.createOrder({ ...base, paymentCode: "PAY-IDEMPOTENT-2" }),
    ).rejects.toThrow();
    const other = user("idempotency-other");
    await prisma.user.create({ data: other });
    await expect(
      payments.createOrder({
        ...base,
        userId: other.id,
        paymentCode: "PAY-IDEMPOTENT-OTHER",
      }),
    ).resolves.toMatchObject({ userId: other.id });
  });

  it("serializes duplicate deliveries of one provider transaction", async () => {
    const { a, order } = await setupOrder();
    await Promise.allSettled(
      [1, 2].map(() =>
        payments.reconcilePayment({
          provider: "SEPAY",
          providerTransactionId: "TX-SAME",
          paymentCode: order.paymentCode,
          amountMinorUnits: 100000n,
        }),
      ),
    );
    expect(
      await prisma.paymentTransaction.count({
        where: { provider: "SEPAY", providerTransactionId: "TX-SAME" },
      }),
    ).toBe(1);
    expect(
      await prisma.sePayWebhookEvent.count({
        where: { provider: "SEPAY", providerTransactionId: "TX-SAME" },
      }),
    ).toBe(1);
    expect(
      await prisma.creditLedgerEntry.count({
        where: { billingOrderId: order.id },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.billingWallet.findUniqueOrThrow({
          where: { userId: a.id },
        })
      ).availableCredits,
    ).toBe(500n);
  });

  it("keeps a second real payment durable without double crediting", async () => {
    const { order } = await setupOrder();
    await Promise.allSettled(
      ["TX-A", "TX-B"].map((providerTransactionId) =>
        payments.reconcilePayment({
          provider: "SEPAY",
          providerTransactionId,
          paymentCode: order.paymentCode,
          amountMinorUnits: 100000n,
        }),
      ),
    );
    const rows = await prisma.paymentTransaction.findMany({
      where: { billingOrderId: order.id },
    });
    expect(rows).toHaveLength(2);
    expect(
      rows.filter((x) => x.reconciliationStatus === "MATCHED"),
    ).toHaveLength(1);
    expect(
      rows.filter((x) => x.reconciliationStatus === "DUPLICATE"),
    ).toHaveLength(1);
    expect(
      await prisma.creditLedgerEntry.count({
        where: { billingOrderId: order.id },
      }),
    ).toBe(1);
  });

  it("prevents a match-vs-mismatch race from creating orphan credit", async () => {
    const { a, order } = await setupOrder();
    await Promise.allSettled([
      payments.reconcilePayment({
        provider: "SEPAY",
        providerTransactionId: "TX-MATCH-RACE",
        paymentCode: order.paymentCode,
        amountMinorUnits: 100000n,
      }),
      payments.reconcilePayment({
        provider: "SEPAY",
        providerTransactionId: "TX-MISMATCH-RACE",
        paymentCode: order.paymentCode,
        amountMinorUnits: 90000n,
      }),
    ]);
    const persisted = await prisma.billingOrder.findUniqueOrThrow({
      where: { id: order.id },
    });
    const credits = await prisma.creditLedgerEntry.count({
      where: { billingOrderId: order.id },
    });
    expect(credits === 0 || credits === 1).toBe(true);
    if (persisted.status === "CREDITED") expect(credits).toBe(1);
    else expect(credits).toBe(0);
    if (persisted.status === "CREDITED")
      expect(
        (
          await prisma.billingWallet.findUniqueOrThrow({
            where: { userId: a.id },
          })
        ).availableCredits,
      ).toBe(500n);
  });

  it("does not credit late payments for expired or cancelled orders", async () => {
    for (const status of ["EXPIRED", "CANCELLED"] as const) {
      const { order } = await setupOrder(status);
      const result = await payments.reconcilePayment({
        provider: "SEPAY",
        providerTransactionId: `TX-${status}`,
        paymentCode: order.paymentCode,
        amountMinorUnits: 100000n,
      });
      expect(result.reconciliationStatus).toBe("NEEDS_REVIEW");
      expect(
        await prisma.creditLedgerEntry.count({
          where: { billingOrderId: order.id },
        }),
      ).toBe(0);
    }
  });

  it("keeps payment credit and reservation projections canonical when concurrent", async () => {
    const { a, wallet, order } = await setupOrder();
    await accounting.appendLedger({
      userId: a.id,
      walletId: wallet.id,
      deltaCredits: 100n,
      idempotencyKey: "seed-race",
      source: "TEST",
    });
    await Promise.allSettled([
      payments.reconcilePayment({
        provider: "SEPAY",
        providerTransactionId: "TX-RACE",
        paymentCode: order.paymentCode,
        amountMinorUnits: 100000n,
      }),
      accounting.reserveCredits({
        userId: a.id,
        amountCredits: 150n,
        idempotencyKey: "reserve-race",
      }),
    ]);
    const w = await prisma.billingWallet.findUniqueOrThrow({
      where: { userId: a.id },
    });
    const entries = await prisma.creditLedgerEntry.findMany({
      where: { walletId: w.id },
    });
    const reservations = await prisma.billingReservation.findMany({
      where: { walletId: w.id, status: "RESERVED" },
    });
    const ledger = entries.reduce((sum, entry) => sum + entry.deltaCredits, 0n);
    const reserved = reservations.reduce(
      (sum, item) => sum + item.amountCredits,
      0n,
    );
    expect(w.availableCredits).toBe(ledger - reserved);
    expect(w.reservedCredits).toBe(reserved);
    expect(w.availableCredits >= 0n).toBe(true);
  });
});
