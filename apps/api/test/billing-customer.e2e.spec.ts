import { AUTH_ERROR_CODES, AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  BILLING_AUDIT_EVENT_TYPES,
  BILLING_ERROR_CODES,
  BILLING_ORDER_STATUSES,
  BILLING_PAYMENT_PROVIDERS,
  PREPAID_BILLING_CONFIG,
} from "@lcsp/contracts/billing";
import * as assert from "node:assert/strict";
import crypto from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { AppModule } from "../src/app.module.js";
import { hashSecret } from "../src/modules/auth/infrastructure/security/security.utils.js";
import { createAuthSessionRecord } from "./support/auth-record-test-helpers.js";
import {
  ensureTestMfaEncryptionKey,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  TEST_DATABASE_URL,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, problemCode, successBody } from "./support/http.js";

type Customer = { id: string; token: string };
type OrderResponse = {
  id: string;
  paymentCode: string;
  status: string;
  amountVnd: string;
  paymentInstructions: {
    provider: string;
    currency: string;
    paymentCode: string;
    amountVnd: string;
    bankName: string;
    bankAccountNumber: string;
    accountHolder: string;
    transferContent: string;
    qrCodeUrl: string;
  };
};

describe("LCSP-312 customer billing HTTP API (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let customerA: Customer;
  let customerB: Customer;
  let admin: Customer;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    ensureTestMfaEncryptionKey();
    pushPrismaSchema();
    prisma = new PrismaClient({ adapter: new PrismaPg(TEST_DATABASE_URL) });
    await prisma.$connect();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  }, 30_000);

  beforeEach(async () => {
    await prisma.llmUsageEvent.deleteMany();
    await prisma.billingReservation.deleteMany();
    await prisma.creditLedgerEntry.deleteMany();
    await prisma.paymentTransaction.deleteMany();
    await prisma.billingOrder.deleteMany();
    await prisma.sePayWebhookEvent.deleteMany();
    await prisma.billingWallet.deleteMany();
    await resetAuthWorkspaceDatabase(prisma);
    customerA = await createUser(AUTH_USER_ROLES.customer);
    customerB = await createUser(AUTH_USER_ROLES.customer);
    admin = await createUser(AUTH_USER_ROLES.admin);
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it("requires an authenticated customer session", async () => {
    const unauthenticated = await httpRequest(app).get("/billing/wallet");
    assert.equal(unauthenticated.status, 401);
    assert.equal(problemCode(unauthenticated), AUTH_ERROR_CODES.sessionInvalid);

    const nonCustomer = await httpRequest(app)
      .get("/billing/wallet")
      .set("Authorization", `Bearer ${admin.token}`);
    assert.equal(nonCustomer.status, 403);
  });

  it("is idempotent, ignores client owner/payment-code fields, and persists real history", async () => {
    const payload = {
      amount_vnd: "10000",
      userId: customerB.id,
      paymentCode: "ATTACKER-CODE",
    };
    const key = "billing-order-idempotency-key-0001";
    const correlationId = "billing-order-correlation-0001";
    const requests = await Promise.all(
      [0, 1].map(() =>
        httpRequest(app)
          .post("/billing/orders")
          .set("Authorization", `Bearer ${customerA.token}`)
          .set("Idempotency-Key", key)
          .set("X-Correlation-Id", correlationId)
          .send(payload),
      ),
    );
    for (const response of requests) assert.equal(response.status, 201);
    const first = successBody<OrderResponse>(requests[0]);
    const second = successBody<OrderResponse>(requests[1]);
    assert.equal(first.id, second.id);
    assert.match(first.paymentCode, /^LCSP[A-Za-z0-9]+$/);
    assert.notEqual(first.paymentCode, payload.paymentCode);
    assert.deepEqual(first.paymentInstructions, {
      provider: BILLING_PAYMENT_PROVIDERS.sepay,
      currency: PREPAID_BILLING_CONFIG.currency,
      paymentCode: first.paymentCode,
      amountVnd: "10000",
      bankName: "Test Bank",
      bankAccountNumber: "1234567890",
      accountHolder: "LCSP TEST",
      transferContent: first.paymentCode,
      qrCodeUrl: `https://payments.test/qr?amount=10000&content=${first.paymentCode}`,
    });
    assert.equal(
      await prisma.billingOrder.count({ where: { userId: customerA.id } }),
      1,
    );
    assert.equal(
      await prisma.billingOrder.count({ where: { userId: customerB.id } }),
      0,
    );
    assert.deepEqual(
      await prisma.auditEvent.findMany({
        where: {
          eventType: BILLING_AUDIT_EVENT_TYPES.orderCreated,
          resourceId: first.id,
        },
        select: { actorId: true, correlationId: true },
      }),
      [{ actorId: customerA.id, correlationId }],
    );

    const conflict = await httpRequest(app)
      .post("/billing/orders")
      .set("Authorization", `Bearer ${customerA.token}`)
      .set("Idempotency-Key", key)
      .send({ amount_vnd: "20000" });
    assert.equal(conflict.status, 409);
    assert.equal(
      problemCode(conflict),
      BILLING_ERROR_CODES.idempotencyConflict,
    );

    const history = await httpRequest(app)
      .get("/billing/history")
      .set("Authorization", `Bearer ${customerA.token}`)
      .expect(200);
    assert.equal(
      successBody<{ totalCount: number; orders: OrderResponse[] }>(history)
        .totalCount,
      1,
    );

    const wallet = await httpRequest(app)
      .get("/billing/wallet")
      .set("Authorization", `Bearer ${customerA.token}`)
      .expect(200);
    assert.equal(
      successBody<{ availableCredits: string }>(wallet).availableCredits,
      "0",
    );

    const clientCreditAttempt = await httpRequest(app)
      .post(`/billing/orders/${first.id}/credit`)
      .set("Authorization", `Bearer ${customerA.token}`)
      .send({});
    assert.equal(clientCreditAttempt.status, 404);
    assert.equal(
      await prisma.creditLedgerEntry.count({
        where: { billingOrderId: first.id },
      }),
      0,
    );
    assert.equal(
      (await prisma.billingOrder.findUniqueOrThrow({ where: { id: first.id } }))
        .status,
      "PENDING_PAYMENT",
    );
  });

  it("does not leak an order across customer accounts", async () => {
    const created = await httpRequest(app)
      .post("/billing/orders")
      .set("Authorization", `Bearer ${customerA.token}`)
      .set("Idempotency-Key", "billing-order-owner-isolation-0001")
      .send({ amount_vnd: "10000" })
      .expect(201);
    const order = successBody<OrderResponse>(created);
    const denied = await httpRequest(app)
      .get(`/billing/orders/${order.id}`)
      .set("Authorization", `Bearer ${customerB.token}`);
    assert.equal(denied.status, 404);
    assert.equal(problemCode(denied), BILLING_ERROR_CODES.notFound);

    const wallet = await prisma.billingWallet.create({
      data: { userId: customerA.id, availableCredits: 123n },
    });
    await prisma.creditLedgerEntry.create({
      data: {
        userId: customerA.id,
        walletId: wallet.id,
        idempotencyKey: "billing-owner-isolation-seed",
        source: "TEST_FIXTURE",
        referenceId: "billing-owner-isolation-seed",
        deltaCredits: 123n,
      },
    });

    const ownerWallet = await httpRequest(app)
      .get("/billing/wallet")
      .set("Authorization", `Bearer ${customerA.token}`)
      .expect(200);
    const otherWallet = await httpRequest(app)
      .get("/billing/wallet")
      .set("Authorization", `Bearer ${customerB.token}`)
      .expect(200);
    assert.equal(
      successBody<{ availableCredits: string }>(ownerWallet).availableCredits,
      "123",
    );
    assert.equal(
      successBody<{ availableCredits: string }>(otherWallet).availableCredits,
      "0",
    );

    const ownerHistory = await httpRequest(app)
      .get("/billing/history")
      .set("Authorization", `Bearer ${customerA.token}`)
      .expect(200);
    const otherHistory = await httpRequest(app)
      .get("/billing/history")
      .set("Authorization", `Bearer ${customerB.token}`)
      .expect(200);
    assert.equal(
      successBody<{ totalCount: number }>(ownerHistory).totalCount,
      1,
    );
    assert.equal(
      successBody<{ totalCount: number }>(otherHistory).totalCount,
      0,
    );
  });

  it("never exposes a client credit operation for expired or cancelled orders", async () => {
    for (const status of [
      BILLING_ORDER_STATUSES.EXPIRED,
      BILLING_ORDER_STATUSES.CANCELLED,
    ]) {
      const created = await httpRequest(app)
        .post("/billing/orders")
        .set("Authorization", `Bearer ${customerA.token}`)
        .set("Idempotency-Key", `billing-client-credit-${status}`)
        .send({ amount_vnd: "10000" })
        .expect(201);
      const order = successBody<OrderResponse>(created);
      await prisma.billingOrder.update({
        where: { id: order.id },
        data: { status },
      });

      const clientAttempt = await httpRequest(app)
        .post(`/billing/orders/${order.id}/credit`)
        .set("Authorization", `Bearer ${customerA.token}`)
        .send({});
      assert.equal(clientAttempt.status, 404);
      assert.equal(
        await prisma.creditLedgerEntry.count({
          where: { billingOrderId: order.id },
        }),
        0,
      );
      assert.equal(
        (
          await prisma.billingOrder.findUniqueOrThrow({
            where: { id: order.id },
          })
        ).status,
        status,
      );
    }
  });

  async function createUser(
    role: (typeof AUTH_USER_ROLES)[keyof typeof AUTH_USER_ROLES],
  ): Promise<Customer> {
    const id = crypto.randomUUID();
    const token = `billing-session-${crypto.randomUUID()}`;
    await prisma.user.create({
      data: {
        id,
        email: `billing-${id}@test.invalid`,
        passwordHash: hashSecret("BillingTestPassword123!"),
        emailVerified: true,
        failedLoginCount: 0,
        role,
      },
    });
    await createAuthSessionRecord(prisma, {
      id: crypto.randomUUID(),
      userId: id,
      token,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    return { id, token };
  }
});
