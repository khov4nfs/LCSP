import { describe, expect, it } from "@jest/globals";
import { HttpStatus } from "@nestjs/common";
import { BILLING_ERROR_CODES } from "@lcsp/contracts/billing";
import { mapUsageError } from "../src/modules/billing/presentation/http/errors/billing-http.error-mapper.js";
import {
  BillingDomainError,
  InsufficientCreditError,
  PricingSnapshotUnavailableError,
} from "../src/modules/billing/domain/billing.errors.js";

/**
 * Reads the standardized problem body carried by a mapped usage error.
 *
 * @param error - Value returned by the usage error mapper.
 * @returns Problem payload describing the failure.
 */
function problemOf(error: unknown) {
  const response = (error as { getResponse: () => unknown }).getResponse();
  return (response as { problem: { code: string; status: number } }).problem;
}

describe("billing usage error mapping", () => {
  it("reports a missing pricing snapshot as a retryable provisioning gap", () => {
    const mapped = mapUsageError(
      new PricingSnapshotUnavailableError(
        "Pricing snapshot is required before reserving provider spend: OPENAI/gpt-4.1-nano",
      ),
    );

    const problem = problemOf(mapped);
    expect(problem.code).toBe(BILLING_ERROR_CODES.pricingUnavailable);
    expect(problem.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect((mapped as { getStatus: () => number }).getStatus()).toBe(
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  });

  it("still reports other domain failures as caller validation problems", () => {
    const problem = problemOf(
      mapUsageError(new BillingDomainError("Reservation amount is invalid")),
    );

    expect(problem.code).toBe(BILLING_ERROR_CODES.validationFailed);
    expect(problem.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it("keeps insufficient credit distinct from a pricing gap", () => {
    const problem = problemOf(
      mapUsageError(new InsufficientCreditError("Insufficient credits")),
    );

    expect(problem.code).toBe(BILLING_ERROR_CODES.insufficientCredits);
    expect(problem.status).toBe(HttpStatus.PAYMENT_REQUIRED);
  });
});
