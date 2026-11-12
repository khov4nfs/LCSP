CREATE TABLE "RuleCatalogGroupingProposal" (
  "ruleSetVersionId" TEXT PRIMARY KEY REFERENCES "ComplianceRuleSetVersion"("id") ON DELETE RESTRICT,
  "ruleSetDigest" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "state" "RuleCatalogReviewState" NOT NULL DEFAULT 'REVIEW_REQUIRED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
