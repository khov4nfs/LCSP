-- Reusable source-bound authorization; existing runs, approvals and versions remain unchanged.
CREATE TABLE "SelectedRuleScopeAuthorization" (
  "scopeKey" TEXT NOT NULL,
  "legalSourceVersionId" TEXT NOT NULL,
  "catalogId" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "state" "PreparationScopeReviewState" NOT NULL DEFAULT 'DRAFT',
  "output" JSONB NOT NULL,
  "decisions" JSONB NOT NULL,
  "decisionDigest" TEXT NOT NULL,
  "submittedBy" TEXT NOT NULL,
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SelectedRuleScopeAuthorization_pkey" PRIMARY KEY ("scopeKey"),
  CONSTRAINT "SelectedRuleScopeAuthorization_source_fkey" FOREIGN KEY ("legalSourceVersionId") REFERENCES "LegalSourceVersion" ("id") ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT "SelectedRuleScopeAuthorization_approval_check" CHECK (
    ("state" = 'APPROVED' AND "approvedBy" IS NOT NULL AND "approvedBy" <> "submittedBy" AND "approvedAt" IS NOT NULL)
    OR ("state" <> 'APPROVED' AND "approvedBy" IS NULL AND "approvedAt" IS NULL)
  )
);
CREATE INDEX "SelectedRuleScopeAuthorization_source_state_idx" ON "SelectedRuleScopeAuthorization" ("legalSourceVersionId", "state");
CREATE INDEX "SelectedRuleScopeAuthorization_catalog_rule_idx" ON "SelectedRuleScopeAuthorization" ("catalogId", "ruleId");
-- A committed approval cannot be rewritten. Source lifecycle deletion still owns
-- removal of the source version and its dependent authority records.
CREATE FUNCTION lcsp_selected_scope_approved_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."state" = 'APPROVED' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'approved selected scope authority is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "SelectedRuleScopeAuthorization_immutable" BEFORE UPDATE ON "SelectedRuleScopeAuthorization"
FOR EACH ROW EXECUTE FUNCTION lcsp_selected_scope_approved_immutable();
