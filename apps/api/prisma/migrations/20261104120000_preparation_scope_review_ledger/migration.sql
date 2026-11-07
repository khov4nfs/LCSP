-- Versioned, source-pinned human review; full inventory is never rewritten.
CREATE TYPE "PreparationTargetActivityScope" AS ENUM ('FULL_SOURCE', 'DEVELOPMENT_ONLY');
CREATE TYPE "PreparationScopeReviewState" AS ENUM ('DRAFT','APPROVED','REJECTED');
ALTER TABLE "RuleSetPreparationRun" ADD COLUMN "scopeReviewRequested" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "ComplianceRuleSetVersion" ADD COLUMN "targetActivityScope" "PreparationTargetActivityScope" NOT NULL DEFAULT 'FULL_SOURCE';
ALTER TABLE "RuleSetPreparationRun" ADD COLUMN "targetActivityScope" "PreparationTargetActivityScope" NOT NULL DEFAULT 'FULL_SOURCE';
CREATE TABLE "RuleSetPreparationScopeReview" (
 "preparationRunId" TEXT NOT NULL,
 "inventoryRevision" INTEGER NOT NULL,
 "legalSourceVersionId" TEXT NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1,
 "state" "PreparationScopeReviewState" NOT NULL DEFAULT 'DRAFT',
 "inventoryFingerprint" TEXT NOT NULL,
 "graphDigest" TEXT NOT NULL,
 "decisionDigest" TEXT NOT NULL,
 "decisions" JSONB NOT NULL,
 "projection" JSONB NOT NULL,
 "submittedBy" TEXT NOT NULL,
 "approvedBy" TEXT,
 "approvedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "RuleSetPreparationScopeReview_pkey" PRIMARY KEY ("preparationRunId","inventoryRevision"),
 CONSTRAINT "RuleSetPreparationScopeReview_run_source_fkey" FOREIGN KEY ("preparationRunId","legalSourceVersionId") REFERENCES "RuleSetPreparationRun" ("id","legalSourceVersionId") ON UPDATE RESTRICT ON DELETE RESTRICT,
 CONSTRAINT "RuleSetPreparationScopeReview_inventory_fkey" FOREIGN KEY ("preparationRunId","inventoryRevision") REFERENCES "RuleSetPreparationClaimInventory" ("preparationRunId","revision") ON UPDATE RESTRICT ON DELETE RESTRICT,
 CONSTRAINT "RuleSetPreparationScopeReview_approval_consistency_check" CHECK (("state" = 'APPROVED' AND "approvedBy" IS NOT NULL AND "approvedAt" IS NOT NULL) OR ("state" <> 'APPROVED' AND "approvedBy" IS NULL AND "approvedAt" IS NULL))
);
CREATE INDEX "RuleSetPreparationScopeReview_source_state_idx" ON "RuleSetPreparationScopeReview" ("legalSourceVersionId","state");
