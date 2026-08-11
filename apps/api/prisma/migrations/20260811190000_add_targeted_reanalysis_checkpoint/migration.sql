CREATE TYPE "TargetedReanalysisCheckpointState" AS ENUM (
  'PENDING_DISPATCH',
  'DISPATCHED',
  'RUNNING',
  'RETRY_SCHEDULED',
  'COMPLETED',
  'FAILED',
  'DLQ'
);

CREATE TABLE "TargetedReanalysisCheckpoint" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "state" "TargetedReanalysisCheckpointState" NOT NULL DEFAULT 'PENDING_DISPATCH',
  "apiPublishAttempts" INTEGER NOT NULL DEFAULT 0,
  "workerDeliveryAttempts" INTEGER NOT NULL DEFAULT 0,
  "outputEvidenceReportId" TEXT,
  "safeFailureCode" TEXT,
  "correlationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TargetedReanalysisCheckpoint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TargetedReanalysisCheckpoint_requestId_key"
  ON "TargetedReanalysisCheckpoint"("requestId");
CREATE INDEX "TargetedReanalysisCheckpoint_state_updatedAt_idx"
  ON "TargetedReanalysisCheckpoint"("state", "updatedAt");

ALTER TABLE "TargetedReanalysisCheckpoint"
  ADD CONSTRAINT "TargetedReanalysisCheckpoint_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "TargetedReanalysisRequest"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
