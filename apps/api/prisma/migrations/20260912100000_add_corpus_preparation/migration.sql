CREATE TYPE "CorpusPreparationStatus" AS ENUM ('REQUESTED', 'RUNNING', 'COMPLETED', 'FAILED', 'BLOCKED');

CREATE TABLE "CorpusPreparation" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "targetCorpusId" TEXT NOT NULL,
  "baseCorpusId" TEXT,
  "status" "CorpusPreparationStatus" NOT NULL DEFAULT 'REQUESTED',
  "requestedBy" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  CONSTRAINT "CorpusPreparation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CorpusPreparation_idempotencyKey_key" ON "CorpusPreparation"("idempotencyKey");
CREATE UNIQUE INDEX "CorpusPreparation_targetCorpusId_key" ON "CorpusPreparation"("targetCorpusId");
CREATE INDEX "CorpusPreparation_status_createdAt_idx" ON "CorpusPreparation"("status", "createdAt");
