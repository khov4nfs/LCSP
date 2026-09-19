import { describe, expect, it, jest } from "@jest/globals";
import { BILLING_ERROR_CODES } from "@lcsp/contracts/billing";
import { BillingCustomerController } from "../src/modules/billing/presentation/http/billing-customer.controller.js";

const request = {
  correlationId: "corr-1",
  rbacContext: {
    userId: "user-1",
    sessionId: "session-1",
    role: "CUSTOMER",
    scope: "billing",
  },
} as never;

describe("BillingCustomerController input boundary", () => {
  it("rejects blank Idempotency-Key before invoking billing", async () => {
    const controller = new BillingCustomerController(
      { execute: jest.fn() } as never,
      { execute: jest.fn() } as never,
    );
    await expect(
      controller.order({ amount_vnd: "10000" }, "   ", request),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({
        problem: expect.objectContaining({
          code: BILLING_ERROR_CODES.idempotencyKeyRequired,
        }),
      }),
    });
  });

  it("returns validation failure rather than not-found for invalid prepaid amount", async () => {
    const controller = new BillingCustomerController(
      { execute: jest.fn() } as never,
      { execute: jest.fn() } as never,
    );
    await expect(
      controller.order({ amount_vnd: "not-a-number" }, "valid-key", request),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({
        problem: expect.objectContaining({
          code: BILLING_ERROR_CODES.validationFailed,
        }),
      }),
    });
  });
});
