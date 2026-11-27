-- CreateEnum
CREATE TYPE "BillingRolloutMode" AS ENUM ('TELEMETRY_ONLY', 'SHADOW_PRICING', 'ADMISSION_REQUIRED', 'SHADOW_SETTLEMENT', 'DEBIT_ENABLED');

-- AlterTable
ALTER TABLE "BillableInvocationAdmission"
  ADD COLUMN "debitMode" "ModelUsageDebitMode" NOT NULL DEFAULT 'OFF';

ALTER TABLE "BillableInvocationAdmission"
  ALTER COLUMN "rolloutMode" DROP DEFAULT;

ALTER TABLE "BillableInvocationAdmission"
  ALTER COLUMN "rolloutMode" TYPE "BillingRolloutMode"
  USING ('TELEMETRY_ONLY'::"BillingRolloutMode");

ALTER TABLE "BillableInvocationAdmission"
  ALTER COLUMN "rolloutMode" SET DEFAULT 'TELEMETRY_ONLY';
