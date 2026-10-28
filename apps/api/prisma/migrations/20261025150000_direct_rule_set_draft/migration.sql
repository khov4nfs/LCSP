-- Preserve historical execution contracts, source pins, and accepted drafts.
CREATE TYPE "PreparationExecutionContract" AS ENUM ('CLAIM_INVENTORY_V1', 'DIRECT_DRAFT_V1');
ALTER TABLE "RuleSetPreparationRun"
  ADD COLUMN "executionContract" "PreparationExecutionContract" NOT NULL DEFAULT 'CLAIM_INVENTORY_V1';
CREATE TYPE "LegalApplicabilityMode" AS ENUM ('UNCONDITIONAL', 'CONDITIONAL');
ALTER TABLE "LegalRequirement" ADD COLUMN "applicabilityMode" "LegalApplicabilityMode";
ALTER TABLE "RuleSetPreparationRun" ADD COLUMN "targetDate" DATE;
