-- Expand-only migration for WP8 Phase B2 model pricing audit, outbox aggregate,
-- and idempotent versioned assignment supersede.
-- Why: Enables atomic AuditEvent/Outbox persistence for tariff governance and
-- idempotent replay/conflict + optimistic version locking on assignment supersede.
-- Invariant: New enum values are not referenced in defaults or DML within this
-- migration file, and existing WP8 triggers/GiST EXCLUDE constraints remain intact.

ALTER TYPE "AuditResourceType" ADD VALUE IF NOT EXISTS 'CUSTOMER_MODEL_TARIFF';
ALTER TYPE "OutboxAggregateType" ADD VALUE IF NOT EXISTS 'CUSTOMER_MODEL_TARIFF';

ALTER TABLE "CustomerModelTariffAssignment"
  ADD COLUMN "supersedeIdempotencyKey" TEXT,
  ADD COLUMN "supersedeRequestFingerprint" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX "CustomerModelTariffAssignment_supersedeIdempotencyKey_key"
  ON "CustomerModelTariffAssignment"("supersedeIdempotencyKey");
