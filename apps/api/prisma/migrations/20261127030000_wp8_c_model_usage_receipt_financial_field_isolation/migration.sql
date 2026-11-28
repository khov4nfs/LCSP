-- AlterTable
ALTER TABLE "ModelUsageReceipt"
  ADD COLUMN "calculatedMicrocredits" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "debitedMicrocredits" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "shadowMicrocredits" BIGINT;
