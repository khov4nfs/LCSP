CREATE UNIQUE INDEX "LegalCorpusVersion_single_draft_key"
ON "LegalCorpusVersion" (("status"))
WHERE "status" = 'DRAFT';

CREATE TABLE "CorpusDiscardReceipt" (
  "id" TEXT NOT NULL,
  "corpusVersionId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CorpusDiscardReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CorpusDiscardReceipt_corpusVersionId_fkey"
    FOREIGN KEY ("corpusVersionId") REFERENCES "LegalCorpusVersion"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CorpusDiscardReceipt_actorId_idempotencyKey_key"
ON "CorpusDiscardReceipt"("actorId", "idempotencyKey");

CREATE INDEX "CorpusDiscardReceipt_corpusVersionId_idx"
ON "CorpusDiscardReceipt"("corpusVersionId");
