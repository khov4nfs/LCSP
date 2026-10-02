ALTER TABLE "BillingReservation"
  ADD COLUMN "workspaceId" TEXT,
  ADD COLUMN "scanJobId" TEXT,
  ADD COLUMN "threadId" TEXT,
  ADD COLUMN "provider" TEXT,
  ADD COLUMN "model" TEXT,
  ADD COLUMN "invocationId" TEXT,
  ADD COLUMN "modelInvocationId" TEXT;

CREATE INDEX "BillingReservation_scanJobId_idx" ON "BillingReservation"("scanJobId");
CREATE INDEX "BillingReservation_threadId_idx" ON "BillingReservation"("threadId");
CREATE INDEX "BillingReservation_invocationId_idx" ON "BillingReservation"("invocationId");
CREATE INDEX "BillingReservation_modelInvocationId_idx" ON "BillingReservation"("modelInvocationId");
