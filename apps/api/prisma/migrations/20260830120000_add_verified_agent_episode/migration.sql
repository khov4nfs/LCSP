CREATE TABLE "VerifiedAgentEpisode" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "ownerAgent" TEXT NOT NULL,
    "workflowRunId" TEXT,
    "engineeringRuleIds" TEXT[],
    "artifactVersions" JSONB NOT NULL,
    "trustLevel" TEXT NOT NULL,
    "validationStatus" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "domainKey" TEXT NOT NULL,
    "inputSignature" TEXT NOT NULL,
    "successfulStrategySummary" TEXT NOT NULL,
    "evidenceRefs" TEXT[] NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "handoffJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerifiedAgentEpisode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VerifiedAgentEpisode_assessmentId_contentHash_key" ON "VerifiedAgentEpisode"("assessmentId", "contentHash");
CREATE INDEX "VerifiedAgentEpisode_assessmentId_ownerAgent_status_createdAt_idx" ON "VerifiedAgentEpisode"("assessmentId", "ownerAgent", "status", "createdAt");
CREATE INDEX "VerifiedAgentEpisode_assessmentId_ownerAgent_contentHash_idx" ON "VerifiedAgentEpisode"("assessmentId", "ownerAgent", "contentHash");

ALTER TABLE "VerifiedAgentEpisode" ADD CONSTRAINT "VerifiedAgentEpisode_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
