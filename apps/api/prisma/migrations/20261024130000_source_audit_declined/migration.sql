-- Enum additions are committed before application code uses the new values.
ALTER TYPE "SourceReviewState" ADD VALUE 'AUDIT_DECLINED';
ALTER TYPE "SourceReviewDisposition" ADD VALUE 'AUDIT_DECLINED';
ALTER TABLE "RuleSetPreparationReviewFrontier" ADD COLUMN "auditDeclinedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RuleSetPreparationClaimInventory" ADD COLUMN "auditDeclined" JSONB NOT NULL DEFAULT '[]';
