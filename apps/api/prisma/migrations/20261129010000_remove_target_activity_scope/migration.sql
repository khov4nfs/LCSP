-- Safe additive/cleanup migration for LCSP-424:
-- Remove redundant PreparationTargetActivityScope enum and targetActivityScope / scopeReviewRequested columns
-- while preserving all historical RuleSetPreparationScopeReview, SelectedRuleScopeAuthorization,
-- ComplianceRuleSetVersion, LegalRuleCatalogVersion, and Assessment rows.

ALTER TABLE "RuleSetPreparationRun"
  DROP COLUMN IF EXISTS "targetActivityScope",
  DROP COLUMN IF EXISTS "scopeReviewRequested";

ALTER TABLE "ComplianceRuleSetVersion"
  DROP COLUMN IF EXISTS "targetActivityScope";

DROP TYPE IF EXISTS "PreparationTargetActivityScope";
