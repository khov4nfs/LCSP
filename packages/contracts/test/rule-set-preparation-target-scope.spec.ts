import { describe, expect, it } from "@jest/globals";
import {
  ruleSetPreparationAdminRequestSchema,
  ruleSetPreparationLegalSourceBundleSchema,
  ruleSetPreparationStartRequestSchema,
} from "../src/compliance-rule-set/schemas.ts";

describe("Rule Set Preparation activity scope boundary", () => {
  it("keeps the worker bundle FULL_SOURCE by default for existing runs", () => {
    const scope =
      ruleSetPreparationLegalSourceBundleSchema.shape.targetActivityScope;
    expect(scope.parse(undefined)).toBe("FULL_SOURCE");
    expect(scope.parse("FULL_SOURCE")).toBe("FULL_SOURCE");
    expect(scope.parse("DEVELOPMENT_ONLY")).toBe("DEVELOPMENT_ONLY");
    expect(scope.safeParse("OPERATION_ONLY").success).toBe(false);
    const responseLanguage =
      ruleSetPreparationLegalSourceBundleSchema.shape.responseLanguage;
    expect(responseLanguage.parse(undefined)).toBe("vi");
    expect(responseLanguage.parse("vi")).toBe("vi");
    expect(responseLanguage.parse("en")).toBe("en");
    expect(responseLanguage.safeParse("fr").success).toBe(false);
  });

  it("does not allow an operator to self-authorize development-only activation", () => {
    const start = {
      legalSourceVersionId: "11111111-1111-4111-8111-111111111111",
      idempotencyKey: "test-preparation-scope-1",
    };
    expect(ruleSetPreparationStartRequestSchema.safeParse(start).success).toBe(
      true,
    );
    expect(
      ruleSetPreparationStartRequestSchema.safeParse({
        ...start,
        targetActivityScope: "DEVELOPMENT_ONLY",
      }).success,
    ).toBe(false);
    expect(
      ruleSetPreparationAdminRequestSchema.safeParse({
        targetActivityScope: "DEVELOPMENT_ONLY",
      }).success,
    ).toBe(false);
  });
});
