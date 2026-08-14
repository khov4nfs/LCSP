CREATE TYPE "AssessmentRuntimeEventType" AS ENUM (
  'RUN_STARTED',
  'RUN_STAGE_CHANGED',
  'TOOL_STARTED',
  'TOOL_COMPLETED',
  'TOOL_FAILED',
  'TOOL_WAITING_INPUT',
  'TOOL_SKIPPED',
  'RUN_COMPLETED',
  'RUN_FAILED'
);

CREATE TYPE "AssessmentRuntimeRunStatus" AS ENUM (
  'RUNNING',
  'WAITING',
  'COMPLETED',
  'FAILED'
);

CREATE TYPE "AssessmentRuntimeStage" AS ENUM (
  'SNAPSHOT',
  'SCAN',
  'TECHNICAL_EVIDENCE',
  'TECHNICAL_PROFILE',
  'AI_USAGE_FLOW',
  'RECONCILIATION',
  'CLASSIFICATION',
  'CONFLICTS',
  'DOCUMENTS',
  'LEGAL_RETRIEVAL'
);

CREATE TABLE "AssessmentRuntimeEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "assessmentId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "eventType" "AssessmentRuntimeEventType" NOT NULL,
  "runStatus" "AssessmentRuntimeRunStatus" NOT NULL,
  "stage" "AssessmentRuntimeStage" NOT NULL,
  "toolName" TEXT,
  "summary" TEXT NOT NULL,
  "inputSummaryJson" JSONB,
  "outputSummaryJson" JSONB,
  "errorSummary" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "durationMs" INTEGER,
  "attempt" INTEGER,
  "waitingReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AssessmentRuntimeEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssessmentRuntimeEvent_runId_sequence_key"
ON "AssessmentRuntimeEvent"("runId", "sequence");

CREATE INDEX "AssessmentRuntimeEvent_assessmentId_createdAt_idx"
ON "AssessmentRuntimeEvent"("assessmentId", "createdAt");

CREATE INDEX "AssessmentRuntimeEvent_runId_sequence_idx"
ON "AssessmentRuntimeEvent"("runId", "sequence");

CREATE INDEX "AssessmentRuntimeEvent_organizationId_createdAt_idx"
ON "AssessmentRuntimeEvent"("organizationId", "createdAt");
