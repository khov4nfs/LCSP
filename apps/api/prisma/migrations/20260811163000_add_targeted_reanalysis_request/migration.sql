CREATE TYPE "TargetedReanalysisRequestState" AS ENUM (
  'QUEUED',
  'DISPATCHED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'DLQ'
);

ALTER TYPE "OutboxAggregateType" ADD VALUE IF NOT EXISTS 'TARGETED_REANALYSIS_REQUEST';

CREATE TABLE "TargetedReanalysisRequest" (
  "id" TEXT NOT NULL,
  "assessmentId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "inputEvidenceReportId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "commitSha" TEXT NOT NULL,
  "analyzerId" TEXT NOT NULL,
  "normalizedScope" JSONB NOT NULL,
  "reasonRequirementId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "state" "TargetedReanalysisRequestState" NOT NULL DEFAULT 'QUEUED',
  "apiPublishAttempts" INTEGER NOT NULL DEFAULT 0,
  "workerDeliveryAttempts" INTEGER NOT NULL DEFAULT 0,
  "checkpointRef" TEXT NOT NULL,
  "outputEvidenceReportId" TEXT,
  "safeFailureCode" TEXT,
  "correlationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TargetedReanalysisRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TargetedReanalysisRequest_organizationId_idempotencyKey_key"
ON "TargetedReanalysisRequest"("organizationId", "idempotencyKey");
CREATE INDEX "TargetedReanalysisRequest_organizationId_state_createdAt_idx"
ON "TargetedReanalysisRequest"("organizationId", "state", "createdAt");
CREATE INDEX "TargetedReanalysisRequest_assessmentId_createdAt_idx"
ON "TargetedReanalysisRequest"("assessmentId", "createdAt");
CREATE INDEX "TargetedReanalysisRequest_inputEvidenceReportId_idx"
ON "TargetedReanalysisRequest"("inputEvidenceReportId");
CREATE INDEX "TargetedReanalysisRequest_snapshotId_idx"
ON "TargetedReanalysisRequest"("snapshotId");
