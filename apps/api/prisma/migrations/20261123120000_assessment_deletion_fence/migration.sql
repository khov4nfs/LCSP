-- A deletion fence survives the revocation transaction and binds cleanup to
-- the owner that authorized it. The composite FK rejects owner changes while
-- external runtime, storage, log and billing cleanup is in flight.
CREATE UNIQUE INDEX "Assessment_id_ownerId_key"
ON "Assessment"("id", "ownerId");

CREATE TABLE "AssessmentDeletionFence" (
  "assessmentId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseExpiresAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "AssessmentDeletionFence_pkey" PRIMARY KEY ("assessmentId")
);

CREATE UNIQUE INDEX "AssessmentDeletionFence_token_key"
ON "AssessmentDeletionFence"("token");

-- Keep the complete relation tuple explicitly unique so Prisma and PostgreSQL
-- agree that one assessment-owner pair owns at most one deletion fence.
CREATE UNIQUE INDEX "AssessmentDeletionFence_assessmentId_ownerId_key"
ON "AssessmentDeletionFence"("assessmentId", "ownerId");

CREATE INDEX "AssessmentDeletionFence_ownerId_startedAt_idx"
ON "AssessmentDeletionFence"("ownerId", "startedAt");

ALTER TABLE "AssessmentDeletionFence"
ADD CONSTRAINT "AssessmentDeletionFence_assessmentId_ownerId_fkey"
FOREIGN KEY ("assessmentId", "ownerId")
REFERENCES "Assessment"("id", "ownerId")
ON DELETE CASCADE
ON UPDATE RESTRICT;
