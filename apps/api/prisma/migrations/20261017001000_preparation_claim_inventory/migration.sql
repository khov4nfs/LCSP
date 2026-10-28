-- Additive protocol state. Historical Rule Sets, source content and Assessment pins are untouched.
CREATE TYPE "ClaimPreparationPhase" AS ENUM ('CLAIM_DISCOVERY','CLAIM_INVENTORY_VALIDATION','CLAIM_INVENTORY_READY','RULE_AUTHORING','RULE_VALIDATION','SUBMISSION_READY','COMPLETION');
ALTER TABLE "RuleSetPreparationRun" ADD COLUMN "claimPhase" "ClaimPreparationPhase" NOT NULL DEFAULT 'CLAIM_DISCOVERY', ADD COLUMN "claimInventoryRevision" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "claimInventoryReopenReason" TEXT;
ALTER TABLE "RuleSetPreparationRun" ADD CONSTRAINT "Preparation_inventory_revision_check" CHECK ("claimInventoryRevision">0);
CREATE TABLE "RuleSetPreparationClaimInventory" (
 "preparationRunId" TEXT NOT NULL,
 "revision" INTEGER NOT NULL,
 "fingerprint" TEXT NOT NULL,
 "graphDigest" TEXT NOT NULL,
 "graph" JSONB NOT NULL,
 "identities" JSONB NOT NULL,
 "reopenReason" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "RuleSetPreparationClaimInventory_pkey" PRIMARY KEY ("preparationRunId","revision"),
 CONSTRAINT "RuleSetPreparationClaimInventory_preparationRunId_fkey" FOREIGN KEY ("preparationRunId") REFERENCES "RuleSetPreparationRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "Preparation_inventory_shape_check" CHECK ("revision">0 AND "fingerprint" ~ '^[a-f0-9]{64}$' AND "graphDigest" ~ '^[a-f0-9]{64}$' AND jsonb_typeof("graph")='object' AND jsonb_typeof("identities")='object')
);
CREATE INDEX "RuleSetPreparationClaimInventory_preparationRunId_fingerprint_idx" ON "RuleSetPreparationClaimInventory"("preparationRunId","fingerprint");
CREATE FUNCTION "lcsp_frozen_claim_inventory_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Frozen claim inventory is immutable; reopen a new revision'; END $$;
CREATE TRIGGER "RuleSetPreparationClaimInventory_immutable" BEFORE UPDATE OR DELETE ON "RuleSetPreparationClaimInventory" FOR EACH ROW EXECUTE FUNCTION "lcsp_frozen_claim_inventory_immutable"();
