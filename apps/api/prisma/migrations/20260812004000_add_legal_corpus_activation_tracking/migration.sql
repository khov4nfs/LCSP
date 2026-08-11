ALTER TYPE "OutboxAggregateType" ADD VALUE IF NOT EXISTS 'LEGAL_CORPUS_VERSION';

ALTER TABLE "LegalCorpusVersion"
ADD COLUMN "integrityManifestRef" TEXT;

ALTER TABLE "CorpusApprovalRecord"
ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "integrityManifestRef" TEXT,
ADD COLUMN "retrievalValidationRef" TEXT,
ADD COLUMN "outboxEventId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "CorpusApprovalRecord_idempotencyKey_key"
ON "CorpusApprovalRecord"("idempotencyKey");
