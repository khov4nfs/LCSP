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
import { AUDIT_ACTOR_TYPES } from "@lcsp/contracts/audit";
import { BILLING_AUDIT_EVENT_TYPES } from "@lcsp/contracts/billing";
import { BillingAccountingKernel } from "../src/modules/billing/application/shared/billing-accounting.kernel.js";
import { BillingPaymentKernel } from "../src/modules/billing/application/shared/billing-payment.kernel.js";
import { ResolveBillingPaymentHandler } from "../src/modules/billing/application/commands/resolve-billing-payment/resolve-billing-payment.handler.js";
import { ResolveBillingPaymentCommand } from "../src/modules/billing/application/commands/resolve-billing-payment/resolve-billing-payment.command.js";
import { PrismaBillingTransaction } from "../src/modules/billing/infrastructure/persistence/prisma-billing-transaction.js";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
} from "./support/auth-workspace-test-helpers.js";

describe("LCSP-310 payment reconciliation", () => {
  let prisma: PrismaClient;
  let payments: BillingPaymentKernel;
  let accounting: BillingAccountingKernel;
  let admin: ResolveBillingPaymentHandler;
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
    accounting = new BillingAccountingKernel(
      new PrismaBillingTransaction(new PrismaService()),
    );
    payments = new BillingPaymentKernel(
      new PrismaBillingTransaction(new PrismaService()),
      accounting,
    );
    admin = new ResolveBillingPaymentHandler(
      new PrismaService(),
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
    expiresAt?: Date,
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
      expiresAt,
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
    expect(result.reconciledAt).not.toBeNull();
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: {
        eventType: BILLING_AUDIT_EVENT_TYPES.reconciliationSettled,
        resourceId: result.id,
      },
    });
    expect(audit).toMatchObject({
      actorId: null,
      correlationId: "billing-reconcile:SEPAY:TX-MATCH",
    });
    expect(audit.payload).toMatchObject({
      actor: { id: null, type: AUDIT_ACTOR_TYPES.system },
      providerTransactionId: "TX-MATCH",
      billingOrderId: order.id,
      userId: a.id,
      afterPaymentStatus: "MATCHED",
      afterOrderStatus: "CREDITED",
    });
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

  it("expires an unread pending order at the settlement boundary", async () => {
    const { order } = await setupOrder(
      "PENDING_PAYMENT",
      new Date(Date.now() - 1_000),
    );
    const result = await payments.reconcilePayment({
      provider: "SEPAY",
      providerTransactionId: "TX-EXPIRED-UNREAD",
      paymentCode: order.paymentCode,
      amountMinorUnits: 100000n,
      correlationId: "corr-expired-settlement",
    });
    expect(result.reconciliationStatus).toBe("NEEDS_REVIEW");
    expect(
      (await prisma.billingOrder.findUniqueOrThrow({ where: { id: order.id } }))
        .status,
    ).toBe("EXPIRED");
    expect(
      await prisma.creditLedgerEntry.count({
        where: { billingOrderId: order.id },
      }),
    ).toBe(0);
    expect(
      await prisma.auditEvent.findMany({
        where: {
          eventType: BILLING_AUDIT_EVENT_TYPES.orderExpired,
          resourceId: order.id,
        },
        select: { actorId: true, correlationId: true },
      }),
    ).toEqual([{ actorId: null, correlationId: "corr-expired-settlement" }]);
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

  it("allows an Admin to resolve an unmatched exact payment into the selected order owner", async () => {
    const { a, order } = await setupOrder();
    const payment = await payments.reconcilePayment({
      provider: "SEPAY",
      providerTransactionId: "TX-MANUAL-EXACT",
      paymentCode: "UNKNOWN-MANUAL",
      amountMinorUnits: 100000n,
      transferDirection: "IN",
    });

    const resolved = await admin.execute(
      new ResolveBillingPaymentCommand({
        paymentId: payment.id,
        billingOrderId: order.id,
        expectedVersion: 0,
        rationale: "Verified bank statement and customer order ownership",
        actorId: "admin-1",
        correlationId: "corr-manual-exact",
      }),
    );

    expect(resolved.status).toBe("MATCHED");
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

  it("replays an accepted reconciliation work item without a second financial effect", async () => {
    const { order } = await setupOrder();
    const event = await prisma.sePayWebhookEvent.create({
      data: {
        provider: "SEPAY",
        providerTransactionId: "TX-ACCEPTED-REPLAY",
        securityAcceptedAt: new Date(),
        sanitizedPayload: {
          providerTransactionId: "TX-ACCEPTED-REPLAY",
          paymentCode: order.paymentCode,
          amountMinorUnits: "100000",
          transferDirection: "IN",
        },
      },
    });

    const first = await payments.reconcileAcceptedWebhook(event.id);
    const second = await payments.reconcileAcceptedWebhook(event.id);

    expect(first?.reconciliationStatus).toBe("MATCHED");
    expect(second?.reconciliationStatus).toBe("MATCHED");
    expect(
      await prisma.creditLedgerEntry.count({
        where: { billingOrderId: order.id },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.sePayWebhookEvent.findUniqueOrThrow({
          where: { id: event.id },
        })
      ).processedAt,
    ).not.toBeNull();
  });

  it("rejects a stale concurrent Admin decision and never double credits", async () => {
    const { order } = await setupOrder();
    const payment = await payments.reconcilePayment({
      provider: "SEPAY",
      providerTransactionId: "TX-MANUAL-RACE",
      paymentCode: "UNKNOWN-MANUAL-RACE",
      amountMinorUnits: 100000n,
      transferDirection: "IN",
    });
    const results = await Promise.allSettled(
      ["admin-a", "admin-b"].map((actorId) =>
        admin.execute(
          new ResolveBillingPaymentCommand({
            paymentId: payment.id,
            billingOrderId: order.id,
            expectedVersion: 0,
            rationale: "Verified ownership before manual resolution",
            actorId,
            correlationId: `corr-${actorId}`,
          }),
        ),
      ),
    );

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(
      await prisma.creditLedgerEntry.count({
        where: { billingOrderId: order.id },
      }),
    ).toBe(1);
  });

  it("cannot resolve a payment into another user's order", async () => {
    const { order } = await setupOrder();
    const other = await setupOrder();
    const payment = await payments.reconcilePayment({
      provider: "SEPAY",
      providerTransactionId: "TX-MANUAL-CROSS-ACCOUNT",
      paymentCode: order.paymentCode,
      amountMinorUnits: 90000n,
      transferDirection: "IN",
    });

    await expect(
      admin.execute(
        new ResolveBillingPaymentCommand({
          paymentId: payment.id,
          billingOrderId: other.order.id,
          expectedVersion: 0,
          rationale: "Attempted cross-account reassignment",
          actorId: "admin-unsafe",
          correlationId: "corr-cross-account",
        }),
      ),
    ).rejects.toThrow("BILLING_RECONCILIATION_OWNERSHIP_CONFLICT");
    expect(
      await prisma.creditLedgerEntry.count({
        where: { billingOrderId: order.id },
      }),
    ).toBe(0);
    expect(
      await prisma.creditLedgerEntry.count({
        where: { billingOrderId: other.order.id },
      }),
    ).toBe(0);
  });
});
