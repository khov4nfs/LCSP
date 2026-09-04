-- Persist governed Assessment Interview read model separately from private Customer context and public runtime summaries.
CREATE TABLE "AssessmentInterviewThread" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "stateJson" JSONB NOT NULL,
    "privateContextJson" JSONB NOT NULL DEFAULT '[]',
    "contextRevision" INTEGER NOT NULL DEFAULT 0,
    "activeQuestionId" TEXT,
    "processedRevision" INTEGER NOT NULL DEFAULT 0,
    "sourceVersion" TEXT,
    "pgeVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentInterviewThread_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssessmentInterviewThread_assessmentId_key" ON "AssessmentInterviewThread"("assessmentId");
CREATE INDEX "AssessmentInterviewThread_assessmentId_contextRevision_idx" ON "AssessmentInterviewThread"("assessmentId", "contextRevision");
CREATE INDEX "AssessmentInterviewThread_assessmentId_activeQuestionId_contextRevision_idx" ON "AssessmentInterviewThread"("assessmentId", "activeQuestionId", "contextRevision");
CREATE INDEX "AssessmentInterviewThread_assessmentId_updatedAt_idx" ON "AssessmentInterviewThread"("assessmentId", "updatedAt");

ALTER TABLE "AssessmentInterviewThread"
ADD CONSTRAINT "AssessmentInterviewThread_assessmentId_fkey"
FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
