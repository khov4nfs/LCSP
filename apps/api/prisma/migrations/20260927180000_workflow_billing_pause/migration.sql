ALTER TABLE "BillingWallet" ADD COLUMN "reservationAutoRefillEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TYPE "RepositoryScanJobStatus" ADD VALUE 'WAITING_FOR_CREDITS';

CREATE TABLE "WorkflowBillingPause" (
  "id" TEXT NOT NULL,
  "assessmentId" TEXT NOT NULL,
  "dispatchKey" TEXT NOT NULL,
  "sourceEvent" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "pausedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resumedAt" TIMESTAMP(3),
  CONSTRAINT "WorkflowBillingPause_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkflowBillingPause_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WorkflowBillingPause_dispatchKey_key" ON "WorkflowBillingPause"("dispatchKey");
CREATE INDEX "WorkflowBillingPause_assessmentId_resumedAt_pausedAt_idx" ON "WorkflowBillingPause"("assessmentId", "resumedAt", "pausedAt");
