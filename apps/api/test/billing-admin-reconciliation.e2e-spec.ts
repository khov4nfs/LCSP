import * as assert from "node:assert/strict";

import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  BILLING_ADMIN_GATEWAYS,
  BILLING_ADMIN_PAYMENT_FILTERS,
  BILLING_ADMIN_PERIODS,
  BILLING_ORDER_STATUSES,
  LLM_USAGE_STATUSES,
  PAYMENT_RECONCILIATION_REASONS,
  PAYMENT_RECONCILIATION_STATUSES,
} from "@lcsp/contracts/billing";

import { AppModule } from "../src/app.module.js";
import type { SignInSuccess } from "../src/modules/auth/application/contracts/auth/sign-in.contract.js";
import {
  TEST_DATABASE_URL,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, successBody } from "./support/http.js";

describe("Admin billing reconciliation (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;
  let customerToken: string;
  let orderId: string;
  let paymentId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    pushPrismaSchema();
    prisma = new PrismaClient({ adapter: new PrismaPg(TEST_DATABASE_URL) });
    await prisma.$connect();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    await prisma.paymentTransaction.deleteMany();
    await prisma.creditLedgerEntry.deleteMany();
    await prisma.llmUsageEvent.deleteMany();
    await prisma.billingOrder.deleteMany();
    await prisma.billingWallet.deleteMany();
    await prisma.sePayWebhookEvent.deleteMany();
    await prisma.auditEvent.deleteMany();
    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);

    const adminSignIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "nomembership@acme.test",
      password: "NoMembership123!",
    });
    adminToken = successBody<SignInSuccess>(adminSignIn).session_token ?? "";

    const customerSignIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "manager@acme.test",
      password: "CorrectHorseBatteryStaple!",
    });
    customerToken =
      successBody<SignInSuccess>(customerSignIn).session_token ?? "";

    const order = await prisma.billingOrder.create({
      data: {
        userId: "user-1",
        paymentCode: "LCSP-ADMIN-ORDER",
        idempotencyKey: "admin-order-1",
        amountMinorUnits: 100000n,
        creditUnits: 500n,
        status: BILLING_ORDER_STATUSES.PENDING_RECONCILIATION,
      },
    });
    orderId = order.id;
    const webhook = await prisma.sePayWebhookEvent.create({
      data: {
        provider: "SEPAY",
        providerTransactionId: "TX-ADMIN-E2E",
        securityAcceptedAt: new Date(),
        sanitizedPayload: {
          providerTransactionId: "TX-ADMIN-E2E",
          paymentCode: "UNKNOWN-ADMIN",
          amountMinorUnits: "100000",
          transferDirection: "IN",
        },
      },
    });
    const payment = await prisma.paymentTransaction.create({
      data: {
        provider: "SEPAY",
        providerTransactionId: "TX-ADMIN-E2E",
        amountMinorUnits: 100000n,
        reconciliationStatus: PAYMENT_RECONCILIATION_STATUSES.UNMATCHED,
        reconciliationReason:
          PAYMENT_RECONCILIATION_REASONS.UNMATCHED_PAYMENT_CODE,
        webhookEventId: webhook.id,
      },
    });
    paymentId = payment.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("allows Admin queue/detail and owner-safe resolve, while denying customers", async () => {
    const list = await httpRequest(app)
      .get("/admin/billing/reconciliation")
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(list.status, 200);
    assert.equal(
      successBody<{ items: Array<{ id: string }> }>(list).items[0]?.id,
      paymentId,
    );

    const detail = await httpRequest(app)
      .get(`/admin/billing/reconciliation/${paymentId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(detail.status, 200);
    assert.equal(
      successBody<{ reconciliationVersion: number }>(detail)
        .reconciliationVersion,
      0,
    );

    const denied = await httpRequest(app)
      .patch(`/admin/billing/reconciliation/${paymentId}/resolve`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        billingOrderId: orderId,
        expectedVersion: 0,
        rationale: "not allowed",
      });
    assert.equal(denied.status, 403);

    const resolved = await httpRequest(app)
      .patch(`/admin/billing/reconciliation/${paymentId}/resolve`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        billingOrderId: orderId,
        expectedVersion: 0,
        rationale: "Verified bank statement and order owner",
      });
    assert.equal(resolved.status, 200);
    assert.equal(
      successBody<{ status: string }>(resolved).status,
      PAYMENT_RECONCILIATION_STATUSES.MATCHED,
    );

    const [payment, order, ledger, audit] = await Promise.all([
      prisma.paymentTransaction.findUniqueOrThrow({ where: { id: paymentId } }),
      prisma.billingOrder.findUniqueOrThrow({ where: { id: orderId } }),
      prisma.creditLedgerEntry.findMany({ where: { billingOrderId: orderId } }),
      prisma.auditEvent.findMany({
        where: {
          eventType: "billing.reconciliation.settled",
          resourceId: paymentId,
        },
      }),
    ]);
    assert.equal(payment.userId, "user-1");
    assert.equal(payment.billingOrderId, orderId);
    assert.equal(order.status, BILLING_ORDER_STATUSES.CREDITED);
    assert.equal(ledger.length, 1);
    assert.equal(audit.length, 1);
    assert.equal(audit[0]?.actorId, "user-3");
  });

  it("fails one of two concurrent Admin decisions with a stale version", async () => {
    const requests = await Promise.all([
      httpRequest(app)
        .patch(`/admin/billing/reconciliation/${paymentId}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          billingOrderId: orderId,
          expectedVersion: 0,
          rationale: "Concurrent decision A",
        }),
      httpRequest(app)
        .patch(`/admin/billing/reconciliation/${paymentId}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          billingOrderId: orderId,
          expectedVersion: 0,
          rationale: "Concurrent decision B",
        }),
    ]);
    assert.deepEqual(
      requests.map((response) => response.status).sort((a, b) => a - b),
      [200, 409],
    );
    assert.equal(
      await prisma.creditLedgerEntry.count({
        where: { billingOrderId: orderId },
      }),
      1,
    );
  });

  it("exposes bounded Admin reporting endpoints with explicit redaction", async () => {
    const from = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
    const to = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
    const summary = await httpRequest(app)
      .get("/admin/billing/revenue-summary")
      .query({
        from,
        to,
      })
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(summary.status, 200);
    const summaryBody = successBody<{
      settledTopUps: { amountMinorUnits: string };
      pendingReconciliation: { count: number };
      duplicateBlocked: { count: number; scope: string };
    }>(summary);
    assert.equal(summaryBody.settledTopUps.amountMinorUnits, "0");
    assert.equal(summaryBody.pendingReconciliation.count, 1);
    assert.equal(
      summaryBody.duplicateBlocked.scope,
      "DURABLE_PAYMENT_TRANSACTIONS",
    );

    for (const path of [
      "/admin/billing/revenue-summary",
      "/admin/billing/transactions",
      "/admin/billing/reconciliation",
    ]) {
      const invalidPeriod = await httpRequest(app)
        .get(path)
        .query({
          from: "2026-09-20T00:00:00",
          to: "2026-09-21T00:00:00",
        })
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(invalidPeriod.status, 400);
    }

    const transactions = await httpRequest(app)
      .get("/admin/billing/transactions")
      .query({ status: "UNMATCHED", pageSize: 10 })
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(transactions.status, 200);
    const transactionBody = successBody<{
      items: Array<Record<string, unknown>>;
    }>(transactions);
    assert.equal(transactionBody.items.length, 1);
    const transaction = transactionBody.items[0];
    assert.ok(transaction);
    assert.equal("webhookEvent" in transaction, false);
    assert.equal("sanitizedPayload" in transaction, false);

    const denied = await httpRequest(app)
      .get("/admin/billing/revenue-summary")
      .set("Authorization", `Bearer ${customerToken}`);
    assert.equal(denied.status, 403);
  });

  it("reconciles persisted top-ups, usage debits, liabilities, and durable duplicate facts", async () => {
    await prisma.paymentTransaction.deleteMany();
    await prisma.creditLedgerEntry.deleteMany();
    await prisma.llmUsageEvent.deleteMany();
    await prisma.billingOrder.deleteMany();
    await prisma.billingWallet.deleteMany();

    const from = new Date("2026-09-01T00:00:00.000Z");
    const to = new Date("2026-10-01T00:00:00.000Z");
    const reconciledAt = new Date("2026-09-15T12:00:00.000Z");
    const receivedAt = new Date("2026-09-15T11:00:00.000Z");

    const [walletA, walletB] = await Promise.all([
      prisma.billingWallet.create({
        data: {
          userId: "user-1",
          availableCredits: 700n,
          reservedCredits: 20n,
        },
      }),
      prisma.billingWallet.create({
        data: {
          userId: "user-2",
          availableCredits: 0n,
          reservedCredits: 30n,
        },
      }),
    ]);

    const createOrder = (suffix: string, userId: string, amount: bigint) =>
      prisma.billingOrder.create({
        data: {
          userId,
          paymentCode: `LCSP-REPORT-${suffix}`,
          idempotencyKey: `report-order-${suffix}`,
          amountMinorUnits: amount,
          creditUnits: amount,
          status: BILLING_ORDER_STATUSES.PENDING_RECONCILIATION,
        },
      });
    const [orderA, orderB, orderC, orderD, orderE, orderF] = await Promise.all([
      createOrder("A", "user-1", 500n),
      createOrder("B", "user-2", 300n),
      createOrder("C", "user-1", 700n),
      createOrder("D", "user-1", 200n),
      createOrder("E", "user-1", 500n),
      createOrder("F", "user-1", 900n),
    ]);

    await prisma.paymentTransaction.createMany({
      data: [
        {
          provider: "SEPAY",
          providerTransactionId: "REPORT-TX-A",
          amountMinorUnits: 500n,
          reconciliationStatus: PAYMENT_RECONCILIATION_STATUSES.MATCHED,
          userId: "user-1",
          billingOrderId: orderA.id,
          receivedAt,
          reconciledAt,
        },
        {
          provider: "SEPAY",
          providerTransactionId: "REPORT-TX-B",
          amountMinorUnits: 300n,
          reconciliationStatus: PAYMENT_RECONCILIATION_STATUSES.MATCHED,
          userId: "user-2",
          billingOrderId: orderB.id,
          receivedAt,
          reconciledAt,
        },
        {
          provider: "SEPAY",
          providerTransactionId: "REPORT-TX-C",
          amountMinorUnits: 700n,
          reconciliationStatus: PAYMENT_RECONCILIATION_STATUSES.UNMATCHED,
          reconciliationReason:
            PAYMENT_RECONCILIATION_REASONS.UNMATCHED_PAYMENT_CODE,
          userId: "user-1",
          billingOrderId: orderC.id,
          receivedAt,
        },
        {
          provider: "SEPAY",
          providerTransactionId: "REPORT-TX-D",
          amountMinorUnits: 200n,
          reconciliationStatus: PAYMENT_RECONCILIATION_STATUSES.AMOUNT_MISMATCH,
          reconciliationReason: PAYMENT_RECONCILIATION_REASONS.UNDERPAYMENT,
          userId: "user-1",
          billingOrderId: orderD.id,
          receivedAt,
        },
        {
          provider: "SEPAY",
          providerTransactionId: "REPORT-TX-E",
          amountMinorUnits: 500n,
          reconciliationStatus: PAYMENT_RECONCILIATION_STATUSES.DUPLICATE,
          reconciliationReason:
            PAYMENT_RECONCILIATION_REASONS.DUPLICATE_PROVIDER_TRANSACTION,
          userId: "user-1",
          billingOrderId: orderE.id,
          receivedAt,
        },
        {
          provider: "SEPAY",
          providerTransactionId: "REPORT-TX-F",
          amountMinorUnits: 900n,
          reconciliationStatus: PAYMENT_RECONCILIATION_STATUSES.REJECTED,
          reconciliationReason:
            PAYMENT_RECONCILIATION_REASONS.RECOVERABLE_EXCEPTION,
          userId: "user-1",
          billingOrderId: orderF.id,
          receivedAt,
        },
      ],
    });

    await prisma.creditLedgerEntry.createMany({
      data: [
        {
          userId: "user-1",
          walletId: walletA.id,
          idempotencyKey: "report-ledger-llm",
          source: "LLM_USAGE_DEBIT",
          referenceId: "report-usage-llm",
          deltaCredits: -80n,
          createdAt: reconciledAt,
        },
        {
          userId: "user-2",
          walletId: walletB.id,
          idempotencyKey: "report-ledger-reservation",
          source: "RESERVATION_SETTLEMENT",
          referenceId: "report-usage-reservation",
          deltaCredits: -50n,
          createdAt: reconciledAt,
        },
      ],
    });
    await prisma.llmUsageEvent.create({
      data: {
        userId: "user-1",
        provider: "OPENAI",
        model: "gpt-test",
        invocationId: "report-usage-without-ledger",
        status: "SETTLED",
        customerChargeVnd: 999n,
        occurredAt: reconciledAt,
      },
    });

    const response = await httpRequest(app)
      .get("/admin/billing/revenue-summary")
      .query({ from: from.toISOString(), to: to.toISOString() })
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(response.status, 200);
    const body = successBody<{
      settledTopUps: { amountMinorUnits: string; count: number };
      usageRevenue: { amountMinorUnits: string; count: number };
      outstandingCredits: { credits: string };
      pendingReconciliation: { count: number };
      duplicateBlocked: { count: number; scope: string };
    }>(response);
    assert.deepEqual(body.settledTopUps, {
      amountMinorUnits: "800",
      count: 2,
    });
    assert.deepEqual(body.usageRevenue, {
      amountMinorUnits: "130",
      count: 2,
    });
    assert.equal(body.outstandingCredits.credits, "750");
    assert.equal(body.pendingReconciliation.count, 2);
    assert.deepEqual(body.duplicateBlocked, {
      count: 1,
      scope: "DURABLE_PAYMENT_TRANSACTIONS",
    });

    const boundary = await httpRequest(app)
      .get("/admin/billing/revenue-summary")
      .query({
        from: new Date(reconciledAt.getTime() - 1).toISOString(),
        to: reconciledAt.toISOString(),
      })
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(boundary.status, 200);
    const boundaryBody = successBody<{
      settledTopUps: { amountMinorUnits: string };
      usageRevenue: { amountMinorUnits: string };
      outstandingCredits: { credits: string };
    }>(boundary);
    assert.equal(boundaryBody.settledTopUps.amountMinorUnits, "0");
    assert.equal(boundaryBody.usageRevenue.amountMinorUnits, "0");
    assert.equal(boundaryBody.outstandingCredits.credits, "750");

    const filterRequests = [
      { status: "MATCHED", expected: 2 },
      { provider: "SEPAY", expected: 6 },
      { userId: "user-1", expected: 5 },
      { email: "manager@acme.test", expected: 5 },
      { paymentCode: "LCSP-REPORT-A", expected: 1 },
      { orderId: orderA.id, expected: 1 },
    ];
    for (const filter of filterRequests) {
      const filtered = await httpRequest(app)
        .get("/admin/billing/transactions")
        .query({
          ...filter,
          from: from.toISOString(),
          to: to.toISOString(),
          pageSize: 100,
        })
        .set("Authorization", `Bearer ${adminToken}`);
      assert.equal(filtered.status, 200);
      const filteredBody = successBody<{ items: unknown[] }>(filtered);
      assert.equal(filteredBody.items.length, filter.expected);
    }
    const firstPage = await httpRequest(app)
      .get("/admin/billing/transactions")
      .query({ from: from.toISOString(), to: to.toISOString(), pageSize: 2 })
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(firstPage.status, 200);
    const firstPageBody = successBody<{
      items: Array<{ paymentId: string }>;
      nextCursor: string | null;
      hasNext: boolean;
    }>(firstPage);
    assert.equal(firstPageBody.items.length, 2);
    assert.equal(firstPageBody.hasNext, true);
    assert.ok(firstPageBody.nextCursor);

    const cursorOrder = await prisma.billingOrder.create({
      data: {
        userId: "user-1",
        paymentCode: "LCSP-REPORT-G",
        idempotencyKey: "report-order-G",
        amountMinorUnits: 100n,
        creditUnits: 100n,
        status: BILLING_ORDER_STATUSES.PENDING_RECONCILIATION,
      },
    });
    await prisma.paymentTransaction.create({
      data: {
        provider: "SEPAY",
        providerTransactionId: "REPORT-TX-G",
        amountMinorUnits: 100n,
        reconciliationStatus: PAYMENT_RECONCILIATION_STATUSES.UNMATCHED,
        reconciliationReason:
          PAYMENT_RECONCILIATION_REASONS.UNMATCHED_PAYMENT_CODE,
        userId: "user-1",
        billingOrderId: cursorOrder.id,
        receivedAt: new Date("2026-09-15T11:30:00.000Z"),
      },
    });
    const secondPage = await httpRequest(app)
      .get("/admin/billing/transactions")
      .query({
        from: from.toISOString(),
        to: to.toISOString(),
        pageSize: 2,
        cursor: firstPageBody.nextCursor,
      })
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(secondPage.status, 200);
    const secondPageBody = successBody<{
      items: Array<{ paymentId: string }>;
    }>(secondPage);
    assert.equal(secondPageBody.items.length, 2);
    assert.equal(
      new Set([
        ...firstPageBody.items.map((item) => item.paymentId),
        ...secondPageBody.items.map((item) => item.paymentId),
      ]).size,
      4,
    );
    const malformedCursor = await httpRequest(app)
      .get("/admin/billing/transactions")
      .query({
        from: from.toISOString(),
        to: to.toISOString(),
        pageSize: 2,
        cursor: "not-a-cursor",
      })
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(malformedCursor.status, 400);
  });

  it("serves domain-backed revenue metrics and account rows only to admins", async () => {
    const creditedAt = new Date();
    await prisma.billingOrder.update({
      where: { id: orderId },
      data: { status: BILLING_ORDER_STATUSES.CREDITED, creditedAt },
    });
    await prisma.llmUsageEvent.create({
      data: {
        userId: "user-1",
        provider: "OPENAI",
        model: "MODEL_A",
        invocationId: "admin-billing-fixture-usage",
        status: LLM_USAGE_STATUSES.SETTLED,
        customerChargeVnd: 2500n,
        chargedCredits: 25n,
        occurredAt: creditedAt,
      },
    });
    for (const providerTransactionId of [
      "TX-ADMIN-DUPLICATE-A",
      "TX-ADMIN-DUPLICATE-B",
    ]) {
      await prisma.paymentTransaction.create({
        data: {
          provider: "SEPAY",
          providerTransactionId,
          amountMinorUnits: 1000n,
          userId: "user-1",
          billingOrderId: orderId,
          reconciliationStatus: PAYMENT_RECONCILIATION_STATUSES.DUPLICATE,
          reconciliationReason:
            PAYMENT_RECONCILIATION_REASONS.DUPLICATE_PROVIDER_TRANSACTION,
        },
      });
    }

    const response = await httpRequest(app)
      .get(
        "/admin/billing?period=MTD&status=DUPLICATE&gateway=SEPAY&page=1&pageSize=1",
      )
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const dashboard = successBody<{
      summary: {
        settledTopUpVnd: string;
        usageRevenueVnd: string;
        pendingReconciliationCount: number;
        duplicatePaymentCount: number;
        settledTopUpTrend: Array<{ day: string; amountVnd: string }>;
      };
      items: Array<{
        account: { userId: string; email: string } | null;
        order: { paymentCode: string; creditUnits: string } | null;
      }>;
      page: number;
      pageSize: number;
      totalCount: number;
    }>(response);
    const { settledTopUpTrend, ...summary } = dashboard.summary;
    assert.deepEqual(summary, {
      settledTopUpVnd: "100000",
      usageRevenueVnd: "2500",
      pendingReconciliationCount: 1,
      duplicatePaymentCount: 2,
    });
    assert.equal(settledTopUpTrend.length, 7);
    assert.equal(
      settledTopUpTrend.reduce((sum, day) => sum + BigInt(day.amountVnd), 0n),
      100000n,
    );
    assert.equal(dashboard.items.length, 1);
    assert.equal(dashboard.items[0]?.account?.userId, "user-1");
    assert.equal(dashboard.items[0]?.account?.email, "manager@acme.test");
    assert.equal(dashboard.items[0]?.order?.paymentCode, "LCSP-ADMIN-ORDER");
    assert.equal(dashboard.items[0]?.order?.creditUnits, "500");
    assert.equal(dashboard.page, 1);
    assert.equal(dashboard.pageSize, 1);
    assert.equal(dashboard.totalCount, 2);
    assert.doesNotMatch(
      JSON.stringify(response.body),
      /rawBody|signature|webhookSecret|sanitizedPayload|bankAccountNumber/i,
    );

    await httpRequest(app)
      .get("/admin/billing")
      .set("Authorization", `Bearer ${customerToken}`)
      .expect(403);
  });

  it("exports rows in stable receivedAt and id order and denies customers", async () => {
    const receivedAt = new Date(Date.now() - 1000);
    const exports = await Promise.all(
      ["TX-ADMIN-EXPORT-A", "TX-ADMIN-EXPORT-B"].map((providerTransactionId) =>
        prisma.paymentTransaction.create({
          data: {
            provider: BILLING_ADMIN_GATEWAYS.sepay,
            providerTransactionId,
            amountMinorUnits: 1000n,
            receivedAt,
          },
        }),
      ),
    );
    const expectedIds = exports
      .map((payment) => payment.id)
      .sort((left, right) => (left > right ? -1 : left < right ? 1 : 0));

    const response = await httpRequest(app)
      .get(
        `/admin/billing/export?period=${BILLING_ADMIN_PERIODS.mtd}&status=${BILLING_ADMIN_PAYMENT_FILTERS.all}&gateway=${BILLING_ADMIN_GATEWAYS.all}`,
      )
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const report = successBody<{
      items: Array<{ id: string; receivedAt: string }>;
    }>(response);
    assert.deepEqual(
      report.items
        .map((item) => item.id)
        .filter((id) => expectedIds.includes(id)),
      expectedIds,
    );

    await httpRequest(app)
      .get("/admin/billing/export")
      .set("Authorization", `Bearer ${customerToken}`)
      .expect(403);
  });
});
