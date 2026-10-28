BEGIN;

DROP TABLE "RuleSetPreparationSemanticAudit";
ALTER TABLE "LegalSemanticGraph" DROP COLUMN "semanticAudits";
ALTER TABLE "RuleSetPreparationClaimInventory" DROP CONSTRAINT "ClaimInventory_audit_declined_array_check", DROP COLUMN "auditDeclined";
ALTER TABLE "RuleSetPreparationSourceReview" DROP CONSTRAINT "SourceReview_audit_declined_check", DROP CONSTRAINT "SourceReview_shape_check";
ALTER TABLE "RuleSetPreparationReviewFrontier" DROP CONSTRAINT "ReviewFrontier_shape_check";
DROP INDEX "SourceReview_in_review_idx";

-- The one-time data conversion includes frozen historical reviews; normal writes stay immutable.
ALTER TABLE "RuleSetPreparationSourceReview" DISABLE TRIGGER "SourceReview_frozen";
ALTER TABLE "RuleSetPreparationReviewFrontier" DISABLE TRIGGER "ReviewFrontier_frozen";
UPDATE "RuleSetPreparationSourceReview"
SET state = 'REVIEWED_NO_CLAIMS', disposition = 'NO_RELEVANT_SEMANTIC_CLAIMS'
WHERE state = 'AUDIT_DECLINED';
UPDATE "RuleSetPreparationSourceReview" SET disposition = 'NO_RELEVANT_SEMANTIC_CLAIMS' WHERE disposition = 'AUDIT_DECLINED';
UPDATE "RuleSetPreparationReviewFrontier"
SET "reviewedNoClaimsCount" = "reviewedNoClaimsCount" + "auditDeclinedCount"
WHERE "auditDeclinedCount" <> 0;
ALTER TABLE "RuleSetPreparationReviewFrontier" DROP COLUMN "auditDeclinedCount";
UPDATE "RuleSetPreparationSourceReview" SET payload = payload - 'semanticAudit' WHERE payload ? 'semanticAudit';
ALTER TABLE "RuleSetPreparationSourceReview" ENABLE TRIGGER "SourceReview_frozen";
ALTER TABLE "RuleSetPreparationReviewFrontier" ENABLE TRIGGER "ReviewFrontier_frozen";

ALTER TABLE "RuleSetPreparationSourceReview" ALTER COLUMN state DROP DEFAULT;
ALTER TYPE "SourceReviewState" RENAME TO "SourceReviewState_old";
CREATE TYPE "SourceReviewState" AS ENUM ('PENDING', 'IN_REVIEW', 'REVIEWED_WITH_CLAIMS', 'REVIEWED_NO_CLAIMS', 'BLOCKED_REFERENCE', 'REOPENED');
ALTER TABLE "RuleSetPreparationSourceReview" ALTER COLUMN state TYPE "SourceReviewState" USING state::text::"SourceReviewState";
ALTER TABLE "RuleSetPreparationSourceReview" ALTER COLUMN state SET DEFAULT 'PENDING';
DROP TYPE "SourceReviewState_old";
ALTER TYPE "SourceReviewDisposition" RENAME TO "SourceReviewDisposition_old";
CREATE TYPE "SourceReviewDisposition" AS ENUM ('CLAIMS_AUTHORED', 'NO_RELEVANT_SEMANTIC_CLAIMS', 'CONTEXT_ONLY', 'REQUIRES_REFERENCE_RESOLUTION');
ALTER TABLE "RuleSetPreparationSourceReview" ALTER COLUMN disposition TYPE "SourceReviewDisposition" USING disposition::text::"SourceReviewDisposition";
DROP TYPE "SourceReviewDisposition_old";

CREATE INDEX "SourceReview_in_review_idx" ON "RuleSetPreparationSourceReview" ("preparationRunId", "inventoryRevision", "operationId") WHERE state = 'IN_REVIEW';
ALTER TABLE "RuleSetPreparationReviewFrontier" ADD CONSTRAINT "ReviewFrontier_shape_check" CHECK (
 revision>0 AND "inventoryRevision">0 AND fingerprint ~ '^[a-f0-9]{64}$' AND "stateFingerprint" ~ '^[a-f0-9]{64}$' AND "stateAccumulator" ~ '^[a-f0-9]{64}$'
 AND "unitCount"="pendingCount"+"inReviewCount"+"reviewedWithClaimsCount"+"reviewedNoClaimsCount"+"blockedCount"
 AND LEAST("pendingCount","inReviewCount","reviewedWithClaimsCount","reviewedNoClaimsCount","blockedCount","persistedClaimCount")>=0);
ALTER TABLE "RuleSetPreparationSourceReview" ADD CONSTRAINT "SourceReview_shape_check" CHECK (
 "inventoryRevision">0 AND ordinal>=0 AND "ownedClaimCount"=jsonb_array_length(payload->'claims') AND "stateFingerprint" ~ '^[a-f0-9]{64}$'
 AND ((state='IN_REVIEW')=("operationId" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL))
 AND (state<>'REVIEWED_WITH_CLAIMS' OR (cardinality("claimIds")>0 AND disposition IN ('CLAIMS_AUTHORED','CONTEXT_ONLY') AND "completedAt" IS NOT NULL))
 AND (state<>'REVIEWED_NO_CLAIMS' OR (cardinality("claimIds")=0 AND disposition='NO_RELEVANT_SEMANTIC_CLAIMS' AND length(trim(reason))>0 AND "completedAt" IS NOT NULL))
 AND (state<>'BLOCKED_REFERENCE' OR (disposition='REQUIRES_REFERENCE_RESOLUTION'
  AND (cardinality("blockedReferenceIds")>0 OR jsonb_array_length(COALESCE(payload->'blockedSourceNodeIds','[]'::jsonb))>0)
  AND length(trim(reason))>0)));

COMMIT;
