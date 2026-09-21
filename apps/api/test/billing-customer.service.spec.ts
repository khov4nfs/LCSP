import { describe, expect, it, jest } from "@jest/globals";
import { BillingPaymentKernel } from "../src/modules/billing/application/shared/billing-payment.kernel.js";
import { CreateBillingOrderHandler } from "../src/modules/billing/application/commands/create-billing-order/create-billing-order.handler.js";
import { CreateBillingOrderCommand } from "../src/modules/billing/application/commands/create-billing-order/create-billing-order.command.js";
import { ExpireBillingOrderHandler } from "../src/modules/billing/application/commands/expire-billing-order/expire-billing-order.handler.js";
import { ExpireBillingOrderCommand } from "../src/modules/billing/application/commands/expire-billing-order/expire-billing-order.command.js";
import { EstimateBillingHandler } from "../src/modules/billing/application/queries/estimate-billing/estimate-billing.handler.js";
import { EstimateBillingQuery } from "../src/modules/billing/application/queries/estimate-billing/estimate-billing.query.js";
import { BillingDomainError } from "../src/modules/billing/domain/billing.errors.js";
import { GetBillingOrderHandler } from "../src/modules/billing/application/queries/get-billing-order/get-billing-order.handler.js";
import { GetBillingOrderQuery } from "../src/modules/billing/application/queries/get-billing-order/get-billing-order.query.js";
import {
  BILLING_ESTIMATE_AVAILABILITY,
  BILLING_ESTIMATE_RUNTIME_ROLE,
  BILLING_PAYMENT_PROVIDERS,
  PREPAID_BILLING_CONFIG,
} from "@lcsp/contracts/billing";
import { BILLING_AUDIT_EVENT_TYPES } from "@lcsp/contracts/billing";

const billingConfig = {
  getOrThrow: () => ({
    sePayBankName: "Test Bank",
    sePayBankAccountNumber: "1234567890",
    sePayAccountHolder: "LCSP TEST",
    sePayQrUrlTemplate:
      "https://payments.test/qr?amount={amountVnd}&content={paymentCode}",
    maxInputTokens: "1000",
    maxOutputTokens: "500",
    maxReasoningTokens: "0",
  }),
};

const runtime = {
  id: "runtime-1",
  role: BILLING_ESTIMATE_RUNTIME_ROLE,
  provider: "openai",
  model: "gpt-test",
  policyVersion: "policy-1",
  effectiveAt: new Date("2029-01-01"),
};

const pricing = {
  id: "pricing-1",
  provider: "openai",
  model: "gpt-test",
  inputPricePerMillion: "10000",
  outputPricePerMillion: "20000",
  version: 1,
  effectiveAt: new Date("2029-01-01"),
  providerCurrency: "VND",
  customerCurrency: "VND",
  markupBps: 0n,
};

const order = {
  id: "order-1",
  userId: "user-1",
  paymentCode: "LCSPABC123",
  idempotencyKey: "key-1",
  requestFingerprint: "hash",
  status: "PENDING_PAYMENT",
  amountMinorUnits: 10000n,
  creditUnits: 10000n,
  expiresAt: new Date("2030-01-01"),
  creditedAt: null,
  createdAt: new Date("2029-01-01"),
  updatedAt: new Date("2029-01-01"),
};

