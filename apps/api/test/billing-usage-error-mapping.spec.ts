import { describe, expect, it } from "@jest/globals";
import { HttpStatus } from "@nestjs/common";
import { BILLING_ERROR_CODES } from "@lcsp/contracts/billing";
import { mapUsageError } from "../src/modules/billing/presentation/http/errors/billing-http.error-mapper.js";
import {
  BillingDomainError,
  BillingIdempotencyConflictError,
  OwnershipMismatchError,
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
  it("reports other domain failures as caller validation problems", () => {
    const problem = problemOf(
      mapUsageError(new BillingDomainError("Usage identity is required")),
    );

    expect(problem.code).toBe(BILLING_ERROR_CODES.validationFailed);
    expect(problem.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it("maps a differing usage replay to a conflict", () => {
    const problem = problemOf(
      mapUsageError(
        new BillingIdempotencyConflictError("Usage replay differs"),
      ),
    );

    expect(problem.code).toBe(BILLING_ERROR_CODES.idempotencyConflict);
    expect(problem.status).toBe(HttpStatus.CONFLICT);
  });

  it("maps an unknown assessment owner to forbidden", () => {
    const problem = problemOf(
      mapUsageError(new OwnershipMismatchError("Assessment does not exist")),
    );

    expect(problem.code).toBe(BILLING_ERROR_CODES.ownershipMismatch);
    expect(problem.status).toBe(HttpStatus.FORBIDDEN);
  });

  it("never exposes a model-credit or pricing problem code", () => {
    expect(Object.values(BILLING_ERROR_CODES)).not.toContain(
      "BILLING_INSUFFICIENT_CREDITS",
    );
    expect(Object.values(BILLING_ERROR_CODES)).not.toContain(
      "BILLING_PRICING_UNAVAILABLE",
    );
  });
});
