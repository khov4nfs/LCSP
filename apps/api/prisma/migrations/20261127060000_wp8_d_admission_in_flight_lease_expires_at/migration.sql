-- AlterTable
ALTER TABLE "BillableInvocationAdmission" ADD COLUMN "inFlightLeaseExpiresAt" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "BillableInvocationAdmission_state_inFlightLeaseExpiresAt_idx" ON "BillableInvocationAdmission"("state", "inFlightLeaseExpiresAt");
