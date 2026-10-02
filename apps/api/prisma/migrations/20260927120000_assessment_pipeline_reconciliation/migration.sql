CREATE TABLE "AssessmentPipelineReconciliation" (
    "assessmentId" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),

    CONSTRAINT "AssessmentPipelineReconciliation_pkey" PRIMARY KEY ("assessmentId")
);

ALTER TABLE "AssessmentPipelineReconciliation" ADD CONSTRAINT "AssessmentPipelineReconciliation_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
