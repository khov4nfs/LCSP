CREATE TYPE "AssessmentRuntimeControlState" AS ENUM ('RUNNING', 'STOP_REQUESTED', 'STOPPED', 'RESUME_REQUESTED', 'COMPLETED');
CREATE TABLE "AssessmentRuntimeTurn" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "boundary" TEXT NOT NULL,
    "logicalRunId" TEXT NOT NULL,
    "workflowRunId" TEXT,
    "correlationId" TEXT NOT NULL,
    "state" "AssessmentRuntimeControlState" NOT NULL DEFAULT 'RUNNING',
    "requestId" TEXT,
    "contextJson" JSONB NOT NULL,
    "checkpointJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AssessmentRuntimeTurn_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AssessmentRuntimeTurn_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AssessmentRuntimeTurn_assessmentId_createdAt_idx" ON "AssessmentRuntimeTurn"("assessmentId", "createdAt");
