CREATE TYPE "AssessmentDiscoveryRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "AssessmentDiscoveryRun" (
    "runId" UUID NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "status" "AssessmentDiscoveryRunStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "repositorySnapshotId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "repositoryCommit" TEXT NOT NULL,
    "sourcePathPrefix" TEXT,
    "repositoryScanJobId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "leaseToken" UUID,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "discoveryRecordId" UUID,
    "workerContentDigest" TEXT,
    "errorCode" TEXT,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AssessmentDiscoveryRun_pkey" PRIMARY KEY ("runId")
);

CREATE UNIQUE INDEX "AssessmentDiscoveryRun_assessmentId_idempotencyKey_key"
ON "AssessmentDiscoveryRun"("assessmentId", "idempotencyKey");

CREATE INDEX "AssessmentDiscoveryRun_assessmentId_requestedAt_idx"
ON "AssessmentDiscoveryRun"("assessmentId", "requestedAt" DESC);

CREATE INDEX "AssessmentDiscoveryRun_status_leaseExpiresAt_idx"
ON "AssessmentDiscoveryRun"("status", "leaseExpiresAt");

ALTER TABLE "AssessmentDiscoveryRun"
ADD CONSTRAINT "AssessmentDiscoveryRun_assessmentId_fkey"
FOREIGN KEY ("assessmentId") REFERENCES "AssessmentCase"("assessmentId")
ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE "AssessmentDiscoveryRun"
ADD CONSTRAINT "AssessmentDiscoveryRun_discoveryRecordId_assessmentId_fkey"
FOREIGN KEY ("discoveryRecordId", "assessmentId")
REFERENCES "AssessmentRepositoryDiscovery"("recordId", "assessmentId")
ON DELETE RESTRICT ON UPDATE RESTRICT;