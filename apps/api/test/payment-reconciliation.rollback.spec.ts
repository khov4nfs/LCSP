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
import { BillingAccountingService } from "../src/modules/billing/application/services/billing-accounting.service.js";
import { BillingPaymentService } from "../src/modules/billing/application/services/billing-payment.service.js";
import { PrismaBillingTransaction } from "../src/modules/billing/infrastructure/persistence/prisma-billing-transaction.js";
import type {
  BillingTransactionPort,
  BillingTransactionRepositories,
} from "../src/modules/billing/domain/repositories/billing-transaction.port.js";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
} from "./support/auth-workspace-test-helpers.js";

class FaultInjectingBillingTransaction implements BillingTransactionPort {
  constructor(private readonly real: BillingTransactionPort) {}
  runForUser<T>(
    userId: string,
    operation: (repositories: BillingTransactionRepositories) => Promise<T>,
  ): Promise<T> {
    return this.real.runForUser(userId, (repositories) =>
      operation({
        ...repositories,
        wallet: {
          ...repositories.wallet,
          compareAndSetProjection: () => {
            throw new Error("TEST_INJECTED_WALLET_CAS_FAILURE");
          },
        },
      }),
    );
  }
}

describe("LCSP-310 matched payment rollback", () => {
  let prisma: PrismaClient;
  let payments: BillingPaymentService;
  let normalPayments: BillingPaymentService;
  const user = {
    id: `rollback-${randomUUID()}`,
    email: `rollback-${randomUUID()}@test.invalid`,
    passwordHash: "test",
    emailVerified: true,
    failedLoginCount: 0,
  };
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    pushPrismaSchema();
    prisma = new PrismaClient({ adapter: new PrismaPg(TEST_DATABASE_URL) });
    await prisma.$connect();
    const normalTx = new PrismaBillingTransaction(new PrismaService());
    const accounting = new BillingAccountingService(normalTx);
    normalPayments = new BillingPaymentService(normalTx, accounting);
  });
  beforeEach(async () => {
    await prisma.creditLedgerEntry.deleteMany();
    await prisma.paymentTransaction.deleteMany();
    await prisma.sePayWebhookEvent.deleteMany();
    await prisma.billingOrder.deleteMany();
    await prisma.billingWallet.deleteMany();
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.user.create({ data: user });
  });
  afterAll(async () => prisma?.$disconnect());

  it("rolls back matched payment financial effects when a transaction-bound operation fails", async () => {
    const wallet = await prisma.billingWallet.create({
      data: { userId: user.id },
    });
    const order = await prisma.billingOrder.create({
      data: {
        userId: user.id,
        paymentCode: "PAY-ROLLBACK",
        idempotencyKey: "rollback-order",
        amountMinorUnits: 100000n,
        creditUnits: 500n,
      },
    });
    const realTx = new PrismaBillingTransaction(new PrismaService());
    const accounting = new BillingAccountingService(realTx);
    payments = new BillingPaymentService(
      new FaultInjectingBillingTransaction(realTx),
      accounting,
    );
    await expect(
      payments.reconcilePayment({
        provider: "SEPAY",
        providerTransactionId: "TX-ROLLBACK",
        paymentCode: order.paymentCode,
        amountMinorUnits: 100000n,
      }),
    ).rejects.toThrow("TEST_INJECTED_WALLET_CAS_FAILURE");
    expect(
      (await prisma.billingOrder.findUniqueOrThrow({ where: { id: order.id } }))
        .status,
    ).toBe("PENDING_PAYMENT");
    expect(
      await prisma.paymentTransaction.count({
        where: { providerTransactionId: "TX-ROLLBACK" },
      }),
    ).toBe(0);
    expect(
      await prisma.creditLedgerEntry.count({
        where: { idempotencyKey: `billing-order:${order.id}:credit` },
      }),
    ).toBe(0);
    const after = await prisma.billingWallet.findUniqueOrThrow({
      where: { id: wallet.id },
    });
    expect(after.availableCredits).toBe(0n);
    expect(after.reservedCredits).toBe(0n);
    expect(
      await prisma.sePayWebhookEvent.count({
        where: { providerTransactionId: "TX-ROLLBACK" },
      }),
    ).toBe(0);
  });

  it("keeps the non-faulted control path fully successful", async () => {
    const order = await normalPayments.createOrder({
      userId: user.id,
      paymentCode: "PAY-CONTROL",
      idempotencyKey: "control-order",
      amountMinorUnits: 100000n,
      creditUnits: 500n,
    });
    const result = await normalPayments.reconcilePayment({
      provider: "SEPAY",
      providerTransactionId: "TX-CONTROL",
      paymentCode: order.paymentCode,
      amountMinorUnits: 100000n,
    });
    expect(result.reconciliationStatus).toBe("MATCHED");
    expect(
      await prisma.creditLedgerEntry.count({
        where: { billingOrderId: order.id },
      }),
    ).toBe(1);
  });
});
