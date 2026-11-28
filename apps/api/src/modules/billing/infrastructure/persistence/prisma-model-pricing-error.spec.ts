import { describe, expect, it } from "@jest/globals";
import {
  BillingConcurrencyError,
  BillingIdempotencyConflictError,
  InvalidBillingInputError,
  ModelPricingImmutableSnapshotError,
  ModelPricingIncompleteRatesError,
  ModelPricingInvalidIntervalError,
  ModelPricingNotFoundError,
  ModelPricingOverlapConflictError,
} from "../../domain/billing.errors.js";
import {
  extractPostgresErrorMetadata,
  isRetryableTransactionConflict,
  mapPrismaModelPricingPersistenceError,
} from "./prisma-model-pricing-error.js";

describe("prisma-model-pricing-error", () => {
  it("extracts SQLSTATE across direct DriverAdapterError and PrismaClientKnownRequestError meta paths", () => {
    const driverAdapterErr = {
      message: "DriverAdapterError",
      cause: {
        kind: "postgres",
        originalCode: "23P01",
        originalMessage:
          'conflicting key value violates exclusion constraint "CustomerModelTariffAssignment_no_overlap"',
      },
    };
    expect(extractPostgresErrorMetadata(driverAdapterErr).pgCode).toBe("23P01");

    const rawKnownErr = {
      code: "P2010",
      meta: {
        driverAdapterError: {
          cause: {
            originalCode: "P0001",
            originalMessage: "CustomerModelTariffSnapshot rows are append-only",
          },
        },
      },
    };
    const meta = extractPostgresErrorMetadata(rawKnownErr);
    expect(meta.prismaCode).toBe("P2010");
    expect(meta.pgCode).toBe("P0001");
  });

  it("maps 23P01, P0001, 23514, P2002, P2025, and P2034/40001 into typed domain errors without leaking raw PG details", () => {
    expect(() =>
      mapPrismaModelPricingPersistenceError({
        cause: {
          originalCode: "23P01",
          originalMessage: "CustomerModelTariffAssignment_no_overlap",
          detail: "Key (normalizedScopeKey)=(...) conflicts",
        },
      }),
    ).toThrow(ModelPricingOverlapConflictError);

    expect(() =>
      mapPrismaModelPricingPersistenceError({
        cause: {
          originalCode: "P0001",
          originalMessage: "CustomerModelTariffSnapshot rows are append-only",
        },
      }),
    ).toThrow(ModelPricingImmutableSnapshotError);

    expect(() =>
      mapPrismaModelPricingPersistenceError({
        cause: {
          originalCode: "23514",
          originalMessage:
            'violates check constraint "CustomerModelTariffAssignment_interval_valid"',
        },
      }),
    ).toThrow(ModelPricingInvalidIntervalError);

    expect(() =>
      mapPrismaModelPricingPersistenceError({
        cause: {
          originalCode: "23514",
          originalMessage:
            'violates check constraint "CustomerModelTariffSnapshot_rates_non_negative"',
        },
      }),
    ).toThrow(ModelPricingIncompleteRatesError);

    expect(() =>
      mapPrismaModelPricingPersistenceError({
        cause: {
          originalCode: "23514",
          originalMessage:
            'violates check constraint "CustomerModelTariffDraft_scope_identity_check"',
        },
      }),
    ).toThrow(InvalidBillingInputError);

    expect(() =>
      mapPrismaModelPricingPersistenceError({
        code: "P2002",
        meta: { target: ["idempotencyKey"] },
      }),
    ).toThrow(BillingIdempotencyConflictError);

    expect(() =>
      mapPrismaModelPricingPersistenceError({
        code: "P2025",
        meta: { modelName: "CustomerModelTariffDraft" },
      }),
    ).toThrow(ModelPricingNotFoundError);

    const conflictErr = {
      code: "P2034",
      meta: { driverAdapterError: { cause: { originalCode: "40001" } } },
    };
    expect(isRetryableTransactionConflict(conflictErr)).toBe(true);
    expect(() => mapPrismaModelPricingPersistenceError(conflictErr)).toThrow(
      BillingConcurrencyError,
    );
  });
});
