ALTER TABLE "VerifiedProfile"
  ADD COLUMN "wizardProfileId" TEXT,
  ADD COLUMN "technicalEvidenceReportId" TEXT,
  ADD COLUMN "reconciliationDecisionRefs" JSONB,
  ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "VerifiedProfile_organizationId_idempotencyKey_key"
  ON "VerifiedProfile"("organizationId", "idempotencyKey");
