-- LCSP-336: durable idempotency for non-authoritative decision-model shadow calls.
CREATE TYPE "DecisionModelDecisionStatus" AS ENUM ('CLAIMED', 'COMPLETED', 'FAILED');

CREATE TABLE "DecisionModelDecision" (
    "decisionId" TEXT NOT NULL,
    "decisionType" TEXT NOT NULL,
    "assessmentId" TEXT,
    "reviewRunId" TEXT,
    "prNumber" INTEGER,
    "baseSha" TEXT,
    "headSha" TEXT,
    "status" "DecisionModelDecisionStatus" NOT NULL DEFAULT 'CLAIMED',
    "resultJson" JSONB,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionModelDecision_pkey" PRIMARY KEY ("decisionId")
);

CREATE INDEX "DecisionModelDecision_assessmentId_reviewRunId_idx"
    ON "DecisionModelDecision"("assessmentId", "reviewRunId");

CREATE INDEX "DecisionModelDecision_prNumber_headSha_idx"
    ON "DecisionModelDecision"("prNumber", "headSha");

CREATE INDEX "DecisionModelDecision_status_claimedAt_idx"
    ON "DecisionModelDecision"("status", "claimedAt");

CREATE TABLE "DecisionModelEvent" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "decisionType" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "assessmentId" TEXT,
    "reviewRunId" TEXT,
    "prNumber" INTEGER,
    "baseSha" TEXT,
    "headSha" TEXT,
    "payloadJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionModelEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DecisionModelEvent_decisionId_createdAt_idx"
    ON "DecisionModelEvent"("decisionId", "createdAt");

CREATE INDEX "DecisionModelEvent_assessmentId_reviewRunId_idx"
    ON "DecisionModelEvent"("assessmentId", "reviewRunId");

CREATE INDEX "DecisionModelEvent_prNumber_headSha_idx"
    ON "DecisionModelEvent"("prNumber", "headSha");

CREATE INDEX "DecisionModelEvent_eventType_createdAt_idx"
    ON "DecisionModelEvent"("eventType", "createdAt");
