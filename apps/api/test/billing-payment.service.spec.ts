import { describe, expect, it, jest } from "@jest/globals";
import { BILLING_AUDIT_EVENT_TYPES } from "@lcsp/contracts/billing";
import { BillingPaymentKernel } from "../src/modules/billing/application/shared/billing-payment.kernel.js";
import type {
  BillingOrderPort,
  OrderRecord,
} from "../src/modules/billing/domain/repositories/billing-transaction.port.js";

describe("BillingPaymentKernel order lifecycle audit", () => {
  it("writes one created audit fact inside the creation transaction, not on replay", async () => {
    let saved: OrderRecord | undefined;
    const append = jest
      .fn<(input: unknown) => Promise<void>>()
      .mockResolvedValue();
    const order = {
      findByIdempotencyKey: (): Promise<OrderRecord | null> =>
        Promise.resolve(saved ?? null),
      createPending: (
        input: Parameters<BillingOrderPort["createPending"]>[0],
      ): Promise<OrderRecord> => {
        const created: OrderRecord = {
          ...input,
          id: "order-1",
          status: "PENDING_PAYMENT",
          requestFingerprint: input.requestFingerprint ?? null,
          expiresAt: input.expiresAt ?? null,
          creditedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        saved = created;
        return Promise.resolve(created);
      },
    };
    const transactions = {
      runForUser: jest.fn(
        (_userId: string, operation: (repos: never) => unknown) =>
          Promise.resolve(
            operation({
              order: {
                ...order,
              },
              audit: { append },
            } as never),
          ),
      ),
    };
    const service = new BillingPaymentKernel(
      transactions as never,
      {} as never,
    );
    const input = {
      userId: "user-1",
      paymentCode: "LCSPTEST1",
      idempotencyKey: "key-1",
      amountMinorUnits: 10000n,
      creditUnits: 10000n,
      correlationId: "corr-1",
      sessionId: "session-1",
    };

    await service.createOrder(input);
    await service.createOrder(input);

    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: BILLING_AUDIT_EVENT_TYPES.orderCreated,
        actorId: "user-1",
        correlationId: "corr-1",
        resourceId: "order-1",
      }),
    );
  });
});
