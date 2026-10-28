-- Allow concurrent batch leases on review frontier
DROP INDEX IF EXISTS "SourceReview_one_in_review";
CREATE INDEX IF NOT EXISTS "SourceReview_in_review_idx" ON "RuleSetPreparationSourceReview" ("preparationRunId", "inventoryRevision", "operationId") WHERE state = 'IN_REVIEW';
