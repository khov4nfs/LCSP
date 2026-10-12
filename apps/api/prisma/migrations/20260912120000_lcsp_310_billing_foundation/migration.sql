CREATE TYPE "BillingOrderStatus" AS ENUM ('PENDING_PAYMENT', 'CREDITED', 'EXPIRED', 'CANCELLED', 'PENDING_RECONCILIATION');
CREATE TYPE "PaymentReconciliationStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'AMOUNT_MISMATCH', 'DUPLICATE', 'REJECTED', 'NEEDS_REVIEW');
CREATE TYPE "BillingReservationStatus" AS ENUM ('RESERVED', 'SETTLED', 'RELEASED');

CREATE TABLE "BillingWallet" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "availableCredits" BIGINT NOT NULL DEFAULT 0,
  "reservedCredits" BIGINT NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingWallet_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "BillingOrder" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "paymentCode" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT,
  "status" "BillingOrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "amountMinorUnits" BIGINT NOT NULL,
  "creditUnits" BIGINT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "creditedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingOrder_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SePayWebhookEvent" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerTransactionId" TEXT NOT NULL,
  "sanitizedPayload" JSONB,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SePayWebhookEvent_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PaymentTransaction" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerTransactionId" TEXT NOT NULL,
  "amountMinorUnits" BIGINT NOT NULL,
  "reconciliationStatus" "PaymentReconciliationStatus" NOT NULL DEFAULT 'UNMATCHED',
  "userId" TEXT,
  "billingOrderId" TEXT,
  "webhookEventId" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reconciledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CreditLedgerEntry" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "billingOrderId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "referenceId" TEXT,
  "deltaCredits" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreditLedgerEntry_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "BillingReservation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "amountCredits" BIGINT NOT NULL,
  "status" "BillingReservationStatus" NOT NULL DEFAULT 'RESERVED',
  "idempotencyKey" TEXT,
  "settledAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingReservation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ModelPricingSnapshot" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "inputPricePerMillion" DECIMAL(20,8) NOT NULL,
  "outputPricePerMillion" DECIMAL(20,8) NOT NULL,
  "version" INTEGER NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModelPricingSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "LlmUsageEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "invocationId" TEXT NOT NULL,
  "providerResponseId" TEXT,
  "inputTokens" BIGINT,
  "cachedInputTokens" BIGINT,
  "outputTokens" BIGINT,
  "reasoningTokens" BIGINT,
  "totalTokens" BIGINT,
  "pricingSnapshotId" TEXT,
  "reservationId" TEXT,
  "chargedCredits" BIGINT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LlmUsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingWallet_userId_key" ON "BillingWallet"("userId");
CREATE UNIQUE INDEX "BillingOrder_paymentCode_key" ON "BillingOrder"("paymentCode");
CREATE UNIQUE INDEX "BillingOrder_userId_idempotencyKey_key" ON "BillingOrder"("userId", "idempotencyKey");
CREATE UNIQUE INDEX "SePayWebhookEvent_provider_providerTransactionId_key" ON "SePayWebhookEvent"("provider", "providerTransactionId");
CREATE UNIQUE INDEX "PaymentTransaction_webhookEventId_key" ON "PaymentTransaction"("webhookEventId");
CREATE UNIQUE INDEX "PaymentTransaction_provider_providerTransactionId_key" ON "PaymentTransaction"("provider", "providerTransactionId");
CREATE UNIQUE INDEX "CreditLedgerEntry_idempotencyKey_key" ON "CreditLedgerEntry"("idempotencyKey");
CREATE UNIQUE INDEX "BillingReservation_userId_idempotencyKey_key" ON "BillingReservation"("userId", "idempotencyKey");
CREATE UNIQUE INDEX "ModelPricingSnapshot_provider_model_version_key" ON "ModelPricingSnapshot"("provider", "model", "version");
CREATE UNIQUE INDEX "LlmUsageEvent_userId_invocationId_key" ON "LlmUsageEvent"("userId", "invocationId");
CREATE UNIQUE INDEX "LlmUsageEvent_provider_providerResponseId_key" ON "LlmUsageEvent"("provider", "providerResponseId");
CREATE UNIQUE INDEX "LlmUsageEvent_reservationId_key" ON "LlmUsageEvent"("reservationId");
CREATE INDEX "BillingOrder_userId_status_createdAt_idx" ON "BillingOrder"("userId", "status", "createdAt");
CREATE INDEX "SePayWebhookEvent_receivedAt_idx" ON "SePayWebhookEvent"("receivedAt");
CREATE INDEX "PaymentTransaction_userId_createdAt_idx" ON "PaymentTransaction"("userId", "createdAt");
CREATE INDEX "PaymentTransaction_reconciliationStatus_createdAt_idx" ON "PaymentTransaction"("reconciliationStatus", "createdAt");
CREATE INDEX "CreditLedgerEntry_userId_createdAt_idx" ON "CreditLedgerEntry"("userId", "createdAt");
CREATE INDEX "CreditLedgerEntry_walletId_createdAt_idx" ON "CreditLedgerEntry"("walletId", "createdAt");
CREATE INDEX "CreditLedgerEntry_source_referenceId_idx" ON "CreditLedgerEntry"("source", "referenceId");
CREATE INDEX "BillingReservation_userId_status_createdAt_idx" ON "BillingReservation"("userId", "status", "createdAt");
CREATE INDEX "BillingReservation_walletId_status_idx" ON "BillingReservation"("walletId", "status");
CREATE INDEX "ModelPricingSnapshot_provider_model_effectiveAt_idx" ON "ModelPricingSnapshot"("provider", "model", "effectiveAt");
CREATE INDEX "LlmUsageEvent_userId_createdAt_idx" ON "LlmUsageEvent"("userId", "createdAt");
CREATE INDEX "LlmUsageEvent_provider_model_createdAt_idx" ON "LlmUsageEvent"("provider", "model", "createdAt");

ALTER TABLE "BillingWallet" ADD CONSTRAINT "BillingWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingOrder" ADD CONSTRAINT "BillingOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_billingOrderId_fkey" FOREIGN KEY ("billingOrderId") REFERENCES "BillingOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_webhookEventId_fkey" FOREIGN KEY ("webhookEventId") REFERENCES "SePayWebhookEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "BillingWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_billingOrderId_fkey" FOREIGN KEY ("billingOrderId") REFERENCES "BillingOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingReservation" ADD CONSTRAINT "BillingReservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillingReservation" ADD CONSTRAINT "BillingReservation_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "BillingWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LlmUsageEvent" ADD CONSTRAINT "LlmUsageEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LlmUsageEvent" ADD CONSTRAINT "LlmUsageEvent_pricingSnapshotId_fkey" FOREIGN KEY ("pricingSnapshotId") REFERENCES "ModelPricingSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LlmUsageEvent" ADD CONSTRAINT "LlmUsageEvent_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "BillingReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "prevent_model_pricing_snapshot_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ModelPricingSnapshot rows are append-only';
END;
$$;

CREATE TRIGGER "ModelPricingSnapshot_immutable"
BEFORE UPDATE OR DELETE ON "ModelPricingSnapshot"
FOR EACH ROW EXECUTE FUNCTION "prevent_model_pricing_snapshot_mutation"();
