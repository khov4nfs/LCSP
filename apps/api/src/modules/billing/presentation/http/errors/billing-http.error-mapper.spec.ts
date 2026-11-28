import { describe, expect, it } from "@jest/globals";
import { HttpException, HttpStatus } from "@nestjs/common";
import { BILLING_ERROR_CODES } from "@lcsp/contracts/billing";
import {
  BillingConcurrencyError,
  BillingIdempotencyConflictError,
  InvalidBillingInputError,
  ModelPricingImmutableSnapshotError,
  ModelPricingIncompleteRatesError,
  ModelPricingInvalidIntervalError,
  ModelPricingInvalidStateError,
  ModelPricingNoCoverageError,
  ModelPricingNotFoundError,
  ModelPricingOverlapConflictError,
  ModelPricingStaleDraftError,
  ModelPricingUnlistedModelError,
} from "../../../domain/billing.errors.js";
import type { AuthenticatedRequest } from "../../../../../platform/rbac/interfaces/authenticated-request.interface.js";
import { mapModelPricingError } from "./billing-http.error-mapper.js";

describe("mapModelPricingError", () => {
  const req = {
    correlationId: "corr-err-1",
  } as unknown as AuthenticatedRequest;

  const cases: Array<[Error, number, string]> = [
    [
      new ModelPricingNotFoundError("not found"),
      HttpStatus.NOT_FOUND,
      BILLING_ERROR_CODES.modelPricingNotFound,
    ],
    [
      new ModelPricingOverlapConflictError("overlap"),
      HttpStatus.CONFLICT,
      BILLING_ERROR_CODES.modelPricingOverlapConflict,
    ],
    [
      new ModelPricingImmutableSnapshotError("immutable"),
      HttpStatus.CONFLICT,
      BILLING_ERROR_CODES.modelPricingImmutableSnapshot,
    ],
    [
      new ModelPricingStaleDraftError("stale"),
      HttpStatus.CONFLICT,
      BILLING_ERROR_CODES.modelPricingStaleDraft,
    ],
    [
      new ModelPricingInvalidStateError("invalid state"),
      HttpStatus.CONFLICT,
      BILLING_ERROR_CODES.modelPricingInvalidState,
    ],
    [
      new BillingIdempotencyConflictError("idempotency conflict"),
      HttpStatus.CONFLICT,
      BILLING_ERROR_CODES.idempotencyConflict,
    ],
    [
      new BillingConcurrencyError("concurrency"),
      HttpStatus.CONFLICT,
      BILLING_ERROR_CODES.concurrencyConflict,
    ],
    [
      new ModelPricingUnlistedModelError("unlisted"),
      HttpStatus.UNPROCESSABLE_ENTITY,
      BILLING_ERROR_CODES.modelPricingUnlistedModel,
    ],
    [
      new ModelPricingIncompleteRatesError("incomplete"),
      HttpStatus.UNPROCESSABLE_ENTITY,
      BILLING_ERROR_CODES.modelPricingIncompleteRates,
    ],
    [
      new ModelPricingInvalidIntervalError("interval"),
      HttpStatus.UNPROCESSABLE_ENTITY,
      BILLING_ERROR_CODES.modelPricingInvalidInterval,
    ],
    [
      new ModelPricingNoCoverageError("no coverage"),
      HttpStatus.UNPROCESSABLE_ENTITY,
      BILLING_ERROR_CODES.modelPricingNoCoverage,
    ],
    [
      new InvalidBillingInputError("bad input"),
      HttpStatus.BAD_REQUEST,
      BILLING_ERROR_CODES.validationFailed,
    ],
  ];

  it("maps every ModelPricingDomainError and Billing conflict error to matching HTTP status and RFC 7807 code", () => {
    for (const [domainError, expectedStatus, expectedCode] of cases) {
      let caught: unknown;
      try {
        mapModelPricingError(domainError, req);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(HttpException);
      const httpErr = caught as HttpException;
      expect(httpErr.getStatus()).toBe(expectedStatus);
      const body = httpErr.getResponse() as {
        ok: false;
        problem: { status: number; code: string; correlationId: string };
      };
      expect(body.ok).toBe(false);
      expect(body.problem.status).toBe(expectedStatus);
      expect(body.problem.code).toBe(expectedCode);
      expect(body.problem.correlationId).toBe("corr-err-1");
    }
  });

  it("rethrows unknown non-domain errors for global HttpExceptionFilter masking", () => {
    const unknown = new Error("unexpected pg socket failure");
    expect(() => mapModelPricingError(unknown, req)).toThrow(unknown);
  });
});
