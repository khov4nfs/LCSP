ALTER TYPE "AuditResourceType" ADD VALUE 'LEGAL_SOURCE';
ALTER TYPE "OutboxAggregateType" ADD VALUE 'LEGAL_SOURCE';

CREATE TYPE "LegalSourceDeletionReasonCode" AS ENUM (
  'DUPLICATE_SOURCE',
  'SOURCE_SCOPE_RETIRED',
  'DEVELOPMENT_DATA_CLEANUP',
  'OTHER'
);

CREATE TABLE "LegalSourceDeletionReceipt" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceSlug" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "reasonCode" "LegalSourceDeletionReasonCode" NOT NULL,
  "reasonText" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "auditEventId" TEXT NOT NULL,
  "outboxEventId" TEXT NOT NULL,
  "deletedVersionIds" JSONB NOT NULL,
  "deletedDocumentRowIds" JSONB NOT NULL,
  "deletedPreparationRunIds" JSONB NOT NULL,
  "deletedRuleSetVersionIds" JSONB NOT NULL,
  "retainedIndependentSnapshotCount" INTEGER NOT NULL DEFAULT 0,
  "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LegalSourceDeletionReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LegalSourceDeletionReceipt_idempotencyKey_key"
  ON "LegalSourceDeletionReceipt"("idempotencyKey");
CREATE UNIQUE INDEX "LegalSourceDeletionReceipt_auditEventId_key"
  ON "LegalSourceDeletionReceipt"("auditEventId");
CREATE UNIQUE INDEX "LegalSourceDeletionReceipt_outboxEventId_key"
  ON "LegalSourceDeletionReceipt"("outboxEventId");
CREATE INDEX "LegalSourceDeletionReceipt_sourceId_deletedAt_idx"
  ON "LegalSourceDeletionReceipt"("sourceId", "deletedAt");
