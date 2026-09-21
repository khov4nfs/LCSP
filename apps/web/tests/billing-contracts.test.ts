import assert from "node:assert/strict";
import test from "node:test";
import {
  BILLING_ADMIN_PERIODS,
  BILLING_ADMIN_GATEWAYS,
  BILLING_ADMIN_PAYMENT_FILTERS,
  BILLING_ORDER_STATUSES,
  BILLING_PAYMENT_PROVIDERS,
  PREPAID_BILLING_CONFIG,
  billingAdminDashboardSchema,
  billingAmountVndSchema,
  billingOrderViewSchema,
  billingUsageReservationSchema,
  billingUsageSettlementSchema,
  billingWalletViewSchema,
} from "@lcsp/contracts/billing";

import {
  BillingRequestError,
  getBillingEstimate,
  getBillingWallet,
} from "../src/lib/api/billing-client.ts";
import { fetchAdminBillingExport } from "../src/lib/api/admin-billing-client.ts";
import { validatedBillingUpstreamJson } from "../src/lib/server/billing-upstream.ts";

test("Billing amount schema enforces the canonical amount boundaries", () => {
  assert.equal(billingAmountVndSchema.safeParse("10000").success, true);
  assert.equal(billingAmountVndSchema.safeParse("10001").success, false);
  assert.equal(billingAmountVndSchema.safeParse("9999").success, false);
  assert.equal(billingAmountVndSchema.safeParse("10001000").success, false);
});

test("Billing usage schemas reject invalid credit and token values", () => {
  const reservation = {
    assessmentId: "assessment-1",
    runId: "run-1",
    idempotencyKey: "reservation-1",
    provider: "OPENAI",
    model: "gpt-test",
    amountCredits: "100",
    maxChargeCredits: "50",
    maxInputTokens: "1000",
    maxOutputTokens: "1000",
    maxReasoningTokens: "1000",
    maxInvocations: "1",
    authorizedModels: [{ provider: "OPENAI", model: "gpt-test" }],
  };

  assert.equal(
    billingUsageReservationSchema.safeParse(reservation).success,
    true,
  );
  assert.equal(
    billingUsageReservationSchema.safeParse({
      ...reservation,
      amountCredits: "0",
    }).success,
    false,
  );
  assert.equal(
    billingUsageReservationSchema.safeParse({
      ...reservation,
      amountCredits: "49",
    }).success,
    false,
  );
  assert.equal(
    billingUsageReservationSchema.safeParse({
      ...reservation,
      maxInvocations: "0",
    }).success,
    false,
  );

  const settlement = {
    assessmentId: "assessment-1",
    runId: "run-1",
    agentRole: "root",
    reservationId: "reservation-1",
    invocationId: "invocation-1",
    provider: "OPENAI",
    model: "gpt-test",
    inputTokens: "5",
  };
  assert.equal(
    billingUsageSettlementSchema.safeParse(settlement).success,
    true,
  );
  assert.equal(
    billingUsageSettlementSchema.safeParse({ ...settlement, inputTokens: "-1" })
      .success,
    false,
  );
  assert.equal(
    billingUsageSettlementSchema.safeParse({
      ...settlement,
      invocationId: undefined,
    }).success,
    false,
  );
});

test("Billing response schemas validate customer and admin data", () => {
  const wallet = {
    walletId: "wallet-1",
    availableCredits: "100",
    reservedCredits: "0",
    totalCredits: "100",
    version: 1,
  };
  assert.equal(billingWalletViewSchema.safeParse(wallet).success, true);
  assert.equal(
    billingWalletViewSchema.safeParse({ ...wallet, version: -1 }).success,
    false,
  );

  const order = {
    id: "order-1",
    amountVnd: "10000",
    creditUnits: "10000",
    paymentCode: "LCSPORDER1",
    status: BILLING_ORDER_STATUSES.PENDING_PAYMENT,
    expiresAt: "2026-09-22T00:00:00.000Z",
    creditedAt: null,
    createdAt: "2026-09-21T00:00:00.000Z",
    updatedAt: "2026-09-21T00:00:00.000Z",
    paymentInstructions: {
      provider: BILLING_PAYMENT_PROVIDERS.sepay,
      currency: PREPAID_BILLING_CONFIG.currency,
      paymentCode: "LCSPORDER1",
      amountVnd: "10000",
      bankName: "Example Bank",
      bankAccountNumber: "0123456789",
      accountHolder: "LCSP",
      transferContent: "LCSPORDER1",
      qrCodeUrl: "",
    },
  };
  assert.equal(billingOrderViewSchema.safeParse(order).success, true);

  const dashboard = {
    period: BILLING_ADMIN_PERIODS.d30,
    summary: {
      settledTopUpVnd: "0",
      usageRevenueVnd: "0",
      pendingReconciliationCount: 0,
      duplicatePaymentCount: 0,
      settledTopUpTrend: Array.from({ length: 7 }, (_, index) => ({
        day: `2026-09-${String(index + 1).padStart(2, "0")}`,
        amountVnd: "0",
      })),
    },
    items: [],
    page: 1,
    pageSize: 20,
    totalCount: 0,
  };
  assert.equal(billingAdminDashboardSchema.safeParse(dashboard).success, true);
});

test("Billing BFF response adapter rejects invalid upstream data", async () => {
  const validWallet = {
    walletId: "wallet-1",
    availableCredits: "100",
    reservedCredits: "0",
    totalCredits: "100",
    version: 1,
  };
  const upstream = {
    result: { ok: true as const, data: validWallet },
    data: { ...validWallet, version: -1 },
    ok: true,
    status: 200,
  };

  const response = validatedBillingUpstreamJson(
    upstream,
    billingWalletViewSchema,
  );
  assert.equal(response.status, 502);
  const result = (await response.json()) as { ok: boolean };
  assert.equal(result.ok, false);
});

test("Billing browser client uses schemas for local input and response checks", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return Response.json({
      ok: true,
      data: {
        walletId: "wallet-1",
        availableCredits: "100",
        reservedCredits: "0",
        totalCredits: "100",
        version: -1,
      },
    });
  };

  try {
    await assert.rejects(getBillingWallet(), BillingRequestError);
    await assert.rejects(getBillingEstimate("10001"), BillingRequestError);
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Admin billing export client fetches one snapshot report and validates it", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async (input) => {
    fetchCalls += 1;
    assert.equal(
      String(input),
      `/api/admin/billing/export?period=${BILLING_ADMIN_PERIODS.mtd}&status=${BILLING_ADMIN_PAYMENT_FILTERS.all}&gateway=${BILLING_ADMIN_GATEWAYS.all}`,
    );
    return Response.json({
      ok: true,
      data: { period: BILLING_ADMIN_PERIODS.mtd, items: [] },
    });
  };

  try {
    const report = await fetchAdminBillingExport({
      period: BILLING_ADMIN_PERIODS.mtd,
      status: BILLING_ADMIN_PAYMENT_FILTERS.all,
      gateway: BILLING_ADMIN_GATEWAYS.all,
    });
    assert.deepEqual(report, { period: BILLING_ADMIN_PERIODS.mtd, items: [] });
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
