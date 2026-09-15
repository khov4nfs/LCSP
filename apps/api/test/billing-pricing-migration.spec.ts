import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(
  new URL(
    "../prisma/migrations/20260913100000_lcsp_311_billing_usage_dimensions/migration.sql",
    import.meta.url,
  ),
);

describe("LCSP-311 pricing migration upgrade path", () => {
  it("preserves legacy pricing rows while adding nullable composite authority fields", () => {
    const migration = readFileSync(migrationPath, "utf8");
    const pricingUpgrade = migration.split('ALTER TABLE "LlmUsageEvent"')[0];
    expect(pricingUpgrade).toContain('ADD COLUMN "providerCurrency" TEXT');
    expect(pricingUpgrade).toContain('ADD COLUMN "customerCurrency" TEXT');
    expect(pricingUpgrade).toContain('ADD COLUMN "markupBps" BIGINT');
    expect(pricingUpgrade).not.toContain(
      'ALTER COLUMN "providerCurrency" SET NOT NULL',
    );
    expect(pricingUpgrade).not.toContain("RAISE EXCEPTION");
  });
});
