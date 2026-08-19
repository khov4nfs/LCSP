-- Add STALE status to VerifiedProfileStatus enum
ALTER TYPE "VerifiedProfileStatus" ADD VALUE IF NOT EXISTS 'STALE';

-- Drop unique constraint on aiUsageFlowId (now allowing multiple versions per flow)
DROP INDEX IF EXISTS "VerifiedProfile_aiUsageFlowId_key";

-- Add non-unique index on aiUsageFlowId for query performance
CREATE INDEX IF NOT EXISTS "VerifiedProfile_aiUsageFlowId_idx" ON "VerifiedProfile"("aiUsageFlowId");

-- Add unique constraint on (assessmentId, version) to enforce monotonic version lineage
CREATE UNIQUE INDEX IF NOT EXISTS "VerifiedProfile_assessmentId_version_key" ON "VerifiedProfile"("assessmentId", "version");
