import { describe, expect, it, jest } from "@jest/globals";
import {
  BILLING_ERROR_CODES,
  BILLING_ESTIMATE_AVAILABILITY,
} from "@lcsp/contracts/billing";
import { InvalidBillingInputError } from "../src/modules/billing/domain/billing.errors.js";
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
  it("passes the authenticated customer and amount to the usage estimate query", async () => {
    const execute = jest
      .fn<
        (query: unknown) => Promise<{
          availability: (typeof BILLING_ESTIMATE_AVAILABILITY)["insufficientPricingConfiguration"];
          estimatedUsageChargeVnd: null;
        }>
      >()
      .mockResolvedValue({
        availability:
          BILLING_ESTIMATE_AVAILABILITY.insufficientPricingConfiguration,
        estimatedUsageChargeVnd: null,
      });
    const controller = new BillingCustomerController(
      { execute: jest.fn() } as never,
      { execute } as never,
    );

    await expect(controller.estimate("10000", request)).resolves.toMatchObject({
      ok: true,
      data: {
        availability:
          BILLING_ESTIMATE_AVAILABILITY.insufficientPricingConfiguration,
        estimatedUsageChargeVnd: null,
      },
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", amountVnd: 10000n }),
    );
  });

  it("maps asynchronously rejected numeric amounts that violate billing rules to 400", async () => {
    const execute = jest
      .fn<(query: unknown) => Promise<never>>()
      .mockRejectedValue(
        new InvalidBillingInputError("Invalid prepaid amount"),
      );
    const controller = new BillingCustomerController(
      { execute: jest.fn() } as never,
      { execute } as never,
    );

    await expect(controller.estimate("10001", request)).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({
        problem: expect.objectContaining({
          code: BILLING_ERROR_CODES.validationFailed,
        }),
      }),
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", amountVnd: 10001n }),
    );
  });

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
