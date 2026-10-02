import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pricingMigrationPath = fileURLToPath(
  new URL(
    "../prisma/migrations/20260913100000_lcsp_311_billing_usage_dimensions/migration.sql",
    import.meta.url,
  ),
);
const reservationUsageMigrationPath = fileURLToPath(
  new URL(
    "../prisma/migrations/20260924120000_drop_llm_usage_reservation_unique_index/migration.sql",
    import.meta.url,
  ),
);

describe("LCSP-311 pricing migration upgrade path", () => {
  it("preserves legacy pricing rows while adding nullable composite authority fields", () => {
    const migration = readFileSync(pricingMigrationPath, "utf8");
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

describe("LCSP-339 usage reservation migration upgrade path", () => {
  it("removes the stale reservation-only unique index instead of keeping one event per reservation", () => {
    const migration = readFileSync(reservationUsageMigrationPath, "utf8");
    expect(migration).toContain(
      'DROP INDEX IF EXISTS "LlmUsageEvent_reservationId_key"',
    );
    expect(migration).not.toContain(
      'CREATE UNIQUE INDEX "LlmUsageEvent_reservationId_key"',
    );
  });
});
