-- W1.2 expand only: preserve all V1 state/history, without semantic backfill.
BEGIN;

-- CreateEnum
CREATE TYPE "AssessmentLifecycleState" AS ENUM ('CREATED', 'PREPARING', 'ACTIVE', 'WAITING_FOR_HUMAN', 'WAITING_FOR_REQUIRED_INPUT', 'PAUSED', 'FINALIZING', 'COMPLETE', 'BLOCKED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BlockerReason" AS ENUM ('HUMAN_FACT_UNRESOLVABLE', 'REQUIRED_DOCUMENT_UNAVAILABLE', 'REQUIRED_RUNTIME_INPUT_UNAVAILABLE', 'LEGAL_PORTFOLIO_UNAVAILABLE', 'REPOSITORY_SNAPSHOT_UNAVAILABLE');

-- CreateEnum
CREATE TYPE "AgentExecutionState" AS ENUM ('QUEUED', 'RUNNING', 'INTERRUPTED', 'PAUSED', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssessmentEventType" AS ENUM ('ACTIVITY_RECORDED', 'ASSESSMENT_LIFECYCLE_CHANGED', 'EXECUTION_STATE_CHANGED', 'EVIDENCE_ACCEPTED', 'DECISION_ACCEPTED', 'HUMAN_RESOLUTION_CHANGED', 'ARTIFACT_CHANGED');

-- CreateEnum
CREATE TYPE "AssessmentEventActorType" AS ENUM ('RUNTIME', 'ASSESSMENT_ROOT', 'SUBAGENT', 'TOOL', 'API');

-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "blockerReason" "BlockerReason",
ADD COLUMN     "blockerReference" JSONB,
ADD COLUMN     "lifecycleRevision" INTEGER,
ADD COLUMN     "lifecycleState" "AssessmentLifecycleState";

-- CreateTable
CREATE TABLE "AssessmentRuntime" (
    "assessmentId" TEXT NOT NULL,
    "threadId" UUID NOT NULL,
    "rootAgentVersion" TEXT NOT NULL,
    "checkpointNamespace" TEXT NOT NULL,
    "checkpointId" TEXT,
    "currentExecutionId" UUID,
    "executionState" "AgentExecutionState" NOT NULL DEFAULT 'QUEUED',
    "leaseToken" UUID,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "eventSequence" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMPTZ(3),
    "lastResumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AssessmentRuntime_pkey" PRIMARY KEY ("assessmentId")
);

-- CreateTable
CREATE TABLE "AssessmentEvent" (
    "eventId" UUID NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "threadId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "timestamp" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eventType" "AssessmentEventType" NOT NULL,
    "actorType" "AssessmentEventActorType" NOT NULL,
    "executionId" UUID,
    "parentExecutionId" UUID,
    "taskId" TEXT,
    "toolCallId" TEXT,
    "payload" JSONB NOT NULL,
    "tokenUsage" JSONB,
    "technicalDetailsRef" UUID,
    "outboxMessageId" TEXT NOT NULL,

    CONSTRAINT "AssessmentEvent_pkey" PRIMARY KEY ("eventId")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentRuntime_threadId_key" ON "AssessmentRuntime"("threadId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentRuntime_assessmentId_threadId_key" ON "AssessmentRuntime"("assessmentId", "threadId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentEvent_outboxMessageId_key" ON "AssessmentEvent"("outboxMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentEvent_assessmentId_sequence_key" ON "AssessmentEvent"("assessmentId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentEvent_outboxMessageId_assessmentId_key" ON "AssessmentEvent"("outboxMessageId", "assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxMessage_id_aggregateId_key" ON "OutboxMessage"("id", "aggregateId");

-- AddForeignKey
ALTER TABLE "AssessmentRuntime" ADD CONSTRAINT "AssessmentRuntime_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AssessmentEvent" ADD CONSTRAINT "AssessmentEvent_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AssessmentEvent" ADD CONSTRAINT "AssessmentEvent_assessmentId_threadId_fkey" FOREIGN KEY ("assessmentId", "threadId") REFERENCES "AssessmentRuntime"("assessmentId", "threadId") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AssessmentEvent" ADD CONSTRAINT "AssessmentEvent_outboxMessageId_assessmentId_fkey" FOREIGN KEY ("outboxMessageId", "assessmentId") REFERENCES "OutboxMessage"("id", "aggregateId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Structural integrity only; transition authority, CAS and typed references stay in API.
ALTER TABLE "Assessment"
    ADD CONSTRAINT "Assessment_lifecycle_pair_check" CHECK (("lifecycleState" IS NULL) = ("lifecycleRevision" IS NULL)),
    ADD CONSTRAINT "Assessment_lifecycle_revision_check" CHECK ("lifecycleRevision" >= 0),
    ADD CONSTRAINT "Assessment_blocker_check" CHECK (
        ("lifecycleState" IS NOT DISTINCT FROM 'BLOCKED' AND "blockerReason" IS NOT NULL
         AND "blockerReference" IS NOT NULL AND jsonb_typeof("blockerReference") = 'object')
        OR ("lifecycleState" IS DISTINCT FROM 'BLOCKED' AND "blockerReason" IS NULL AND "blockerReference" IS NULL)
    );

ALTER TABLE "AssessmentRuntime"
    ADD CONSTRAINT "AssessmentRuntime_event_sequence_check" CHECK ("eventSequence" >= 0),
    ADD CONSTRAINT "AssessmentRuntime_lease_pair_check" CHECK (("leaseToken" IS NULL) = ("leaseExpiresAt" IS NULL)),
    ADD CONSTRAINT "AssessmentRuntime_lease_execution_check" CHECK ("leaseToken" IS NULL OR "currentExecutionId" IS NOT NULL);

ALTER TABLE "AssessmentEvent"
    ADD CONSTRAINT "AssessmentEvent_sequence_check" CHECK ("sequence" > 0),
    ADD CONSTRAINT "AssessmentEvent_payload_check" CHECK (jsonb_typeof("payload") = 'object'),
    ADD CONSTRAINT "AssessmentEvent_token_usage_check" CHECK ("tokenUsage" IS NULL OR jsonb_typeof("tokenUsage") = 'object'),
    ADD CONSTRAINT "AssessmentEvent_child_lineage_check" CHECK (
        ("actorType" <> 'SUBAGENT' AND "parentExecutionId" IS NULL AND "taskId" IS NULL)
        OR ("executionId" IS NOT NULL AND "parentExecutionId" IS NOT NULL AND "taskId" IS NOT NULL)
    ),
    ADD CONSTRAINT "AssessmentEvent_parent_execution_check" CHECK ("executionId" IS DISTINCT FROM "parentExecutionId" OR "executionId" IS NULL);

COMMIT;
