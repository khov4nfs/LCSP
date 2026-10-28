-- Additive telemetry only. Historical usage and signed evidence are unchanged.
CREATE TYPE "ModelAttemptStatus" AS ENUM ('STARTED', 'COMPLETED', 'FAILED', 'OUTCOME_UNKNOWN');
ALTER TABLE "LlmUsageEvent"
  ADD COLUMN "attemptStatus" "ModelAttemptStatus",
  ADD COLUMN "failureClass" TEXT,
  ADD COLUMN "referenceCostSnapshot" JSONB,
  ADD COLUMN "inputTokensIncludingCache" BIGINT,
  ADD COLUMN "cacheWrite5mTokens" BIGINT,
  ADD COLUMN "cacheWrite1hTokens" BIGINT,
  ADD COLUMN "visibleOutputTokens" BIGINT;
CREATE INDEX "LlmUsageEvent_occurredAt_idx" ON "LlmUsageEvent"("occurredAt");
