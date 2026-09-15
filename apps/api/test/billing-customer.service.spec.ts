import { describe, expect, it, jest } from "@jest/globals";
import { BillingCustomerService } from "../src/modules/billing/application/services/billing-customer.service.js";
import { BillingPaymentService } from "../src/modules/billing/application/services/billing-payment.service.js";
import {
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
  }),
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

describe("BillingCustomerService", () => {
  it("uses the configured prepaid limits and conversion", () => {
    const service = new BillingCustomerService(
      {} as never,
      {} as never,
      billingConfig as never,
    );
    expect(
      service.estimate(PREPAID_BILLING_CONFIG.minimumAmountVnd),
    ).toMatchObject({
      currency: "VND",
      amountVnd: "10000",
      creditUnits: "10000",
    });
    expect(() => service.estimate(1n)).toThrow();
  });

  it("derives order ownership from the supplied authenticated user", async () => {
    const createOrder = jest
      .fn<(input: unknown) => Promise<any>>()
      .mockResolvedValue(order);
    const service = new BillingCustomerService(
      {} as never,
      { createOrder } as unknown as BillingPaymentService,
      billingConfig as never,
    );
    const result = await service.createOrder("user-1", 10000n, "key-1");
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
    const service = new BillingCustomerService(
      transactions as never,
      {} as never,
      billingConfig as never,
    );
    await service.getOrder("user-1", "order-1");
    expect(findForUser).toHaveBeenCalledWith("user-1", "order-1");
  });

  it("materializes expiry with one correlated lifecycle audit fact", async () => {
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
    const service = new BillingCustomerService(
      transactions as never,
      {} as never,
      billingConfig as never,
    );
    const result = await service.getOrder("user-1", "order-1", {
      correlationId: "corr-expiry",
      sessionId: "session-1",
    });
    expect(result.status).toBe("EXPIRED");
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: BILLING_AUDIT_EVENT_TYPES.orderExpired,
        correlationId: "corr-expiry",
      }),
    );
  });

  it("returns executable public SePay transfer and QR instructions", async () => {
    const createOrder = jest
      .fn<(input: unknown) => Promise<typeof order>>()
      .mockResolvedValue(order);
    const service = new BillingCustomerService(
      {} as never,
      { createOrder } as unknown as BillingPaymentService,
      billingConfig as never,
    );

    const result = await service.createOrder("user-1", 10000n, "key-1");

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
