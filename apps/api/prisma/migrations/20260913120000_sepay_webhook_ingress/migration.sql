ALTER TYPE "OutboxAggregateType" ADD VALUE IF NOT EXISTS 'BILLING_PAYMENT';

ALTER TABLE "SePayWebhookEvent"
  ADD COLUMN "integrityHash" TEXT,
  ADD COLUMN "securityAcceptedAt" TIMESTAMP(3);

CREATE INDEX "SePayWebhookEvent_integrityHash_idx"
  ON "SePayWebhookEvent"("integrityHash");
