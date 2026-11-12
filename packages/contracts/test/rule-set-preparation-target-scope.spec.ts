import { describe, expect, it } from "@jest/globals";
import {
  ruleSetPreparationAdminRequestSchema,
  ruleSetPreparationLegalSourceBundleSchema,
  ruleSetPreparationStartRequestSchema,
} from "../src/compliance-rule-set/schemas.ts";
import { PREPARATION_ACTIVITY_SCOPES } from "../src/compliance-rule-set/scope-review.ts";

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

  it("allows requesting reviewed activity scopes at preparation start while rejecting unsupported scopes", () => {
    const start = {
      legalSourceVersionId: "11111111-1111-4111-8111-111111111111",
      idempotencyKey: "test-preparation-scope-1",
    };
    expect(ruleSetPreparationStartRequestSchema.safeParse(start).success).toBe(
      true,
    );
    for (const scope of PREPARATION_ACTIVITY_SCOPES) {
      expect(
        ruleSetPreparationStartRequestSchema.safeParse({
          ...start,
          targetActivityScope: scope,
        }).success,
      ).toBe(true);
      expect(
        ruleSetPreparationAdminRequestSchema.safeParse({
          targetActivityScope: scope,
        }).success,
      ).toBe(true);
    }
    expect(
      ruleSetPreparationStartRequestSchema.safeParse({
        ...start,
        targetActivityScope: "OPERATION_ONLY",
      }).success,
    ).toBe(false);
    expect(
      ruleSetPreparationAdminRequestSchema.safeParse({
        targetActivityScope: "OPERATION_ONLY",
      }).success,
    ).toBe(false);
    expect(
      ruleSetPreparationAdminRequestSchema.safeParse({
        approvedScopeDigest: "a".repeat(64),
      }).success,
    ).toBe(false);
  });
});
