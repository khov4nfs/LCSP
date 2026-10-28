-- Automated Preparation belongs to the system workflow, not a fabricated customer.
ALTER TABLE "LlmUsageEvent" ALTER COLUMN "userId" DROP NOT NULL;
CREATE UNIQUE INDEX "LlmUsageEvent_system_run_invocation_key"
  ON "LlmUsageEvent"("runId", "invocationId") WHERE "userId" IS NULL;