describe("billing customer CQRS handlers", () => {
  it("uses the configured prepaid limits and conversion", async () => {
    const { handler } = createEstimateHandler({
      runtime: null,
      pricing: null,
    });
    expect(
      await handler.execute(
        new EstimateBillingQuery(
          "user-1",
          BigInt(PREPAID_BILLING_CONFIG.minimumAmountVnd),
        ),
      ),
    ).toMatchObject({
      currency: "VND",
      amountVnd: "10000",
      creditUnits: "10000",
      availability:
        BILLING_ESTIMATE_AVAILABILITY.insufficientPricingConfiguration,
    });
    await expect(
      handler.execute(new EstimateBillingQuery("user-1", 1n)),
    ).rejects.toThrow();
  });

  it("estimates the effective customer usage charge in the authenticated scope", async () => {
    const { handler, runForUser, findRuntime, findPricing } =
      createEstimateHandler({ runtime, pricing });
    const result = await handler.execute(
      new EstimateBillingQuery("customer-1", 10000n),
    );

    expect(runForUser).toHaveBeenCalledWith("customer-1", expect.any(Function));
    expect(findRuntime).toHaveBeenCalledWith(
      BILLING_ESTIMATE_RUNTIME_ROLE,
      expect.any(Date),
    );
    expect(findPricing).toHaveBeenCalledWith(
      runtime.provider,
      runtime.model,
      expect.any(Date),
    );
    expect(result).toMatchObject({
      availability: BILLING_ESTIMATE_AVAILABILITY.available,
      effectiveRuntimeModel: {
        provider: runtime.provider,
        model: runtime.model,
        policyVersion: runtime.policyVersion,
      },
      estimatedUsageChargeVnd: "20",
    });
  });

  it("returns the insufficient-pricing state when the effective runtime has no pricing", async () => {
    const { handler } = createEstimateHandler({ runtime, pricing: null });
    await expect(
      handler.execute(new EstimateBillingQuery("customer-1", 10000n)),
    ).resolves.toMatchObject({
      availability:
        BILLING_ESTIMATE_AVAILABILITY.insufficientPricingConfiguration,
      effectiveRuntimeModel: {
        provider: runtime.provider,
        model: runtime.model,
      },
      estimatedUsageChargeVnd: null,
    });
  });

  it("fails closed when no effective runtime policy is configured", async () => {
    const { handler } = createEstimateHandler({
      runtime: null,
      pricing: null,
      runtimeError: new BillingDomainError(
        "No effective runtime model configuration",
      ),
    });
    await expect(
      handler.execute(new EstimateBillingQuery("customer-1", 10000n)),
    ).resolves.toMatchObject({
      availability:
        BILLING_ESTIMATE_AVAILABILITY.insufficientPricingConfiguration,
      effectiveRuntimeModel: null,
      estimatedUsageChargeVnd: null,
    });
  });

  it("derives order ownership from the supplied authenticated user", async () => {
    const createOrder = jest
      .fn<(input: unknown) => Promise<any>>()
      .mockResolvedValue(order);
    const handler = new CreateBillingOrderHandler(
      { createOrder } as unknown as BillingPaymentKernel,
      billingConfig as never,
    );
    const result = await handler.execute(
      new CreateBillingOrderCommand("user-1", 10000n, "key-1", {
        correlationId: "correlation-1",
      }),
    );
    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        idempotencyKey: "key-1",
        amountMinorUnits: 10000n,
      }),
    );
    expect(result.paymentCode).toBe("LCSPABC123");
    expect(result.status).toBe("PENDING_PAYMENT");
  });

  it("queries orders through the owner-scoped repository", async () => {
    const findForUser = jest
      .fn<(user: string, id: string) => Promise<any>>()
      .mockResolvedValue(order);
    const transactions = {
      runForUser: jest.fn((_user: string, op: (r: never) => unknown) =>
        Promise.resolve(op({ order: { findForUser } } as never)),
      ),
    };
    const handler = new GetBillingOrderHandler(
      transactions as never,
      billingConfig as never,
    );
    await handler.execute(new GetBillingOrderQuery("user-1", "order-1"));
    expect(findForUser).toHaveBeenCalledWith("user-1", "order-1");
  });

  it("expires due orders with one correlated lifecycle audit fact", async () => {
    const expiredOrder = {
      ...order,
      expiresAt: new Date(Date.now() - 1_000),
    };
    const append = jest
      .fn<(input: unknown) => Promise<void>>()
      .mockResolvedValue();
    const transition = jest
      .fn<(id: string, from: string, to: string) => Promise<boolean>>()
      .mockImplementation(() => {
        expiredOrder.status = "EXPIRED";
        return Promise.resolve(true);
      });
    const findForUser = jest
      .fn<(user: string, id: string) => Promise<any>>()
      .mockImplementation(() => Promise.resolve(expiredOrder));
    const transactions = {
      runForUser: jest.fn(
        (_user: string, operation: (repos: never) => unknown) =>
          Promise.resolve(
            operation({
              order: { findForUser, transition },
              audit: { append },
            } as never),
          ),
      ),
    };
    const handler = new ExpireBillingOrderHandler(transactions as never);
    await handler.execute(
      new ExpireBillingOrderCommand("user-1", "order-1", {
        correlationId: "corr-expiry",
        sessionId: "session-1",
      }),
    );
    expect(transition).toHaveBeenCalledWith(
      "order-1",
      "PENDING_PAYMENT",
      "EXPIRED",
    );
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: BILLING_AUDIT_EVENT_TYPES.orderExpired,
        correlationId: "corr-expiry",
        sessionId: "session-1",
      }),
    );
  });

  it("returns executable public SePay transfer and QR instructions", async () => {
    const createOrder = jest
      .fn<(input: unknown) => Promise<typeof order>>()
      .mockResolvedValue(order);
    const handler = new CreateBillingOrderHandler(
      { createOrder } as unknown as BillingPaymentKernel,
      billingConfig as never,
    );

    const result = await handler.execute(
      new CreateBillingOrderCommand("user-1", 10000n, "key-1", {
        correlationId: "correlation-1",
      }),
    );

    expect(result.paymentInstructions).toEqual({
      provider: BILLING_PAYMENT_PROVIDERS.sepay,
      currency: "VND",
      paymentCode: "LCSPABC123",
      amountVnd: "10000",
      bankName: "Test Bank",
      bankAccountNumber: "1234567890",
      accountHolder: "LCSP TEST",
      transferContent: "LCSPABC123",
      qrCodeUrl: "https://payments.test/qr?amount=10000&content=LCSPABC123",
    });
  });
});

function createEstimateHandler(input: {
  runtime: typeof runtime | null;
  pricing: typeof pricing | null;
  runtimeError?: Error;
}) {
  const findRuntime =
    jest.fn<
      (role: string, effectiveAt: Date) => Promise<typeof runtime | null>
    >();
  if (input.runtimeError) {
    findRuntime.mockRejectedValue(input.runtimeError);
  } else {
    findRuntime.mockResolvedValue(input.runtime);
  }
  const findPricing = jest
    .fn<
      (
        provider: string,
        model: string,
        effectiveAt: Date,
      ) => Promise<typeof pricing | null>
    >()
    .mockResolvedValue(input.pricing);
  const runForUser = jest.fn(
    (_userId: string, operation: (repositories: never) => unknown) =>
      Promise.resolve(
        operation({
          runtimePolicy: { findApplicable: findRuntime },
          pricing: { findApplicable: findPricing },
        } as never),
      ),
  );
  const handler = new EstimateBillingHandler(
    { runForUser } as never,
    billingConfig as never,
  );
  return { handler, runForUser, findRuntime, findPricing };
}
