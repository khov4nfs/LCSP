ALTER TABLE "VerifiedProfile"
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "VerifiedProfile_assessmentId_version_idx"
ON "VerifiedProfile"("assessmentId", "version");
