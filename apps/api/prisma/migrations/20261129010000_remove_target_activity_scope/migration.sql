-- Safe additive/cleanup migration for LCSP-424:
-- Remove redundant PreparationTargetActivityScope enum and targetActivityScope / scopeReviewRequested columns
-- while preserving all historical RuleSetPreparationScopeReview, SelectedRuleScopeAuthorization,
-- ComplianceRuleSetVersion, LegalRuleCatalogVersion, and Assessment rows.

-- Recover any historical Preparation runs paused on the removed Scope Review hold
-- into a resumable FAILED (RUNTIME_ERROR) state while preserving all source pins,
-- frozen inventories, drafts, and review history. Never mark SUCCEEDED or fabricate approval.
UPDATE "RuleSetPreparationRun"
SET "executionState" = 'FAILED',
    "failureReason" = 'RUNTIME_ERROR'
WHERE "executionState" = 'PAUSED'
  AND "scopeReviewRequested" = true
  AND "failureReason" IS NULL;

ALTER TABLE "RuleSetPreparationRun"
  DROP COLUMN IF EXISTS "targetActivityScope",
  DROP COLUMN IF EXISTS "scopeReviewRequested";

ALTER TABLE "ComplianceRuleSetVersion"
  DROP COLUMN IF EXISTS "targetActivityScope";

DROP TYPE IF EXISTS "PreparationTargetActivityScope";
