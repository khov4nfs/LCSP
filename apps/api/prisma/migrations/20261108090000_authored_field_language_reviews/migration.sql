CREATE TYPE "AuthoredSourceLanguage" AS ENUM ('EN', 'VI', 'MIXED', 'UNKNOWN');
ALTER TABLE "AuthoredLocalizationRequest"
  ADD COLUMN "sourceLanguage" "AuthoredSourceLanguage" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "sourceReviewedBy" TEXT,
  ADD COLUMN "sourceReviewedAt" TIMESTAMP(3),
  ADD COLUMN "translationReviewedBy" TEXT,
  ADD COLUMN "translationReviewedAt" TIMESTAMP(3);
-- Historical null/non-null hints are deliberately not promoted to verified provenance.
CREATE TABLE "AuthoredTranslationCandidate" (
  "requestId" TEXT PRIMARY KEY REFERENCES "AuthoredLocalizationRequest"("id") ON DELETE RESTRICT,
  "content" TEXT NOT NULL, "contentSha256" TEXT NOT NULL,
  "engine" TEXT NOT NULL, "engineVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "AuthoredLocalizationReview" (
  "id" TEXT PRIMARY KEY, "requestId" TEXT NOT NULL REFERENCES "AuthoredLocalizationRequest"("id") ON DELETE RESTRICT,
  "actorId" TEXT NOT NULL, "evidence" TEXT NOT NULL, "binding" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AuthoredLocalizationReview_requestId_createdAt_idx" ON "AuthoredLocalizationReview"("requestId", "createdAt");
CREATE FUNCTION lcsp_authored_language_review_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AUTHORED_LANGUAGE_REVIEW_IMMUTABLE' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER authored_language_review_immutable BEFORE UPDATE OR DELETE ON "AuthoredLocalizationReview"
FOR EACH ROW EXECUTE FUNCTION lcsp_authored_language_review_immutable();
CREATE TRIGGER authored_translation_candidate_immutable BEFORE UPDATE OR DELETE ON "AuthoredTranslationCandidate"
FOR EACH ROW EXECUTE FUNCTION lcsp_authored_language_review_immutable();
