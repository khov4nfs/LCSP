ALTER TABLE "ModelPricingSnapshot"
  ADD COLUMN "cachedInputPricePerMillion" DECIMAL(20,8),
  ADD COLUMN "cacheWritePricePerMillion" DECIMAL(20,8),
  ADD COLUMN "reasoningPricePerMillion" DECIMAL(20,8),
  ADD COLUMN "providerCurrency" TEXT,
  ADD COLUMN "customerCurrency" TEXT,
  ADD COLUMN "markupBps" BIGINT,
  ADD COLUMN "fxRateVndNumerator" BIGINT,
  ADD COLUMN "fxRateVndDenominator" BIGINT;

-- Preserve historical immutable snapshots as legacy records.  They remain
-- reproducible through existing usage references, but new settlement rejects
-- any row without the complete composite authority below.

ALTER TABLE "LlmUsageEvent"
  ADD COLUMN "cacheWriteTokens" BIGINT,
  ADD COLUMN "providerCostCredits" BIGINT,
  ADD COLUMN "customerChargeVnd" BIGINT,
  ADD COLUMN "runtimePolicySnapshotId" TEXT;

CREATE TABLE "RuntimeModelPolicySnapshot" (
  "id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RuntimeModelPolicySnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RuntimeModelPolicySnapshot_role_policyVersion_key"
  ON "RuntimeModelPolicySnapshot"("role", "policyVersion");
CREATE INDEX "RuntimeModelPolicySnapshot_role_effectiveAt_idx"
  ON "RuntimeModelPolicySnapshot"("role", "effectiveAt");

ALTER TABLE "LlmUsageEvent"
  ADD CONSTRAINT "LlmUsageEvent_runtimePolicySnapshotId_fkey"
  FOREIGN KEY ("runtimePolicySnapshotId") REFERENCES "RuntimeModelPolicySnapshot"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "prevent_runtime_model_policy_snapshot_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'RuntimeModelPolicySnapshot rows are append-only';
END;
$$;
CREATE TRIGGER "RuntimeModelPolicySnapshot_immutable"
BEFORE UPDATE OR DELETE ON "RuntimeModelPolicySnapshot"
FOR EACH ROW EXECUTE FUNCTION "prevent_runtime_model_policy_snapshot_mutation"();
