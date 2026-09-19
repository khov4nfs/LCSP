-- LCSP-316: one reservation may cover multiple provider usage events.
CREATE TYPE "LlmUsageStatus" AS ENUM ('SETTLED', 'UNAVAILABLE', 'RETRYABLE');

ALTER TABLE "BillingReservation"
  ADD COLUMN "assessmentId" TEXT,
  ADD COLUMN "runId" TEXT,
  ADD COLUMN "remainingCredits" BIGINT NOT NULL DEFAULT 0;

UPDATE "BillingReservation"
SET "remainingCredits" = CASE
  WHEN "status" = 'RESERVED' THEN "amountCredits"
  ELSE 0
END;

ALTER TABLE "LlmUsageEvent"
  ADD COLUMN "assessmentId" TEXT,
  ADD COLUMN "runId" TEXT,
  ADD COLUMN "agentRole" TEXT NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN "status" "LlmUsageStatus" NOT NULL DEFAULT 'SETTLED',
  ADD COLUMN "availabilityReason" TEXT;

ALTER TABLE "BillingReservation"
  ADD CONSTRAINT "BillingReservation_assessmentId_fkey"
  FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LlmUsageEvent"
  ADD CONSTRAINT "LlmUsageEvent_assessmentId_fkey"
  FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LlmUsageEvent" DROP CONSTRAINT IF EXISTS "LlmUsageEvent_reservationId_key";

CREATE INDEX "BillingReservation_assessmentId_runId_idx"
  ON "BillingReservation"("assessmentId", "runId");
CREATE INDEX "LlmUsageEvent_assessmentId_runId_createdAt_idx"
  ON "LlmUsageEvent"("assessmentId", "runId", "createdAt");
CREATE INDEX "LlmUsageEvent_reservationId_createdAt_idx"
  ON "LlmUsageEvent"("reservationId", "createdAt");
