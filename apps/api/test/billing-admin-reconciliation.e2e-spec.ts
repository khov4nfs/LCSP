import * as assert from "node:assert/strict";

import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  BILLING_ORDER_STATUSES,
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
});
