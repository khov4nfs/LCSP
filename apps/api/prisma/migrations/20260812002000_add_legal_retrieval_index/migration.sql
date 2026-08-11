CREATE TYPE "LegalRetrievalIndexStatus" AS ENUM ('BUILDING', 'VALID', 'INVALID');

CREATE TABLE "LegalRetrievalIndex" (
    "id" TEXT NOT NULL,
    "legalCorpusVersionId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "LegalRetrievalIndexStatus" NOT NULL DEFAULT 'BUILDING',
    "configHash" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "validationManifestRef" TEXT,
    "validatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalRetrievalIndex_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LegalRetrievalIndex_version_key"
ON "LegalRetrievalIndex"("version");

CREATE INDEX "LegalRetrievalIndex_legalCorpusVersionId_status_validatedAt_idx"
ON "LegalRetrievalIndex"("legalCorpusVersionId", "status", "validatedAt");

ALTER TABLE "LegalRetrievalIndex"
ADD CONSTRAINT "LegalRetrievalIndex_legalCorpusVersionId_fkey"
FOREIGN KEY ("legalCorpusVersionId") REFERENCES "LegalCorpusVersion"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
