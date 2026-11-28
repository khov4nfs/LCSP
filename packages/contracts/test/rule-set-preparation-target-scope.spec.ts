import { describe, expect, it } from "@jest/globals";
import {
  ruleSetPreparationAdminRequestSchema,
  ruleSetPreparationLegalSourceBundleSchema,
  ruleSetPreparationStartRequestSchema,
} from "../src/compliance-rule-set/schemas.ts";

describe("Rule Set Preparation unified scope contract", () => {
  it("keeps responseLanguage server-owned and omits removed activity scope fields from the worker bundle", () => {
    const shape = ruleSetPreparationLegalSourceBundleSchema.shape as Record<
      string,
      unknown
    >;
    expect(shape.targetActivityScope).toBeUndefined();
    expect(shape.scopeReviewRequested).toBeUndefined();
    expect(shape.approvedScopeDigest).toBeUndefined();
    const responseLanguage =
      ruleSetPreparationLegalSourceBundleSchema.shape.responseLanguage;
    expect(responseLanguage.parse(undefined)).toBe("vi");
    expect(responseLanguage.parse("vi")).toBe("vi");
    expect(responseLanguage.parse("en")).toBe("en");
    expect(responseLanguage.safeParse("fr").success).toBe(false);
  });

  it("rejects removed targetActivityScope and approvedScopeDigest fields at preparation start and admin boundaries", () => {
    const start = {
      legalSourceVersionId: "11111111-1111-4111-8111-111111111111",
      idempotencyKey: "test-preparation-scope-1",
    };
    expect(ruleSetPreparationStartRequestSchema.safeParse(start).success).toBe(
      true,
    );
    for (const scope of ["FULL_SOURCE", "DEVELOPMENT_ONLY", "OPERATION_ONLY"]) {
      expect(
        ruleSetPreparationStartRequestSchema.safeParse({
          ...start,
          targetActivityScope: scope,
        }).success,
      ).toBe(false);
      expect(
        ruleSetPreparationAdminRequestSchema.safeParse({
          targetActivityScope: scope,
        }).success,
      ).toBe(false);
    }
    expect(
      ruleSetPreparationAdminRequestSchema.safeParse({
        approvedScopeDigest: "a".repeat(64),
      }).success,
    ).toBe(false);
  });
});
